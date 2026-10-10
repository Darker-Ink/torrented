pub mod password;
pub mod permissions;

use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, FromRequestParts},
    http::{header, request::Parts},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
    util,
};

pub use permissions::perm;

pub const SESSION_COOKIE: &str = "torrented_session";
const SESSION_DAYS: i64 = 30;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub display_name: Option<String>,
    pub role: String,
    pub permissions: i64,
    pub disabled: bool,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
}

pub const USER_COLUMNS: &str =
    "id, username, display_name, role, permissions, disabled, created_at, last_seen_at";

impl User {
    pub fn effective_permissions(&self) -> i64 {
        match self.role.as_str() {
            "owner" | "admin" => self.permissions | perm::ADMIN,
            _ => self.permissions,
        }
    }

    pub fn can(&self, required: i64) -> bool {
        permissions::has(self.effective_permissions(), required)
    }

    pub fn require(&self, required: i64) -> AppResult<()> {
        if self.can(required) {
            Ok(())
        } else {
            Err(AppError::forbidden("you do not have permission to do that"))
        }
    }
}

/// Information about the caller that is useful for logging.
#[derive(Debug, Clone, Default)]
pub struct ClientInfo {
    pub ip: Option<String>,
    pub user_agent: Option<String>,
}

impl<S: Send + Sync> FromRequestParts<S> for ClientInfo {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let forwarded = parts
            .headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .map(|v| v.trim().to_string());
        let peer = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|c| c.0.ip().to_string());
        let user_agent = parts
            .headers
            .get(header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.chars().take(300).collect());
        Ok(Self {
            ip: forwarded.or(peer),
            user_agent,
        })
    }
}

fn token_from_parts(parts: &Parts) -> Option<String> {
    if let Some(auth) = parts.headers.get(header::AUTHORIZATION)
        && let Ok(value) = auth.to_str()
        && let Some(token) = value.strip_prefix("Bearer ")
    {
        return Some(token.trim().to_string());
    }
    CookieJar::from_headers(&parts.headers)
        .get(SESSION_COOKIE)
        .map(|c| c.value().to_string())
}

pub async fn user_from_token(state: &AppState, token: &str) -> AppResult<Option<User>> {
    let session_id = util::sha256_hex(token);
    let row: Option<(DateTime<Utc>, DateTime<Utc>, i64)> = sqlx::query_as(
        "SELECT expires_at, last_used_at, user_id FROM sessions WHERE id = ?",
    )
    .bind(&session_id)
    .fetch_optional(&state.main)
    .await?;
    let Some((expires_at, last_used_at, user_id)) = row else {
        return Ok(None);
    };
    let now = Utc::now();
    if expires_at < now {
        sqlx::query("DELETE FROM sessions WHERE id = ?")
            .bind(&session_id)
            .execute(&state.main)
            .await?;
        return Ok(None);
    }
    let user: Option<User> = sqlx::query_as(&format!(
        "SELECT {USER_COLUMNS} FROM users WHERE id = ? AND disabled = 0"
    ))
    .bind(user_id)
    .fetch_optional(&state.main)
    .await?;

    // Sliding expiry, but only touch the database every few minutes.
    if user.is_some() && now - last_used_at > Duration::minutes(5) {
        let expires = now + Duration::days(SESSION_DAYS);
        sqlx::query("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?")
            .bind(now)
            .bind(expires)
            .bind(&session_id)
            .execute(&state.main)
            .await?;
        sqlx::query("UPDATE users SET last_seen_at = ? WHERE id = ?")
            .bind(now)
            .bind(user_id)
            .execute(&state.main)
            .await?;
    }
    Ok(user)
}

/// Extractor for a signed-in user. Rejects with 401 otherwise.
pub struct CurrentUser(pub User);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = token_from_parts(parts).ok_or(AppError::Unauthorized)?;
        let user = user_from_token(state, &token)
            .await?
            .ok_or(AppError::Unauthorized)?;
        Ok(Self(user))
    }
}

/// Like [`CurrentUser`] but never rejects.
pub struct MaybeUser(pub Option<User>);

impl FromRequestParts<AppState> for MaybeUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        match token_from_parts(parts) {
            Some(token) => Ok(Self(user_from_token(state, &token).await?)),
            None => Ok(Self(None)),
        }
    }
}

/// Create a session row and return the cookie that carries its token.
pub async fn create_session(
    state: &AppState,
    user_id: i64,
    client: &ClientInfo,
) -> AppResult<Cookie<'static>> {
    let token = util::random_token(32);
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO sessions (id, user_id, user_agent, ip, created_at, last_used_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(util::sha256_hex(&token))
    .bind(user_id)
    .bind(&client.user_agent)
    .bind(&client.ip)
    .bind(now)
    .bind(now)
    .bind(now + Duration::days(SESSION_DAYS))
    .execute(&state.main)
    .await?;
    sqlx::query("UPDATE users SET last_seen_at = ? WHERE id = ?")
        .bind(now)
        .bind(user_id)
        .execute(&state.main)
        .await?;
    Ok(session_cookie(state, token, Duration::days(SESSION_DAYS)))
}

pub fn session_cookie(state: &AppState, token: String, max_age: Duration) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, token))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(state.config.secure_cookies)
        .max_age(time_duration(max_age))
        .build()
}

fn time_duration(d: Duration) -> time::Duration {
    time::Duration::seconds(d.num_seconds())
}

pub async fn destroy_session(state: &AppState, jar: &CookieJar) -> AppResult<()> {
    if let Some(cookie) = jar.get(SESSION_COOKIE) {
        sqlx::query("DELETE FROM sessions WHERE id = ?")
            .bind(util::sha256_hex(cookie.value()))
            .execute(&state.main)
            .await?;
    }
    Ok(())
}
