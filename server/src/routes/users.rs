use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{delete, get, patch},
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::auth::{create_user, user_json};
use crate::{
    audit,
    auth::{ClientInfo, CurrentUser, USER_COLUMNS, User, password, perm, permissions},
    bail_bad_request,
    error::{AppError, AppResult},
    state::AppState,
    util,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/permissions", get(list_permissions))
        .route("/users", get(list_users).post(create))
        .route("/users/{id}", patch(update).delete(remove))
        .route("/invites", get(list_invites).post(create_invite))
        .route("/invites/{code}", delete(delete_invite))
}

async fn list_permissions() -> Json<Value> {
    Json(json!(permissions::ALL))
}

async fn list_users(State(state): State<AppState>, CurrentUser(me): CurrentUser) -> AppResult<Json<Value>> {
    me.require(perm::MANAGE_USERS)?;
    let users: Vec<User> = sqlx::query_as(&format!(
        "SELECT {USER_COLUMNS} FROM users ORDER BY role = 'owner' DESC, role = 'admin' DESC, username"
    ))
    .fetch_all(&state.main)
    .await?;
    Ok(Json(json!(users.iter().map(user_json).collect::<Vec<_>>())))
}

#[derive(Deserialize)]
struct CreateUser {
    username: String,
    password: String,
    display_name: Option<String>,
    role: Option<String>,
    permissions: Option<i64>,
}

fn check_role(me: &User, role: &str) -> AppResult<()> {
    match role {
        "user" => Ok(()),
        "admin" if me.role == "owner" => Ok(()),
        "admin" => Err(AppError::forbidden("only the owner can create admins")),
        _ => Err(AppError::bad_request("role must be user or admin")),
    }
}

async fn create(
    State(state): State<AppState>,
    CurrentUser(me): CurrentUser,
    client: ClientInfo,
    Json(body): Json<CreateUser>,
) -> AppResult<Json<Value>> {
    me.require(perm::MANAGE_USERS)?;
    let role = body.role.unwrap_or_else(|| "user".into());
    check_role(&me, &role)?;
    let perms = body
        .permissions
        .unwrap_or(state.settings.default_permissions().await);
    if perms & perm::ADMIN != 0 && !me.can(perm::ADMIN) {
        return Err(AppError::forbidden("you can't grant administrator"));
    }
    let user = create_user(&state, &body.username, &body.password, body.display_name, &role, perms).await?;
    audit::log(&state, Some(&me), &client, "user.create", Some(user.username.clone()), None).await;
    Ok(Json(user_json(&user)))
}

#[derive(Deserialize)]
struct UpdateUser {
    display_name: Option<String>,
    role: Option<String>,
    permissions: Option<i64>,
    disabled: Option<bool>,
    password: Option<String>,
}

async fn load_user(state: &AppState, id: i64) -> AppResult<User> {
    sqlx::query_as(&format!("SELECT {USER_COLUMNS} FROM users WHERE id = ?"))
        .bind(id)
        .fetch_optional(&state.main)
        .await?
        .ok_or_else(|| AppError::not_found("user not found"))
}

async fn update(
    State(state): State<AppState>,
    CurrentUser(me): CurrentUser,
    client: ClientInfo,
    Path(id): Path<i64>,
    Json(body): Json<UpdateUser>,
) -> AppResult<Json<Value>> {
    me.require(perm::MANAGE_USERS)?;
    let target = load_user(&state, id).await?;
    if target.role == "owner" && me.role != "owner" {
        return Err(AppError::forbidden("only the owner can change the owner"));
    }
    if target.role == "admin" && me.role != "owner" && me.id != target.id {
        return Err(AppError::forbidden("only the owner can change admins"));
    }

    let mut changes = serde_json::Map::new();
    if let Some(name) = body.display_name {
        let name = name.trim().to_string();
        sqlx::query("UPDATE users SET display_name = ? WHERE id = ?")
            .bind((!name.is_empty()).then_some(&name))
            .bind(id)
            .execute(&state.main)
            .await?;
        changes.insert("display_name".into(), json!(name));
    }
    if let Some(role) = body.role.filter(|r| *r != target.role) {
        if target.role == "owner" {
            bail_bad_request!("the owner's role can't be changed");
        }
        check_role(&me, &role)?;
        sqlx::query("UPDATE users SET role = ? WHERE id = ?")
            .bind(&role)
            .bind(id)
            .execute(&state.main)
            .await?;
        changes.insert("role".into(), json!(role));
    }
    if let Some(perms) = body.permissions {
        if perms & perm::ADMIN != 0 && !me.can(perm::ADMIN) {
            return Err(AppError::forbidden("you can't grant administrator"));
        }
        sqlx::query("UPDATE users SET permissions = ? WHERE id = ?")
            .bind(perms)
            .bind(id)
            .execute(&state.main)
            .await?;
        changes.insert("permissions".into(), json!(perms));
    }
    if let Some(disabled) = body.disabled {
        if target.role == "owner" || target.id == me.id {
            bail_bad_request!("you can't disable this account");
        }
        sqlx::query("UPDATE users SET disabled = ? WHERE id = ?")
            .bind(disabled)
            .bind(id)
            .execute(&state.main)
            .await?;
        if disabled {
            sqlx::query("DELETE FROM sessions WHERE user_id = ?")
                .bind(id)
                .execute(&state.main)
                .await?;
        }
        changes.insert("disabled".into(), json!(disabled));
    }
    if let Some(pw) = body.password.filter(|p| !p.is_empty()) {
        password::validate(&pw).map_err(AppError::bad_request)?;
        let hash = password::hash_async(pw).await?;
        sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
            .bind(hash)
            .bind(id)
            .execute(&state.main)
            .await?;
        sqlx::query("DELETE FROM sessions WHERE user_id = ?")
            .bind(id)
            .execute(&state.main)
            .await?;
        changes.insert("password".into(), json!("reset"));
    }

    audit::log(
        &state,
        Some(&me),
        &client,
        "user.update",
        Some(target.username.clone()),
        Some(Value::Object(changes)),
    )
    .await;
    Ok(Json(user_json(&load_user(&state, id).await?)))
}

