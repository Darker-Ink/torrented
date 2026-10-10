use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use axum_extra::extract::CookieJar;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    audit,
    auth::{
        self, ClientInfo, CurrentUser, MaybeUser, USER_COLUMNS, User, password,
        permissions::{self, perm},
    },
    bail_bad_request,
    error::{AppError, AppResult},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/instance", get(instance))
        .route("/setup", post(setup))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/logout-all", post(logout_all))
        .route("/auth/register", post(register))
        .route("/auth/me", get(me).patch(update_me))
}

async fn user_count(state: &AppState) -> AppResult<i64> {
    Ok(sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&state.main)
        .await?)
}

pub fn user_json(user: &User) -> Value {
    let effective = user.effective_permissions();
    let granted: Vec<&str> = permissions::ALL
        .iter()
        .filter(|p| permissions::has(effective, p.bit))
        .map(|p| p.key)
        .collect();
    json!({
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "permissions": user.permissions,
        "effective_permissions": effective,
        "granted": granted,
        "disabled": user.disabled,
        "created_at": user.created_at,
        "last_seen_at": user.last_seen_at,
    })
}

async fn instance(State(state): State<AppState>, MaybeUser(user): MaybeUser) -> AppResult<Json<Value>> {
    let users = user_count(&state).await?;
    Ok(Json(json!({
        "name": state.settings.instance_name().await,
        "version": env!("CARGO_PKG_VERSION"),
        "setup_required": users == 0,
        "registration": state.settings.registration_mode().await,
        "ffmpeg": state.tools.can_transcode(),
        "ffprobe": state.tools.can_probe(),
        "user": user.as_ref().map(user_json),
    })))
}

fn validate_username(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.len() < 2 || name.len() > 32 {
        bail_bad_request!("username must be 2-32 characters");
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')) {
        bail_bad_request!("username may only contain letters, numbers, '.', '_' and '-'");
    }
    Ok(name.to_string())
}

pub async fn create_user(
    state: &AppState,
    username: &str,
    password_plain: &str,
    display_name: Option<String>,
    role: &str,
    permissions: i64,
) -> AppResult<User> {
    let username = validate_username(username)?;
    password::validate(password_plain).map_err(AppError::bad_request)?;
    let hash = password::hash_async(password_plain.to_string()).await?;
    let display_name = display_name.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
    let res = sqlx::query_as::<_, User>(&format!(
        "INSERT INTO users (username, display_name, password_hash, role, permissions, created_at)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING {USER_COLUMNS}"
    ))
    .bind(&username)
    .bind(display_name)
    .bind(hash)
    .bind(role)
    .bind(permissions)
    .bind(Utc::now())
    .fetch_one(&state.main)
    .await;
    match res {
        Ok(u) => Ok(u),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            Err(AppError::conflict("that username is taken"))
        }
        Err(e) => Err(e.into()),
    }
}

#[derive(Deserialize)]
struct SetupBody {
    username: String,
    password: String,
    display_name: Option<String>,
    instance_name: Option<String>,
    tmdb_api_key: Option<String>,
    tvdb_api_key: Option<String>,
    registration: Option<String>,
}

/// First-run setup: creates the owner account. Only works while there are
/// no users at all.
async fn setup(
    State(state): State<AppState>,
    client: ClientInfo,
    jar: CookieJar,
    Json(body): Json<SetupBody>,
) -> AppResult<(CookieJar, Json<Value>)> {
    if user_count(&state).await? > 0 {
        return Err(AppError::forbidden("this instance is already set up"));
    }
    let user = create_user(
        &state,
        &body.username,
        &body.password,
        body.display_name,
        "owner",
        perm::ADMIN,
    )
    .await?;

    if let Some(name) = body.instance_name.filter(|s| !s.trim().is_empty()) {
        state.settings.set("instance_name", name.trim()).await?;
    }
    if let Some(key) = body.tmdb_api_key.filter(|s| !s.trim().is_empty()) {
        state.settings.set("tmdb_api_key", key.trim()).await?;
    }
    if let Some(key) = body.tvdb_api_key.filter(|s| !s.trim().is_empty()) {
        state.settings.set("tvdb_api_key", key.trim()).await?;
    }
    if let Some(mode) = body.registration.filter(|m| ["open", "invite", "closed"].contains(&m.as_str())) {
        state.settings.set("registration_mode", &mode).await?;
    }

    let cookie = auth::create_session(&state, user.id, &client).await?;
    audit::log(&state, Some(&user), &client, "instance.setup", None, None).await;
    Ok((jar.add(cookie), Json(user_json(&user))))
}

#[derive(Deserialize)]
struct LoginBody {
    username: String,
    password: String,
}

