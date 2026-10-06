//! Database format ownership: the schema and the open-time normalisation.
//!
//! Applying `schema.sql` on every open is the migration strategy — it is
//! idempotent (`CREATE TABLE IF NOT EXISTS` plus `PRAGMA user_version`), so a
//! database file is upgraded in place without a separate migration runner and
//! without a format change for existing files.

use anyhow::Result;
use rusqlite::Connection;

/// Bring a database file up to the format this build expects.
///
/// The follow-up statement is the only open-time data normalisation: a task left
/// `running` or `waiting_permission` by a previous process has no live transport
/// behind it, so it returns to `ready` and can be picked up again.
pub(crate) fn apply(conn: &Connection) -> Result<()> {
    conn.execute_batch(include_str!("schema.sql"))?;
    conn.execute("UPDATE devices SET status='offline' WHERE id IN (SELECT id FROM ssh_connections) AND revoked_at IS NULL", [])?;
    conn.execute(
        "UPDATE tasks SET status='ready' WHERE status IN ('running','waiting_permission')",
        [],
    )?;
    Ok(())
}
