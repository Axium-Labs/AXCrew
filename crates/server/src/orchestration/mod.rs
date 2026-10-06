//! Business processes.
//!
//! Everything that decides *what should happen next* lives here: dispatching the
//! task DAG, running automations, brokering tool approvals and enforcing the crew
//! configuration rules. Orchestration may read and write storage and may drive a
//! transport, but the API layer, the database and the UI never contain these
//! decisions.

pub mod approval;
pub mod connections;
pub mod crew;
pub mod distributed;
pub mod scheduler;
