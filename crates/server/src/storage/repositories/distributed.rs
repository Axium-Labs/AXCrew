//! A transactional durable aggregate gives the control plane one state head.
//! The SQL transaction also protects against two server processes sharing a DB.
use crate::{domain::distributed::Cluster, storage::Db};
use anyhow::Result;
use rusqlite::TransactionBehavior;

impl Db {
    pub fn cluster_read(&self) -> Result<Cluster> {
        let conn = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let raw: String = conn.query_row(
            "SELECT state FROM distributed_cluster WHERE id=1",
            [],
            |r| r.get(0),
        )?;
        Ok(serde_json::from_str(&raw)?)
    }
    pub fn cluster_update<T>(&self, update: impl FnOnce(&mut Cluster) -> Result<T>) -> Result<T> {
        let mut conn = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let raw: String = tx.query_row(
            "SELECT state FROM distributed_cluster WHERE id=1",
            [],
            |r| r.get(0),
        )?;
        let mut state: Cluster = serde_json::from_str(&raw)?;
        let result = update(&mut state)?;
        tx.execute(
            "UPDATE distributed_cluster SET state=?1 WHERE id=1",
            [serde_json::to_string(&state)?],
        )?;
        tx.commit()?;
        Ok(result)
    }
    pub fn cluster_blob_put(&self, hash: &str, bytes: &[u8]) -> Result<()> {
        let conn = self.0.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute(
            "INSERT OR IGNORE INTO distributed_blobs(sha256,content) VALUES(?1,?2)",
            rusqlite::params![hash, bytes],
        )?;
        Ok(())
    }
    pub fn cluster_blob_get(&self, hash: &str) -> Result<Vec<u8>> {
        let conn = self.0.lock().unwrap_or_else(|p| p.into_inner());
        Ok(conn.query_row(
            "SELECT content FROM distributed_blobs WHERE sha256=?1",
            [hash],
            |r| r.get(0),
        )?)
    }
}
