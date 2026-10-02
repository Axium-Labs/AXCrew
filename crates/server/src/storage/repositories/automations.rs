//! `automations` and `automation_runs`.
//!
//! Schedule validation lives in `crate::orchestration::scheduler` (the module
//! that owns the automation lifecycle); the wall-clock maths lives in
//! `crate::domain::automation`. This module only persists the definition and
//! moves the next-trigger cursor.

use crate::{
    domain::automation::{Automation, NewAutomation, next_run},
    domain::unix_now,
    storage::Db,
};
use anyhow::{Result, anyhow};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use uuid::Uuid;

impl Db {
    pub fn create_automation(&self, body: NewAutomation) -> Result<Automation> {
        let id = Uuid::new_v4().to_string();
        let next = next_run(
            &body.schedule_kind,
            body.interval_minutes,
            &body.daily_time,
            &body.weekdays,
            body.utc_offset_minutes,
            unix_now(),
        );
        let db = self.0.lock().unwrap();
        db.execute("INSERT INTO automations(id,name,message,schedule_kind,interval_minutes,daily_time,weekdays,utc_offset_minutes,member_id,model,approval,silent,strict_schedule,hide_from_chat,lean_context,folder,enabled,next_run_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",params![id,body.name,body.message,body.schedule_kind,body.interval_minutes,body.daily_time,body.weekdays,body.utc_offset_minutes,body.member_id,body.model,body.approval,body.silent,body.strict_schedule,body.hide_from_chat,body.lean_context,body.folder,body.enabled,next])?;
        automation(&db, &id)?.ok_or_else(|| anyhow!("schedule missing"))
    }
    pub fn update_automation(&self, id: &str, body: NewAutomation) -> Result<Automation> {
        let next = next_run(
            &body.schedule_kind,
            body.interval_minutes,
            &body.daily_time,
            &body.weekdays,
            body.utc_offset_minutes,
            unix_now(),
        );
        let db = self.0.lock().unwrap();
        let changed=db.execute("UPDATE automations SET name=?2,message=?3,schedule_kind=?4,interval_minutes=?5,daily_time=?6,weekdays=?7,utc_offset_minutes=?8,member_id=?9,model=?10,approval=?11,silent=?12,strict_schedule=?13,hide_from_chat=?14,lean_context=?15,folder=?16,enabled=?17,next_run_at=?18 WHERE id=?1",params![id,body.name,body.message,body.schedule_kind,body.interval_minutes,body.daily_time,body.weekdays,body.utc_offset_minutes,body.member_id,body.model,body.approval,body.silent,body.strict_schedule,body.hide_from_chat,body.lean_context,body.folder,body.enabled,next])?;
        if changed == 0 {
            return Err(anyhow!("schedule not found"));
        }
        automation(&db, id)?.ok_or_else(|| anyhow!("schedule missing"))
    }
    pub fn delete_automation(&self, id: &str) -> Result<()> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        // Remove dependent run records first; SQLite enforces the foreign key immediately.
        tx.execute("DELETE FROM automation_runs WHERE automation_id=?1", [id])?;
        let changed = tx.execute("DELETE FROM automations WHERE id=?1", [id])?;
        if changed == 0 {
            return Err(anyhow!("schedule not found"));
        }
        tx.commit()?;
        Ok(())
    }
    pub fn automations(&self) -> Result<Vec<Automation>> {
        let db = self.0.lock().unwrap();
        let mut s = db.prepare("SELECT id FROM automations ORDER BY created_at DESC")?;
        let ids = s
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.into_iter()
            .map(|id| automation(&db, &id)?.ok_or_else(|| anyhow!("schedule missing")))
            .collect()
    }
    pub fn automation(&self, id: &str) -> Result<Option<Automation>> {
        automation(&self.0.lock().unwrap(), id)
    }
    pub fn due_automations(&self, now: i64) -> Result<Vec<Automation>> {
        Ok(self
            .automations()?
            .into_iter()
            .filter(|item| item.enabled && item.next_run_at.is_none_or(|next| next <= now))
            .collect())
    }
    /// Records a launch without moving the schedule forward (manual "run now").
    pub fn record_automation_launch(&self, id: &str, status: &str) -> Result<()> {
        self.0.lock().unwrap().execute("UPDATE automations SET last_run_at=unixepoch(),run_count=run_count+1,last_status=?2 WHERE id=?1",params![id,status])?;
        Ok(())
    }
    pub fn schedule_next(&self, id: &str, status: &str) -> Result<Automation> {
        let current = self
            .automation(id)?
            .ok_or_else(|| anyhow!("schedule not found"))?;
        let now = unix_now();
        let next = next_run(
            &current.schedule_kind,
            current.interval_minutes,
            &current.daily_time,
            &current.weekdays,
            current.utc_offset_minutes,
            now,
        );
        self.0.lock().unwrap().execute("UPDATE automations SET last_run_at=?2,next_run_at=?3,run_count=run_count+1,last_status=?4 WHERE id=?1",params![id,now,next,status])?;
        self.automation(id)?
            .ok_or_else(|| anyhow!("schedule missing"))
    }
    pub fn set_automation_enabled(&self, id: &str, enabled: bool) -> Result<Automation> {
        let changed = self.0.lock().unwrap().execute(
            "UPDATE automations SET enabled=?2 WHERE id=?1",
            params![id, enabled],
        )?;
        if changed == 0 {
            return Err(anyhow!("schedule not found"));
        }
        if !enabled {
            return self
                .automation(id)?
                .ok_or_else(|| anyhow!("schedule missing"));
        }
        let current = self
            .automation(id)?
            .ok_or_else(|| anyhow!("schedule missing"))?;
        let next = next_run(
            &current.schedule_kind,
            current.interval_minutes,
            &current.daily_time,
            &current.weekdays,
            current.utc_offset_minutes,
            unix_now(),
        );
        self.0.lock().unwrap().execute(
            "UPDATE automations SET next_run_at=?2 WHERE id=?1",
            params![id, next],
        )?;
        self.automation(id)?
            .ok_or_else(|| anyhow!("schedule missing"))
    }
    pub fn start_automation_run(
        &self,
        automation_id: &str,
        task_id: Option<&str>,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        self.0.lock().unwrap().execute("INSERT INTO automation_runs(id,automation_id,task_id,status,started_at) VALUES(?1,?2,?3,'running',unixepoch())",params![id,automation_id,task_id])?;
        Ok(id)
    }
    pub fn finish_automation_run(
        &self,
        automation_id: &str,
        status: &str,
        detail: &str,
    ) -> Result<()> {
        self.0.lock().unwrap().execute("UPDATE automation_runs SET status=?2,finished_at=unixepoch(),detail=?3 WHERE id=(SELECT id FROM automation_runs WHERE automation_id=?1 ORDER BY started_at DESC,rowid DESC LIMIT 1)",params![automation_id,status,detail])?;
        Ok(())
    }
    pub fn automation_runs(&self, limit: i64) -> Result<Vec<Value>> {
        let db = self.0.lock().unwrap();
        let mut s=db.prepare("SELECT r.id,r.automation_id,r.task_id,COALESCE(t.status,r.status),r.started_at,COALESCE(t.finished_at,r.finished_at),r.detail,a.name FROM automation_runs r LEFT JOIN tasks t ON t.id=r.task_id LEFT JOIN automations a ON a.id=r.automation_id ORDER BY r.started_at DESC,r.rowid DESC LIMIT ?1")?;
        let rows=s.query_map([limit.clamp(1,500)],|r|Ok(json!({"id":r.get::<_,String>(0)?,"automation_id":r.get::<_,String>(1)?,"task_id":r.get::<_,Option<String>>(2)?,"status":r.get::<_,String>(3)?,"started_at":r.get::<_,i64>(4)?,"finished_at":r.get::<_,Option<i64>>(5)?,"detail":r.get::<_,Option<String>>(6)?,"name":r.get::<_,Option<String>>(7)?})))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }
}

fn automation(db: &Connection, id: &str) -> Result<Option<Automation>> {
    Ok(db.query_row("SELECT id,name,message,schedule_kind,interval_minutes,daily_time,weekdays,utc_offset_minutes,member_id,model,approval,silent,strict_schedule,hide_from_chat,lean_context,folder,enabled,created_at,last_run_at,next_run_at,run_count,last_status FROM automations WHERE id=?1",[id],|r|Ok(Automation{id:r.get(0)?,name:r.get(1)?,message:r.get(2)?,schedule_kind:r.get(3)?,interval_minutes:r.get(4)?,daily_time:r.get(5)?,weekdays:r.get(6)?,utc_offset_minutes:r.get(7)?,member_id:r.get(8)?,model:r.get(9)?,approval:r.get(10)?,silent:r.get(11)?,strict_schedule:r.get(12)?,hide_from_chat:r.get(13)?,lean_context:r.get(14)?,folder:r.get(15)?,enabled:r.get(16)?,created_at:r.get(17)?,last_run_at:r.get(18)?,next_run_at:r.get(19)?,run_count:r.get(20)?,last_status:r.get(21)?})).optional()?)
}
