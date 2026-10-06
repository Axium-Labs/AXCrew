//! One module per aggregate. Every SQL statement for that aggregate lives here,
//! so "where is this table written" has exactly one answer.

pub mod automations;
pub mod connections;
pub mod crews;
pub mod devices;
pub mod distributed;
pub mod events;
pub mod pairing;
pub mod sessions;
pub mod settings;
pub mod tasks;
