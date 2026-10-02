//! `devices`: paired AX runtimes and their liveness.
//!
//! Business rules (validation, authorisation) live in `crate::orchestration`;
//! this module only reads and writes rows.

use crate::{domain::device::Device, storage::Db};
use anyhow::{Result, anyhow};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

impl Db {
    /// Registers (or refreshes) the `local` device this gateway runs on.
    pub fn bootstrap_local(&self, name: &str, ax_version: &str) -> Result<Device> {
        let db = self.0.lock().unwrap();
        db.execute("INSERT INTO devices(id,name,hostname,platform,arch,ax_version,protocol_version,capabilities_json,status,last_seen) VALUES('local',?1,?2,?3,?4,?5,1,'{}','online',unixepoch()) ON CONFLICT(id) DO UPDATE SET status='online',last_seen=unixepoch(),ax_version=excluded.ax_version", params![name,name,std::env::consts::OS,std::env::consts::ARCH,ax_version])?;
        device(&db, "local")?.ok_or_else(|| anyhow!("local device missing"))
    }
    pub fn devices(&self) -> Result<Vec<Device>> {
        let db = self.0.lock().unwrap();
        let mut s = db.prepare("SELECT id FROM devices WHERE revoked_at IS NULL ORDER BY name")?;
        s.query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .filter_map(|id| device(&db, &id).transpose())
            .collect::<Result<Vec<_>>>()
    }
    pub fn device(&self, id: &str) -> Result<Option<Device>> {
        device(&self.0.lock().unwrap(), id)
    }
    pub fn set_device_status(&self, id: &str, status: &str) -> Result<()> {
        self.0.lock().unwrap().execute(
            "UPDATE devices SET status=?2,last_seen=unixepoch() WHERE id=?1 AND revoked_at IS NULL",
            params![id, status],
        )?;
        Ok(())
    }
    pub fn heartbeat(&self, id: &str, info: &Value) -> Result<()> {
        self.0.lock().unwrap().execute("UPDATE devices SET last_seen=unixepoch(),capabilities_json=?2,ax_version=COALESCE(?3,ax_version),protocol_version=COALESCE(?4,protocol_version),status=CASE WHEN status='busy' THEN 'busy' ELSE 'online' END WHERE id=?1 AND revoked_at IS NULL",params![id,info["capabilities"].to_string(),info["ax_version"].as_str(),info["protocol_version"].as_i64()])?;
        Ok(())
    }
    pub fn rename_device(&self, id: &str, name: &str) -> Result<()> {
        let changed = self.0.lock().unwrap().execute(
            "UPDATE devices SET name=?2 WHERE id=?1 AND revoked_at IS NULL",
            params![id, name],
        )?;
        if changed == 0 {
            return Err(anyhow!("device not found"));
        }
        Ok(())
    }
    pub fn revoke_device(&self, id: &str) -> Result<()> {
        if id == "local" {
            return Err(anyhow!("local device cannot be revoked"));
        }
        let changed=self.0.lock().unwrap().execute("UPDATE devices SET revoked_at=unixepoch(),status='offline' WHERE id=?1 AND revoked_at IS NULL",[id])?;
        if changed == 0 {
            return Err(anyhow!("device not found"));
        }
        Ok(())
    }
}

/// Row mapper shared with the pairing flow, which inserts a device inside its
/// own transaction.
pub(crate) fn device(db: &Connection, id: &str) -> Result<Option<Device>> {
    Ok(db.query_row("SELECT id,name,hostname,platform,arch,ax_version,protocol_version,capabilities_json,status,last_seen,public_key FROM devices WHERE id=?1 AND revoked_at IS NULL",[id],|r|Ok(Device{id:r.get(0)?,name:r.get(1)?,hostname:r.get(2)?,platform:r.get(3)?,arch:r.get(4)?,ax_version:r.get(5)?,protocol_version:r.get(6)?,capabilities:serde_json::from_str(&r.get::<_,String>(7)?).unwrap_or(json!({})),status:r.get(8)?,last_seen:r.get(9)?,public_key:r.get(10)?})).optional()?)
}