async fn login(
    State(state): State<AppState>,
    client: ClientInfo,
    jar: CookieJar,
    Json(body): Json<LoginBody>,
) -> AppResult<(CookieJar, Json<Value>)> {
    let row: Option<(i64, String, bool)> =
        sqlx::query_as("SELECT id, password_hash, disabled FROM users WHERE username = ?")
            .bind(body.username.trim())
            .fetch_optional(&state.main)
            .await?;

    let ok = match &row {
        Some((_, hash, _)) => password::verify_async(body.password.clone(), hash.clone()).await,
        None => {
            // Spend roughly the same time so usernames can't be probed.
            let _ = password::hash_async(body.password.clone()).await;
            false
        }
    };
    let Some((id, _, disabled)) = row.filter(|_| ok) else {
        audit::log(
            &state,
            None,
            &client,
            "auth.login_failed",
            Some(body.username.trim().to_string()),
            None,
        )
        .await;
        return Err(AppError::bad_request("wrong username or password"));
    };
    if disabled {
        return Err(AppError::forbidden("this account is disabled"));
    }

    let cookie = auth::create_session(&state, id, &client).await?;
    let user: User = sqlx::query_as(&format!("SELECT {USER_COLUMNS} FROM users WHERE id = ?"))
        .bind(id)
        .fetch_one(&state.main)
        .await?;
    audit::log(&state, Some(&user), &client, "auth.login", None, None).await;
    Ok((jar.add(cookie), Json(user_json(&user))))
}

async fn logout(State(state): State<AppState>, jar: CookieJar) -> AppResult<(CookieJar, Json<Value>)> {
    auth::destroy_session(&state, &jar).await?;
    let jar = jar.remove(axum_extra::extract::cookie::Cookie::build(auth::SESSION_COOKIE).path("/"));
    Ok((jar, Json(json!({ "ok": true }))))
}

async fn logout_all(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    jar: CookieJar,
) -> AppResult<(CookieJar, Json<Value>)> {
    sqlx::query("DELETE FROM sessions WHERE user_id = ?")
        .bind(user.id)
        .execute(&state.main)
        .await?;
    audit::log(&state, Some(&user), &client, "auth.logout_all", None, None).await;
    let jar = jar.remove(axum_extra::extract::cookie::Cookie::build(auth::SESSION_COOKIE).path("/"));
    Ok((jar, Json(json!({ "ok": true }))))
}

#[derive(Deserialize)]
struct RegisterBody {
    username: String,
    password: String,
    display_name: Option<String>,
    invite: Option<String>,
}

async fn register(
    State(state): State<AppState>,
    client: ClientInfo,
    jar: CookieJar,
    Json(body): Json<RegisterBody>,
) -> AppResult<(CookieJar, Json<Value>)> {
    if user_count(&state).await? == 0 {
        return Err(AppError::bad_request("finish setup first"));
    }
    let mode = state.settings.registration_mode().await;
    let invite_code = body.invite.as_deref().map(str::trim).filter(|s| !s.is_empty());

    let permissions = match (mode.as_str(), invite_code) {
        (_, Some(code)) => {
            let invite: Option<(i64, i64, i64, Option<chrono::DateTime<Utc>>)> = sqlx::query_as(
                "SELECT permissions, max_uses, uses, expires_at FROM invites WHERE code = ?",
            )
            .bind(code)
            .fetch_optional(&state.main)
            .await?;
            let Some((perms, max_uses, uses, expires)) = invite else {
                return Err(AppError::bad_request("that invite code is not valid"));
            };
            if (max_uses > 0 && uses >= max_uses) || expires.is_some_and(|e| e < Utc::now()) {
                return Err(AppError::bad_request("that invite has expired"));
            }
            perms
        }
        ("open", None) => state.settings.default_permissions().await,
        ("invite", None) => return Err(AppError::bad_request("an invite code is required")),
        _ => return Err(AppError::forbidden("registration is closed")),
    };

    let user = create_user(&state, &body.username, &body.password, body.display_name, "user", permissions).await?;
    if let Some(code) = invite_code {
        sqlx::query("UPDATE invites SET uses = uses + 1 WHERE code = ?")
            .bind(code)
            .execute(&state.main)
            .await?;
    }
    let cookie = auth::create_session(&state, user.id, &client).await?;
    audit::log(&state, Some(&user), &client, "auth.register", invite_code.map(String::from), None).await;
    Ok((jar.add(cookie), Json(user_json(&user))))
}

async fn me(CurrentUser(user): CurrentUser) -> Json<Value> {
    Json(user_json(&user))
}

#[derive(Deserialize)]
struct UpdateMe {
    display_name: Option<String>,
    current_password: Option<String>,
    new_password: Option<String>,
}

async fn update_me(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    Json(body): Json<UpdateMe>,
) -> AppResult<Json<Value>> {
    if let Some(name) = body.display_name {
        let name = name.trim();
        if name.chars().count() > 64 {
            bail_bad_request!("display name is too long");
        }
        sqlx::query("UPDATE users SET display_name = ? WHERE id = ?")
            .bind((!name.is_empty()).then_some(name))
            .bind(user.id)
            .execute(&state.main)
            .await?;
    }
    if let Some(new_password) = body.new_password {
        let current = body.current_password.unwrap_or_default();
        let hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = ?")
            .bind(user.id)
            .fetch_one(&state.main)
            .await?;
        if !password::verify_async(current, hash).await {
            bail_bad_request!("current password is incorrect");
        }
        password::validate(&new_password).map_err(AppError::bad_request)?;
        let hash = password::hash_async(new_password).await?;
        sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
            .bind(hash)
            .bind(user.id)
            .execute(&state.main)
            .await?;
        audit::log(&state, Some(&user), &client, "auth.password_changed", None, None).await;
    }
    let user: User = sqlx::query_as(&format!("SELECT {USER_COLUMNS} FROM users WHERE id = ?"))
        .bind(user.id)
        .fetch_one(&state.main)
        .await?;
    Ok(Json(user_json(&user)))
}
