use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("not signed in")]
    Unauthorized,
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Upstream(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl AppError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::BadRequest(msg.into())
    }

    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::Forbidden(msg.into())
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }

    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::Conflict(msg.into())
    }

    fn status(&self) -> StatusCode {
        match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Upstream(_) => StatusCode::BAD_GATEWAY,
            Self::Database(sqlx::Error::RowNotFound) => StatusCode::NOT_FOUND,
            Self::Database(_) | Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();
        let message = match &self {
            Self::Database(sqlx::Error::RowNotFound) => "not found".to_string(),
            Self::Database(e) => {
                tracing::error!(error = %e, "database error");
                "database error".to_string()
            }
            Self::Internal(e) => {
                tracing::error!(error = format!("{e:#}"), "internal error");
                format!("{e:#}")
            }
            other => other.to_string(),
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

/// Shorthand for `Err(AppError::BadRequest(..))`.
#[macro_export]
macro_rules! bail_bad_request {
    ($($arg:tt)*) => {
        return Err($crate::error::AppError::BadRequest(format!($($arg)*)))
    };
}
