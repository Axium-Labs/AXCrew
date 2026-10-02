//! Persistence layer.
//!
//! This is the only module tree allowed to know about SQLite and rusqlite.
//! `schema.sql` and `migrations.rs` own the on-disk format, `sqlite.rs` owns the
//! connection handle, and `repositories/` holds every statement grouped by the
//! aggregate it serves.
//!
//! HTTP handlers, orchestration and the transports reach the database only
//! through the [`Db`] facade, so no SQL leaks into those layers. The `Db` type
//! stays a single façade on purpose: it keeps the storage boundary in one place
//! instead of scattering thin per-aggregate handles through every caller.

mod migrations;
pub mod repositories;
mod sqlite;

pub use sqlite::Db;

#[cfg(test)]
pub(crate) use sqlite::memory_db;
