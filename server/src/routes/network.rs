//! Admin endpoints for the VPN and seedbox settings.

use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    audit,
    auth::{ClientInfo, CurrentUser, perm},
    error::{AppError, AppResult},
    network, seedbox, settings,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/network", get(status))
        .route("/admin/network/apply", post(apply))
        .route("/admin/network/check-ip", post(check_ip))
        .route("/admin/seedbox/test", post(test_seedbox))
}

async fn status_json(state: &AppState) -> Value {
    let seedbox = seedbox::Config::load(&state.settings).await;
    json!({
        "torrents": state.engine.status(),
        "vpn_mode": state.settings.get("vpn_mode").await,
        "wireguard_supported": cfg!(target_os = "linux"),
        "seedbox": seedbox.map(|c| json!({ "provider": "torbox", "mode": c.mode, "add_on_import": c.add_on_import })),
    })
}

async fn status(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> AppResult<Json<Value>> {
    user.require(perm::MANAGE_SETTINGS)?;
    Ok(Json(status_json(&state).await))
}

/// Restart the torrent session with the saved VPN and seedbox settings.
async fn apply(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
) -> AppResult<Json<Value>> {
    user.require(perm::MANAGE_SETTINGS)?;
    network::apply(&state).await;
    let status = state.engine.status();
    audit::log(
        &state,
        Some(&user),
        &client,
        "network.apply",
        Some(status.route.clone()),
        Some(json!({ "state": status.state, "error": status.error })),
    )
    .await;
    Ok(Json(status_json(&state).await))
}

async fn check_ip(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> AppResult<Json<Value>> {
    user.require(perm::MANAGE_SETTINGS)?;
    Ok(Json(json!(network::check_ip(&state.engine.net()).await)))
}

#[derive(Deserialize)]
struct TestSeedbox {
    api_key: Option<String>,
}

async fn test_seedbox(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<TestSeedbox>,
) -> AppResult<Json<Value>> {
    user.require(perm::MANAGE_SETTINGS)?;
    let key = match body.api_key.filter(|k| !k.trim().is_empty() && !settings::is_masked(k)) {
        Some(k) => k.trim().to_string(),
        None => state.settings.get("seedbox_api_key").await,
    };
    if key.is_empty() {
        return Err(AppError::bad_request("enter an API key first"));
    }
    match state.seedbox.test(&key).await {
        Ok(me) => Ok(Json(json!({
            "ok": true,
            "email": me.get("email"),
            "plan": me.get("plan"),
            "premium_expires_at": me.get("premium_expires_at"),
        }))),
        Err(e) => Ok(Json(json!({ "ok": false, "error": format!("{e:#}") }))),
    }
}
