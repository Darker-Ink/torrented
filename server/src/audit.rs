//! Audit log helpers. Failures to log never fail the request.

use serde_json::Value;

use crate::{
    auth::{ClientInfo, User},
    state::AppState,
};

pub async fn log(
    state: &AppState,
    user: Option<&User>,
    client: &ClientInfo,
    action: &str,
    target: Option<String>,
    details: Option<Value>,
) {
    let result = sqlx::query(
        "INSERT INTO audit_log (user_id, username, action, target, details, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(user.map(|u| u.id))
    .bind(user.map(|u| u.username.clone()))
    .bind(action)
    .bind(target)
    .bind(details.map(|d| d.to_string()))
    .bind(&client.ip)
    .bind(chrono::Utc::now())
    .execute(&state.main)
    .await;
    if let Err(e) = result {
        tracing::warn!(error = %e, action, "failed to write audit log");
    }
}