async fn remove(
    State(state): State<AppState>,
    CurrentUser(me): CurrentUser,
    client: ClientInfo,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    me.require(perm::MANAGE_USERS)?;
    let target = load_user(&state, id).await?;
    if target.role == "owner" || target.id == me.id {
        bail_bad_request!("this account can't be deleted");
    }
    if target.role == "admin" && me.role != "owner" {
        return Err(AppError::forbidden("only the owner can delete admins"));
    }
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(id)
        .execute(&state.main)
        .await?;
    audit::log(&state, Some(&me), &client, "user.delete", Some(target.username), None).await;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Serialize, sqlx::FromRow)]
struct Invite {
    code: String,
    permissions: i64,
    max_uses: i64,
    uses: i64,
    note: Option<String>,
    expires_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    created_by_name: Option<String>,
}

async fn list_invites(State(state): State<AppState>, CurrentUser(me): CurrentUser) -> AppResult<Json<Vec<Invite>>> {
    me.require(perm::MANAGE_USERS)?;
    let invites = sqlx::query_as(
        "SELECT i.code, i.permissions, i.max_uses, i.uses, i.note, i.expires_at, i.created_at,
                COALESCE(u.display_name, u.username) AS created_by_name
         FROM invites i LEFT JOIN users u ON u.id = i.created_by
         ORDER BY i.created_at DESC",
    )
    .fetch_all(&state.main)
    .await?;
    Ok(Json(invites))
}

#[derive(Deserialize)]
struct CreateInvite {
    permissions: Option<i64>,
    max_uses: Option<i64>,
    note: Option<String>,
    expires_in_days: Option<i64>,
}

async fn create_invite(
    State(state): State<AppState>,
    CurrentUser(me): CurrentUser,
    client: ClientInfo,
    Json(body): Json<CreateInvite>,
) -> AppResult<Json<Value>> {
    me.require(perm::MANAGE_USERS)?;
    let perms = body
        .permissions
        .unwrap_or(state.settings.default_permissions().await);
    if perms & perm::ADMIN != 0 {
        bail_bad_request!("invites can't grant administrator");
    }
    let code = util::random_token(9);
    let expires = body
        .expires_in_days
        .filter(|d| *d > 0)
        .map(|d| Utc::now() + Duration::days(d));
    sqlx::query(
        "INSERT INTO invites (code, created_by, permissions, max_uses, note, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&code)
    .bind(me.id)
    .bind(perms)
    .bind(body.max_uses.unwrap_or(1).max(0))
    .bind(body.note.filter(|n| !n.trim().is_empty()))
    .bind(expires)
    .bind(Utc::now())
    .execute(&state.main)
    .await?;
    audit::log(&state, Some(&me), &client, "invite.create", Some(code.clone()), None).await;
    Ok(Json(json!({ "code": code })))
}

async fn delete_invite(
    State(state): State<AppState>,
    CurrentUser(me): CurrentUser,
    client: ClientInfo,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    me.require(perm::MANAGE_USERS)?;
    sqlx::query("DELETE FROM invites WHERE code = ?")
        .bind(&code)
        .execute(&state.main)
        .await?;
    audit::log(&state, Some(&me), &client, "invite.delete", Some(code), None).await;
    Ok(Json(json!({ "ok": true })))
}
