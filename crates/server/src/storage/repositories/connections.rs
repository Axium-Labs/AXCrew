//! SSH metadata and named projects; existing device/member bindings remain authoritative.
use crate::{
    domain::connections::{Project, SshConnection},
    storage::Db,
};
use anyhow::{Result, anyhow};
use rusqlite::{OptionalExtension, params};

impl Db {
    pub fn ssh_connections(&self) -> Result<Vec<SshConnection>> {
        let db = self.0.lock().unwrap();
        let mut stmt=db.prepare("SELECT config FROM ssh_connections JOIN devices ON devices.id=ssh_connections.id WHERE revoked_at IS NULL ORDER BY name")?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.iter()
            .map(|raw| Ok(serde_json::from_str(raw)?))
            .collect()
    }
    pub fn ssh_connection(&self, id: &str) -> Result<Option<SshConnection>> {
        Ok(self.ssh_connections()?.into_iter().find(|c| c.id == id))
    }
    pub fn save_ssh(&self, config: &SshConnection) -> Result<()> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        tx.execute("INSERT INTO devices(id,name,hostname,platform,arch,ax_version,protocol_version,capabilities_json,status,last_seen) VALUES(?1,?2,?3,'ssh','unknown','unknown',1,'{}','offline',0)",params![config.id,config.name,config.host])?;
        tx.execute(
            "INSERT INTO ssh_connections(id,config) VALUES(?1,?2)",
            params![config.id, serde_json::to_string(config)?],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn projects(&self) -> Result<Vec<Project>> {
        let db = self.0.lock().unwrap();
        let mut stmt=db.prepare("SELECT projects.id,projects.name,device_id,cwd,member_id FROM projects JOIN crew_members ON crew_members.id=projects.member_id ORDER BY projects.rowid")?;
        Ok(stmt
            .query_map([], |r| {
                Ok(Project {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    device_id: r.get(2)?,
                    cwd: r.get(3)?,
                    member_id: r.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    }
    pub fn save_project(&self, project: &Project) -> Result<()> {
        self.0.lock().unwrap().execute(
            "INSERT INTO projects(id,name,member_id) VALUES(?1,?2,?3)",
            params![project.id, project.name, project.member_id],
        )?;
        Ok(())
    }
    pub fn remove_project(&self, id: &str) -> Result<()> {
        if self
            .0
            .lock()
            .unwrap()
            .execute("DELETE FROM projects WHERE id=?1", [id])?
            == 0
        {
            return Err(anyhow!("project not found"));
        }
        Ok(())
    }
    /// Caller validates the directory on its owning host before persisting it.
    pub fn ensure_remote_session_member(
        &self,
        device: &str,
        cwd: &str,
    ) -> Result<crate::domain::crew::Member> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let existing:Option<String>=tx.query_row("SELECT id FROM crew_members WHERE device_id=?1 AND cwd=?2 AND provider IS NULL AND model IS NULL ORDER BY rowid LIMIT 1",params![device,cwd],|r|r.get(0)).optional()?;
        if let Some(id) = existing {
            return super::crews::member(&tx, &id)?.ok_or_else(|| anyhow!("environment missing"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT OR IGNORE INTO crews(id,name) VALUES('ax-remote','远程 AX')",
            [],
        )?;
        tx.execute("INSERT INTO crew_members(id,crew_id,name,role,device_id,cwd,skills_json,mcp_servers_json,permission_profile,max_concurrency) VALUES(?1,'ax-remote','AX','远程运行环境',?2,?3,'[]','[]','ask',1)",params![id,device,cwd])?;
        tx.commit()?;
        super::crews::member(&db, &id)?.ok_or_else(|| anyhow!("environment missing"))
    }
}
