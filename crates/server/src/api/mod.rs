//! The HTTP boundary.
//!
//! One module per resource, and every handler follows the same shape:
//! `request -> validation -> orchestration/storage -> response`. Handlers never
//! run SQL, never schedule work and never talk to a transport directly — they
//! call into `crate::orchestration` or the `Db` facade and map the result.

pub mod automations;
pub mod channels;
pub mod composer;
pub mod connections;
pub mod crews;
pub mod devices;
pub mod distributed;
pub mod events;
pub mod local_ax;
pub mod pairing;
pub mod permissions;
pub mod sessions;
pub mod system;
pub mod tasks;

use crate::app::App;
use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{Method, header},
    routing::{delete, get, post},
};
use tower_http::cors::{AllowOrigin, CorsLayer};

/// Builds the complete REST/WebSocket surface.
///
/// The layers are applied in the same order as before: the body limit wraps the
/// routes, then the state is attached, then CORS wraps everything.
pub fn router(state: App) -> Router {
    Router::new()
        .route(
            "/api/channels/whatsapp/install",
            post(channels::install_whatsapp),
        )
        .route(
            "/api/messaging/teams",
            post(channels::teams_webhook).layer(DefaultBodyLimit::max(256 * 1024)),
        )
        .route("/api/channels", get(channels::status))
        .route(
            "/api/channels/{platform}",
            axum::routing::put(channels::update).delete(channels::disconnect),
        )
        .route("/api/channels/{platform}/pairing", post(channels::pairing))
        .route(
            "/api/channels/{platform}/peers/{id}/approve",
            post(channels::approve),
        )
        .route(
            "/api/channels/{platform}/peers/{id}",
            axum::routing::delete(channels::revoke),
        )
        .route("/api/channels/weixin/login", post(channels::weixin_login))
        .route(
            "/api/channels/weixin/login/status",
            post(channels::weixin_poll),
        )
        .route(
            "/api/environments/{id}/model",
            post(connections::select_model),
        )
        .route(
            "/api/connections/ssh",
            get(connections::ssh).post(connections::add_ssh),
        )
        .route("/api/connections/ssh/discover", get(connections::discover))
        .route(
            "/api/connections/ssh/{id}/connect",
            post(connections::connect),
        )
        .route("/api/devices/{id}/workspace", get(connections::workspace))
        .route(
            "/api/projects",
            get(connections::projects).post(connections::create_project),
        )
        .route("/api/projects/{id}", delete(connections::remove_project))
        .route("/api/distributed", get(distributed::state))
        .route("/api/distributed/catalog", get(distributed::catalog))
        .route("/api/distributed/events", get(distributed::events))
        .route("/api/distributed/enroll", post(distributed::enroll))
        .route(
            "/api/distributed/hosts/{id}",
            delete(distributed::remove_host),
        )
        .route(
            "/api/distributed/workflows/{id}",
            delete(distributed::remove_workflow),
        )
        .route(
            "/api/distributed/instances/{id}",
            axum::routing::delete(distributed::remove_instance),
        )
        .route("/api/distributed/batch", post(distributed::batch))
        .route(
            "/api/distributed/instances/{id}/manage",
            post(distributed::manage),
        )
        .route(
            "/api/distributed/worker/manage",
            post(distributed::management_poll),
        )
        .route(
            "/api/distributed/workflows/{id}/settings",
            post(distributed::workflow_settings),
        )
        .route(
            "/api/distributed/workflows/{id}/control/{action}",
            post(distributed::workflow_control),
        )
        .route(
            "/api/distributed/tasks/{id}/edit",
            post(distributed::edit_task),
        )
        .route(
            "/api/distributed/tasks/{id}/reassign",
            post(distributed::reassign),
        )
        .route(
            "/api/distributed/tasks/{id}/commands",
            post(distributed::command),
        )
        .route("/api/distributed/worker/inbox", post(distributed::inbox))
        .route(
            "/api/distributed/worker/commands/{id}",
            post(distributed::acknowledge),
        )
        .route(
            "/api/distributed/instances/{id}/capabilities",
            post(distributed::configure),
        )
        .route("/api/distributed/tasks", post(distributed::submit))
        .route("/api/distributed/plans", post(distributed::plan))
        .route("/api/distributed/placement", post(distributed::preview))
        .route("/api/distributed/tasks/{id}", get(distributed::task))
        .route(
            "/api/distributed/workflows/{id}",
            get(distributed::workflow),
        )
        .route(
            "/api/distributed/workflows/{id}/checkpoint",
            post(distributed::checkpoint),
        )
        .route(
            "/api/distributed/tasks/{id}/{action}",
            post(distributed::control),
        )
        .route("/api/distributed/worker/start", post(distributed::start))
        .route(
            "/api/distributed/worker/identity",
            get(distributed::identity),
        )
        .route(
            "/api/distributed/worker/heartbeat",
            post(distributed::heartbeat),
        )
        .route("/api/distributed/worker/report", post(distributed::report))
        .route(
            "/api/distributed/{kind}/{id}/enabled",
            post(distributed::enable),
        )
        .route(
            "/api/distributed/hosts/{id}/resources",
            post(distributed::resources),
        )
        .route("/api/distributed/artifacts", post(distributed::upload))
        .route(
            "/api/distributed/artifacts/{id}",
            get(distributed::download),
        )
        .route("/api/health", get(system::health))
        .route("/api/settings", get(system::settings))
        .route("/api/devices", get(devices::devices))
        .route("/api/devices/{id}", get(devices::device))
        .route(
            "/api/devices/{id}/capabilities",
            get(devices::device_capabilities),
        )
        .route("/api/devices/{id}/rename", post(devices::rename_device))
        .route("/api/devices/{id}/revoke", post(devices::revoke_device))
        .route("/api/crews", get(crews::crews).post(crews::create_crew))
        .route("/api/crews/{id}", get(crews::crew))
        .route(
            "/api/crews/{id}/members",
            get(crews::members).post(crews::create_member),
        )
        .route(
            "/api/crews/{id}/members/{member_id}",
            axum::routing::put(crews::update_member),
        )
        .route("/api/tasks", get(tasks::tasks).post(tasks::create_task))
        .route(
            "/api/tasks/{id}",
            get(tasks::task)
                .put(tasks::edit_task)
                .delete(tasks::delete_task),
        )
        .route("/api/tasks/{id}/start", post(tasks::start_task))
        .route("/api/tasks/{id}/cancel", post(tasks::cancel_task))
        .route("/api/tasks/{id}/retry", post(tasks::retry_task))
        .route(
            "/api/permissions/{id}/resolve",
            post(permissions::resolve_permission),
        )
        .route("/api/permissions", get(permissions::pending_permissions))
        .route(
            "/api/sessions",
            get(sessions::sessions).post(sessions::create_session),
        )
        .route("/api/sessions/attach", post(sessions::attach_session))
        .route(
            "/api/sessions/{id}",
            get(sessions::session).delete(sessions::delete_session),
        )
        .route("/api/sessions/{id}/history", get(sessions::session_history))
        .route("/api/sessions/{id}/answer", post(sessions::session_answer))
        .route(
            "/api/sessions/{id}/message",
            post(sessions::session_message),
        )
        .route("/api/ax/local", get(local_ax::local_ax_overview))
        .route("/api/usage", get(local_ax::usage))
        .route(
            "/api/ax/local/{session}",
            get(local_ax::local_ax_session).delete(local_ax::delete_local_session),
        )
        .route(
            "/api/automations",
            get(automations::automations).post(automations::create_automation),
        )
        .route("/api/automations/runs", get(automations::automation_runs))
        .route(
            "/api/automations/{id}",
            axum::routing::put(automations::update_automation)
                .delete(automations::delete_automation),
        )
        .route(
            "/api/automations/{id}/run",
            post(automations::run_automation),
        )
        .route(
            "/api/automations/{id}/toggle",
            post(automations::toggle_automation),
        )
        .route("/api/events", get(events::events_history))
        .route("/api/ws", get(events::ws))
        .route("/api/pairing", post(pairing::issue_pairing))
        .route("/api/pairing/redeem", post(pairing::redeem_pairing))
        .route("/api/pairing/client", post(pairing::issue_client_pairing))
        .route(
            "/api/pairing/client/redeem",
            post(pairing::redeem_client_pairing),
        )
        .route(
            "/api/pairing/client/status",
            post(pairing::claim_client_credential),
        )
        .route(
            "/api/authorizations",
            get(pairing::list_client_authorizations),
        )
        .route(
            "/api/authorizations/{id}/confirm",
            post(pairing::confirm_client_device),
        )
        .route(
            "/api/authorizations/{id}/deny",
            post(pairing::deny_client_device),
        )
        .route(
            "/api/authorizations/{id}",
            delete(pairing::revoke_client_authorization),
        )
        .route("/api/xfy", get(system::xfy_get).post(system::xfy_set))
        .route("/api/gateway/ws", get(events::gateway_ws))
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            phone_permissions,
        ))
        .with_state(state)
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list([
                    "http://tauri.localhost".parse().unwrap(),
                    "tauri://localhost".parse().unwrap(),
                    "http://localhost:1420".parse().unwrap(),
                    "http://127.0.0.1:1420".parse().unwrap(),
                ]))
                .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
                .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]),
        )
}

/// Enforce phone capabilities even when a phone uses the LAN HTTP surface.
async fn phone_permissions(
    axum::extract::State(app): axum::extract::State<App>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    if let Some(token) = crate::auth::header_bearer(request.headers())
        && app.db.credential_device(&token).is_some()
        && !(request.method() == axum::http::Method::GET && request.uri().path() == "/api/ws")
        && !crate::auth::phone::allowed(request.method().as_str(), request.uri().path())
    {
        return (axum::http::StatusCode::FORBIDDEN, "Phone permission denied").into_response();
    }
    next.run(request).await
}
