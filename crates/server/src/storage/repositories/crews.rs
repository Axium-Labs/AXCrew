//! `crews` and `crew_members`: the persisted execution environments.
//!
//! Input validation lives in `crate::orchestration::crew`; this module only
//! enforces the referential rules that must run inside a transaction (crew and
//! device must exist, a member with bound sessions keeps its workspace).

use crate::{
    domain::crew::{Crew, LOCAL_CREW_ID, Member, NewCrew, NewMember},
    storage::Db,
    storage::repositories::devices::device,
};
use anyhow::{Result, anyhow};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;
use std::path::Path;
use uuid::Uuid;

impl Db {
    pub fn create_crew(&self, body: NewCrew) -> Result<Crew> {
        let db = self.0.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO crews(id,name) VALUES(?1,?2)",
            params![id, body.name],
        )?;
        crew(&db, &id)?.ok_or_else(|| anyhow!("crew missing"))
    }
    pub fn crews(&self) -> Result<Vec<Crew>> {
        let db = self.0.lock().unwrap();
        let mut s = db.prepare("SELECT id FROM crews ORDER BY created_at DESC")?;
        let ids = s
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.into_iter()
            .map(|id| crew(&db, &id)?.ok_or_else(|| anyhow!("crew missing")))
            .collect()
    }
    pub fn crew(&self, id: &str) -> Result<Option<Crew>> {
        crew(&self.0.lock().unwrap(), id)
    }
    pub fn create_member(&self, crew_id: &str, body: NewMember) -> Result<Member> {
        let db = self.0.lock().unwrap();
        if crew(&db, crew_id)?.is_none() {
            return Err(anyhow!("crew not found"));
        }
        if device(&db, &body.device_id)?.is_none() {
            return Err(anyhow!("device not found"));
        }
        let id = Uuid::new_v4().to_string();
        db.execute("INSERT INTO crew_members(id,crew_id,name,role,device_id,cwd,provider,model,skills_json,mcp_servers_json,permission_profile,max_concurrency) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",params![id,crew_id,body.name,body.role,body.device_id,body.cwd,body.provider,body.model,body.skills.to_string(),body.mcp_servers.to_string(),body.permission_profile,body.max_concurrency])?;
        member(&db, &id)?.ok_or_else(|| anyhow!("member missing"))
    }
    pub fn members(&self, crew_id: &str) -> Result<Vec<Member>> {
        let db = self.0.lock().unwrap();
        let mut s = db.prepare("SELECT id FROM crew_members WHERE crew_id=?1 ORDER BY name")?;
        let ids = s
            .query_map([crew_id], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.into_iter()
            .map(|id| member(&db, &id)?.ok_or_else(|| anyhow!("member missing")))
            .collect()
    }
    pub fn member(&self, id: &str) -> Result<Option<Member>> {
        member(&self.0.lock().unwrap(), id)
    }
    pub fn default_session_member(&self) -> Result<Option<Member>> {
        let db = self.0.lock().unwrap();
        // A remote path or a deleted historical project cannot be the local
        // composer's default. Keep the historical member unchanged for replay.
        let mut statement =
            db.prepare("SELECT id FROM crew_members WHERE device_id='local' ORDER BY rowid")?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for id in ids {
            if let Some(value) = member(&db, &id)? {
                let path = Path::new(&value.cwd);
                if path.is_absolute() && path.is_dir() {
                    return Ok(Some(value));
                }
            }
        }
        Ok(None)
    }
    /// Finds (or creates) the implicit local execution environment for a
    /// workspace. The workspace and provider/model preconditions are part of this
    /// method's contract and are asserted by the storage tests.
    pub fn ensure_local_session_member(
        &self,
        cwd: &str,
        provider: Option<&str>,
        model: Option<&str>,
    ) -> Result<Member> {
        let directory = Path::new(cwd);
        if !directory.is_absolute() || !directory.is_dir() {
            return Err(anyhow!(
                "工作目录不存在或不是绝对路径：{cwd}。请重新选择一个现有文件夹；消息内容已保留。"
            ));
        }
        if provider.is_some() != model.is_some() {
            return Err(anyhow!("provider and model must be selected together"));
        }
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let existing: Option<String> = tx.query_row(
            "SELECT id FROM crew_members WHERE device_id='local' AND cwd=?1 AND provider IS ?2 AND model IS ?3 ORDER BY rowid LIMIT 1",
            params![cwd, provider, model], |row| row.get(0),
        ).optional()?;
        if let Some(id) = existing {
            return member(&tx, &id)?.ok_or_else(|| anyhow!("local environment missing"));
        }
        tx.execute(
            "INSERT OR IGNORE INTO crews(id,name) VALUES(?1,'本地 AX')",
            [LOCAL_CREW_ID],
        )?;
        let id = Uuid::new_v4().to_string();
        tx.execute("INSERT INTO crew_members(id,crew_id,name,role,device_id,cwd,provider,model,skills_json,mcp_servers_json,permission_profile,max_concurrency) VALUES(?1,?2,'AX','本地运行环境','local',?3,?4,?5,'[]','[]','ask',1)", params![id,LOCAL_CREW_ID,cwd,provider,model])?;
        tx.commit()?;
        member(&db, &id)?.ok_or_else(|| anyhow!("local environment missing"))
    }
    /// Applies a validated member edit. Changing the device or workspace of a
    /// member that already owns AX sessions would orphan them, so it is rejected.
    pub fn update_member(&self, id: &str, body: NewMember) -> Result<Member> {
        let db = self.0.lock().unwrap();
        let current = member(&db, id)?.ok_or_else(|| anyhow!("member not found"))?;
        if device(&db, &body.device_id)?.is_none() {
            return Err(anyhow!("device not found"));
        }
        if current.device_id != body.device_id || current.cwd != body.cwd {
            let bound: i64 = db.query_row(
                "SELECT COUNT(*) FROM session_bindings WHERE member_id=?1",
                [id],
                |r| r.get(0),
            )?;
            if bound > 0 {
                return Err(anyhow!(
                    "member has AX sessions in the original workspace; create another member to change device or cwd"
                ));
            }
        }
        db.execute("UPDATE crew_members SET name=?2,role=?3,device_id=?4,cwd=?5,provider=?6,model=?7,skills_json=?8,mcp_servers_json=?9,permission_profile=?10,max_concurrency=?11 WHERE id=?1",params![id,body.name,body.role,body.device_id,body.cwd,body.provider,body.model,body.skills.to_string(),body.mcp_servers.to_string(),body.permission_profile,body.max_concurrency])?;
        member(&db, id)?.ok_or_else(|| anyhow!("member missing"))
    }
}

