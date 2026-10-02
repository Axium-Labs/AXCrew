//! The HTTP error boundary.
//!
//! Every handler failure becomes the same `400` + `{"error": "..."}` body the
//! clients have always parsed, so handlers only need `?` on any error type.

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

pub struct ApiError(pub anyhow::Error);

impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(error: E) -> Self {
        Self(error.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":self.0.to_string()})),
        )
            .into_response()
    }
}

/// `Result` alias for handlers returning JSON.
pub type Api<T> = std::result::Result<Json<T>, ApiError>;
