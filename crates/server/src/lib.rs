//! AXCrew control plane.
//!
//! The crate is organised as one clear responsibility per layer. Dependencies
//! point inward only, so no layer has to know how the ones below it work:
//!
//! ```text
//! api/            HTTP boundary: request -> validation -> orchestration -> response
//! app.rs          AppState: the object every handler receives
//! config/         command line and environment configuration
//! auth/           bearer-token primitives
//! orchestration/  business processes: scheduling, automations, approvals, crew rules
//! transport/      how work reaches AX: local ACP stdio and remote gateway runs
//! gateway/        the device WebSocket and its authenticated links
//! ax/             read-only adapter over the local AX stores
//! storage/        persistence: the only place that knows SQLite
//! domain/         pure models and schedule maths, depending on nothing
//! ```
//!
//! `main.rs` only wires these together: parse config, build [`app::App`], mount
//! the router and serve.

pub mod api;
pub mod app;
pub mod auth;
pub mod ax;
pub mod config;
pub mod domain;
pub mod error;
pub mod gateway;
pub mod orchestration;
pub mod storage;
pub mod transport;
