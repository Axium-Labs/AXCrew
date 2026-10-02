//! `/api/events`, `/api/ws` and `/api/gateway/ws`: the live and historical event
//! surfaces.
//!
//! `/api/events` reads the redacted durable index; `/api/ws` streams the full
//! in-process bus; `/api/gateway/ws` is the device endpoint handled by
//! `crate::gateway`.

use crate::{app::App, error::Api};
use axum::{
    Json,
    extract::{
        Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use tokio::sync::broadcast;

#[derive(Deserialize)]
pub struct EventsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

pub async fn events_history(
    State(app): State<App>,
    headers: HeaderMap,
    Query(query): Query<EventsQuery>,
) -> Api<Vec<Value>> {
    app.authorize(&headers)?;
    Ok(Json(app.db.events(
        query.limit.unwrap_or(100),
        query.offset.unwrap_or(0),
    )?))
}

pub async fn ws(
    State(app): State<App>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    upgrade: WebSocketUpgrade,
) -> Response {
    if let Err(e) = app.authorize_ws(&headers, &query) {
        return e.into_response();
    }
    upgrade
        .on_upgrade(move |socket| stream_events(socket, app.events.subscribe()))
        .into_response()
}

async fn stream_events(mut socket: WebSocket, mut rx: broadcast::Receiver<Value>) {
    loop {
        // Poll inbound control frames even while idle. OkHttp and other native
        // clients use Ping/Pong to detect dead connections; browser clients do not.
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Ping(data))) => {
                    if socket.send(Message::Pong(data)).await.is_err() { break; }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            },
            event = rx.recv() => match event {
                Ok(event) => {
                    if socket.send(Message::Text(event.to_string().into())).await.is_err() { break; }
                }
                // Force a resync instead of silently losing a permission or delta.
                Err(broadcast::error::RecvError::Lagged(_)) => break,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }
}

/// The device gateway endpoint. It is authenticated by the Ed25519 handshake
/// inside `Gateway::accept`, not by a bearer token.
pub async fn gateway_ws(State(app): State<App>, upgrade: WebSocketUpgrade) -> impl IntoResponse {
    upgrade.on_upgrade(move |socket| async move {
        if let Err(e) = app.gateway.accept(socket).await {
            eprintln!("gateway: {e}");
        }
    })
}