/// Row mapper shared with the task and session repositories, which resolve a
/// member while holding their own transaction.
pub(crate) fn crew(db: &Connection, id: &str) -> Result<Option<Crew>> {
    Ok(db
        .query_row(
            "SELECT id,name,created_at FROM crews WHERE id=?1",
            [id],
            |r| {
                Ok(Crew {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    created_at: r.get(2)?,
                })
            },
        )
        .optional()?)
}

pub(crate) fn member(db: &Connection, id: &str) -> Result<Option<Member>> {
    Ok(db.query_row("SELECT id,crew_id,name,role,device_id,cwd,provider,model,skills_json,mcp_servers_json,permission_profile,max_concurrency FROM crew_members WHERE id=?1",[id],|r|Ok(Member{id:r.get(0)?,crew_id:r.get(1)?,name:r.get(2)?,role:r.get(3)?,device_id:r.get(4)?,cwd:r.get(5)?,provider:r.get(6)?,model:r.get(7)?,skills:serde_json::from_str(&r.get::<_,String>(8)?).unwrap_or(json!([])),mcp_servers:serde_json::from_str(&r.get::<_,String>(9)?).unwrap_or(json!([])),permission_profile:r.get(10)?,max_concurrency:r.get(11)?})).optional()?)
}

#[cfg(test)]
mod workspace_tests {
    use super::*;
    use crate::storage::memory_db;

    #[test]
    fn local_default_skips_missing_workspaces_without_rewriting_history() {
        let db = memory_db();
        db.bootstrap_local("test", "test").unwrap();
        let root = std::env::temp_dir().join(format!("crew-workspace-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let cwd = root.to_string_lossy().into_owned();
        let member = db.ensure_local_session_member(&cwd, None, None).unwrap();
        assert_eq!(db.default_session_member().unwrap().unwrap().id, member.id);
        std::fs::remove_dir(&root).unwrap();
        assert!(db.default_session_member().unwrap().is_none());
        assert_eq!(db.member(&member.id).unwrap().unwrap().cwd, cwd);
        assert!(db.ensure_local_session_member(&cwd, None, None).is_err());
        assert!(
            db.ensure_local_session_member("relative", None, None)
                .is_err()
        );
        let current = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let valid = db
            .ensure_local_session_member(&current, None, None)
            .unwrap();
        assert_eq!(db.default_session_member().unwrap().unwrap().id, valid.id);
    }
}
