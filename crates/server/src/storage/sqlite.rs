//! The connection handle. Cheap to clone: every clone shares one connection
//! behind a mutex, which is exactly how the previous single-file `db.rs` behaved.

use anyhow::Result;
use rusqlite::Connection;
use std::{
    path::Path,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct Db(pub Arc<Mutex<Connection>>);

impl Db {
    /// Opens (creating if needed) the SQLite file and brings it up to date.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        super::migrations::apply(&conn)?;
        Ok(Self(Arc::new(Mutex::new(conn))))
    }
}

/// An isolated in-memory database with the production schema applied, used by
/// the storage regression tests.
#[cfg(test)]
pub(crate) fn memory_db() -> Db {
    let connection = Connection::open_in_memory().expect("in-memory sqlite");
    super::migrations::apply(&connection).expect("schema");
    Db(Arc::new(Mutex::new(connection)))
}
