use anyhow::{Result, anyhow};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Clone)]
pub struct Db(pub Arc<Mutex<Connection>>);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub platform: String,
    pub arch: String,
    pub ax_version: String,
    pub protocol_version: i64,
    pub capabilities: Value,
    pub status: String,
    pub last_seen: i64,
    pub public_key: Option<String>,
}
/// 手机客户端的配对信息。code 用于二维码/手动输入（一次性、5 分钟），short_code 仅用于展示。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientPairingInfo {
    pub code: String,
    pub short_code: String,
    pub expires_at: i64,
}
/// 手机 redeem 配对码后的返回：待桌面确认。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientRedeem {
    pub status: String,
    pub device_id: String,
}
/// 已授权 / 待确认的手机设备（桌面端设备管理用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorizedClient {
    pub device_id: String,
    pub name: String,
    pub platform: String,
    pub status: String, // pending / authorized
    pub created_at: i64,
    pub last_active: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Crew {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Member {
    pub id: String,
    pub crew_id: String,
    pub name: String,
    pub role: String,
    pub device_id: String,
    pub cwd: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub skills: Value,
    pub mcp_servers: Value,
    pub permission_profile: String,
    pub max_concurrency: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub crew_id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub description: String,
    pub assigned_member: String,
    pub assigned_device: String,
    pub dependencies: Vec<String>,
    pub priority: i64,
    pub status: String,
    pub input: Value,
    pub output: Option<Value>,
    pub retry_count: i64,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct NewCrew {
    pub name: String,
}
#[derive(Debug, Deserialize)]
pub struct NewMember {
    pub name: String,
    pub role: String,
    pub device_id: String,
    pub cwd: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    #[serde(default = "empty_array")]
    pub skills: Value,
    #[serde(default = "empty_array")]
    pub mcp_servers: Value,
    #[serde(default = "default_permission")]
    pub permission_profile: String,
    #[serde(default = "one")]
    pub max_concurrency: i64,
}
#[derive(Debug, Deserialize)]
pub struct NewTask {
    pub crew_id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub assigned_member: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub priority: i64,
    pub input: Value,
}
#[derive(Debug, Deserialize)]
pub struct TaskEdit {
    pub title: String,
    pub description: String,
    pub assigned_member: String,
    pub parent_id: Option<String>,
    pub dependencies: Vec<String>,
    pub priority: i64,
    pub input: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub message: String,
    pub schedule_kind: String,
    pub interval_minutes: i64,
    pub daily_time: String,
    pub weekdays: String,
    pub utc_offset_minutes: i64,
    pub member_id: Option<String>,
    pub model: Option<String>,
    pub approval: String,
    pub silent: bool,
    pub strict_schedule: bool,
    pub hide_from_chat: bool,
    pub lean_context: bool,
    pub folder: Option<String>,
    pub enabled: bool,
    pub created_at: i64,
    pub last_run_at: Option<i64>,
    pub next_run_at: Option<i64>,
    pub run_count: i64,
    pub last_status: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct NewAutomation {
    pub name: String,
    pub message: String,
    #[serde(default = "schedule_kind")]
    pub schedule_kind: String,
    #[serde(default = "sixty")]
    pub interval_minutes: i64,
    #[serde(default = "morning")]
    pub daily_time: String,
    #[serde(default)]
    pub weekdays: String,
    #[serde(default = "utc_eight")]
    pub utc_offset_minutes: i64,
    #[serde(default)]
    pub member_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default = "approval")]
    pub approval: String,
    #[serde(default)]
    pub silent: bool,
    #[serde(default)]
    pub strict_schedule: bool,
    #[serde(default)]
    pub hide_from_chat: bool,
    #[serde(default)]
    pub lean_context: bool,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default = "enabled")]
    pub enabled: bool,
}
#[derive(Debug, Deserialize)]
pub struct PairingRequest {
    pub code: String,
    pub public_key: String,
    pub name: String,
    pub hostname: String,
    pub platform: String,
    pub arch: String,
    pub ax_version: String,
}
type TaskRow = (
    String,
    String,
    Option<String>,
    String,
    String,
    String,
    String,
    i64,
    String,
    String,
    Option<String>,
    i64,
    i64,
    Option<i64>,
    Option<i64>,
);
fn empty_array() -> Value {
    json!([])
}
fn default_permission() -> String {
    "ask".into()
}
fn one() -> i64 {
    1
}
fn sixty() -> i64 {
    60
}
fn utc_eight() -> i64 {
    480
}
fn schedule_kind() -> String {
    "interval".into()
}
fn morning() -> String {
    "09:00".into()
}
fn approval() -> String {
    "default".into()
}
fn enabled() -> bool {
    true
}

/// Wall-clock weekday of a Unix day, Monday = 1 … Sunday = 7.
fn weekday_of(local_day: i64) -> i64 {
    (local_day + 3).rem_euclid(7) + 1
}

/// Next trigger in Unix seconds for a local-time schedule.
pub fn next_run(
    kind: &str,
    interval_minutes: i64,
    daily_time: &str,
    weekdays: &str,
    utc_offset_minutes: i64,
    from: i64,
) -> i64 {
    if kind != "daily" && kind != "weekly" {
        return from + interval_minutes.max(1) * 60;
    }
    let (hour, minute) = daily_time
        .split_once(':')
        .and_then(|(hour, minute)| Some((hour.parse::<i64>().ok()?, minute.parse::<i64>().ok()?)))
        .unwrap_or((9, 0));
    let allowed = weekdays
        .split(',')
        .filter_map(|day| day.trim().parse::<i64>().ok())
        .collect::<Vec<_>>();
    let offset = utc_offset_minutes * 60;
    let local = from + offset;
    let target = hour.clamp(0, 23) * 3600 + minute.clamp(0, 59) * 60;
    for step in 0..9 {
        let day = local.div_euclid(86400) + step;
        if kind == "weekly" && !allowed.is_empty() && !allowed.contains(&weekday_of(day)) {
            continue;
        }
        let candidate = day * 86400 + target;
        if candidate > local {
            return candidate - offset;
        }
    }
    from + 86400
}

impl Db {
    pub fn issue_pairing(&self) -> Result<String> {
        let mut bytes = [0u8; 24];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        let code = URL_SAFE_NO_PAD.encode(bytes);
        let hash = format!("{:x}", Sha256::digest(code.as_bytes()));
        self.0.lock().unwrap().execute(
            "INSERT INTO pairings(code_hash,expires_at) VALUES(?1,unixepoch()+600)",
            [hash],
        )?;
        Ok(code)
    }
    pub fn redeem_pairing(&self, request: &PairingRequest) -> Result<Device> {
        let hash = format!("{:x}", Sha256::digest(request.code.as_bytes()));
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let changed=tx.execute("UPDATE pairings SET used_at=unixepoch() WHERE code_hash=?1 AND used_at IS NULL AND expires_at>unixepoch()",[hash])?;
        if changed != 1 {
            return Err(anyhow!("pairing code invalid, expired, or already used"));
        }
        let id = Uuid::new_v4().to_string();
        tx.execute("INSERT INTO devices(id,name,hostname,platform,arch,ax_version,protocol_version,capabilities_json,status,last_seen,public_key) VALUES(?1,?2,?3,?4,?5,?6,1,'{}','offline',unixepoch(),?7)",params![id,request.name,request.hostname,request.platform,request.arch,request.ax_version,request.public_key])?;
        let result = device(&tx, &id)?.ok_or_else(|| anyhow!("paired device missing"))?;
        tx.commit()?;
        Ok(result)
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
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(include_str!("schema.sql"))?;
        conn.execute(
            "UPDATE tasks SET status='ready' WHERE status IN ('running','waiting_permission')",
            [],
        )?;
        Ok(Self(Arc::new(Mutex::new(conn))))
    }
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
    /// 讯飞语音识别配置（桌面端写入，手机端读取）。未配置时返回 None。
    pub fn xfy_config(&self) -> Result<Option<Value>> {
        let db = self.0.lock().unwrap();
        let raw = db
            .query_row(
                "SELECT value_json FROM app_settings WHERE key='xfy'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        Ok(raw.and_then(|value| serde_json::from_str(&value).ok()))
    }
    pub fn set_xfy_config(&self, appid: &str, api_key: &str, api_secret: &str) -> Result<()> {
        let value = json!({"appid": appid, "api_key": api_key, "api_secret": api_secret}).to_string();
        let db = self.0.lock().unwrap();
        db.execute(
            "INSERT INTO app_settings(key, value_json) VALUES('xfy', ?1) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
            [&value],
        )?;
        Ok(())
    }
    pub fn device(&self, id: &str) -> Result<Option<Device>> {
        device(&self.0.lock().unwrap(), id)
    }
    pub fn create_crew(&self, body: NewCrew) -> Result<Crew> {
        if body.name.trim().is_empty() {
            return Err(anyhow!("crew name required"));
        }
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
        if body.max_concurrency < 1 {
            return Err(anyhow!("max_concurrency must be positive"));
        }
        if !matches!(body.permission_profile.as_str(), "ask" | "allow" | "deny") {
            return Err(anyhow!("permission_profile must be ask, allow, or deny"));
        }
        for (field, value) in [("skills", &body.skills), ("mcp_servers", &body.mcp_servers)] {
            if !value
                .as_array()
                .is_some_and(|list| list.iter().all(Value::is_string))
            {
                return Err(anyhow!("{field} must be an array of names"));
            }
        }
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
        let id: Option<String> = db.query_row(
            "SELECT id FROM crew_members ORDER BY CASE WHEN device_id='local' THEN 0 ELSE 1 END, rowid LIMIT 1",
            [],
            |row| row.get(0),
        ).optional()?;
        id.map(|id| member(&db, &id).and_then(|value| value.ok_or_else(|| anyhow!("member missing")))).transpose()
    }
    pub fn ensure_local_session_member(&self, cwd: &str, provider: Option<&str>, model: Option<&str>) -> Result<Member> {
        let directory = Path::new(cwd);
        if !directory.is_absolute() || !directory.is_dir() {
            return Err(anyhow!("workspace must be an existing absolute directory"));
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
        let crew_id = "ax-local";
        tx.execute("INSERT OR IGNORE INTO crews(id,name) VALUES(?1,'本地 AX')", [crew_id])?;
        let id = Uuid::new_v4().to_string();
        tx.execute("INSERT INTO crew_members(id,crew_id,name,role,device_id,cwd,provider,model,skills_json,mcp_servers_json,permission_profile,max_concurrency) VALUES(?1,?2,'AX','本地运行环境','local',?3,?4,?5,'[]','[]','ask',1)", params![id,crew_id,cwd,provider,model])?;
        tx.commit()?;
        member(&db, &id)?.ok_or_else(|| anyhow!("local environment missing"))
    }
    pub fn update_member(&self, id: &str, body: NewMember) -> Result<Member> {
        if body.name.trim().is_empty()
            || body.max_concurrency < 1
            || !matches!(body.permission_profile.as_str(), "ask" | "allow" | "deny")
            || ![&body.skills, &body.mcp_servers]
                .iter()
                .all(|v| v.as_array().is_some_and(|a| a.iter().all(Value::is_string)))
        {
            return Err(anyhow!("invalid member configuration"));
        }
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
    pub fn create_task(&self, body: NewTask) -> Result<Task> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let assigned =
            member(&tx, &body.assigned_member)?.ok_or_else(|| anyhow!("member not found"))?;
        if assigned.crew_id != body.crew_id {
            return Err(anyhow!("member belongs to another crew"));
        }
        for dep in &body.dependencies {
            let d = task(&tx, dep)?.ok_or_else(|| anyhow!("dependency {dep} not found"))?;
            if d.crew_id != body.crew_id {
                return Err(anyhow!("dependency belongs to another crew"));
            }
        }
        if body.title.trim().is_empty() {
            return Err(anyhow!("task title required"));
        }
        if let Some(parent) = &body.parent_id {
            let found = task(&tx, parent)?.ok_or_else(|| anyhow!("parent task not found"))?;
            if found.crew_id != body.crew_id {
                return Err(anyhow!("parent task belongs to another crew"));
            }
        }
        let id = Uuid::new_v4().to_string();
        tx.execute("INSERT INTO tasks(id,crew_id,parent_id,title,description,assigned_member,assigned_device,priority,status,input_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'pending',?9)",params![id,body.crew_id,body.parent_id,body.title,body.description,body.assigned_member,assigned.device_id,body.priority,body.input.to_string()])?;
        for dep in &body.dependencies {
            tx.execute(
                "INSERT INTO task_dependencies(task_id,depends_on_id) VALUES(?1,?2)",
                params![id, dep],
            )?;
        }
        let result = task(&tx, &id)?.ok_or_else(|| anyhow!("task missing"))?;
        tx.commit()?;
        Ok(result)
    }
    pub fn tasks(&self) -> Result<Vec<Task>> {
        let db = self.0.lock().unwrap();
        let mut s = db.prepare("SELECT id FROM tasks ORDER BY created_at,id")?;
        let ids = s
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.into_iter()
            .map(|id| task(&db, &id)?.ok_or_else(|| anyhow!("task missing")))
            .collect()
    }
    pub fn task(&self, id: &str) -> Result<Option<Task>> {
        task(&self.0.lock().unwrap(), id)
    }
    pub fn update_task(&self, id: &str, body: TaskEdit) -> Result<Task> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let current = task(&tx, id)?.ok_or_else(|| anyhow!("task not found"))?;
        if !matches!(current.status.as_str(), "pending" | "failed" | "cancelled") {
            return Err(anyhow!(
                "only pending, failed, or cancelled tasks can be edited"
            ));
        }
        if body.title.trim().is_empty() {
            return Err(anyhow!("task title required"));
        }
        let assigned =
            member(&tx, &body.assigned_member)?.ok_or_else(|| anyhow!("member not found"))?;
        if assigned.crew_id != current.crew_id {
            return Err(anyhow!("member belongs to another crew"));
        }
        if let Some(parent) = &body.parent_id
            && (parent == id || task(&tx, parent)?.is_none_or(|t| t.crew_id != current.crew_id))
        {
            return Err(anyhow!("invalid parent task"));
        }
        fn reaches(
            db: &Connection,
            start: &str,
            target: &str,
            seen: &mut std::collections::HashSet<String>,
        ) -> Result<bool> {
            if start == target {
                return Ok(true);
            }
            if !seen.insert(start.to_owned()) {
                return Ok(false);
            }
            if let Some(node) = task(db, start)? {
                for dep in node.dependencies {
                    if reaches(db, &dep, target, seen)? {
                        return Ok(true);
                    }
                }
            }
            Ok(false)
        }
        for dep in &body.dependencies {
            let found = task(&tx, dep)?.ok_or_else(|| anyhow!("dependency not found"))?;
            if found.crew_id != current.crew_id
                || reaches(&tx, dep, id, &mut std::collections::HashSet::new())?
            {
                return Err(anyhow!("invalid or cyclic dependency"));
            }
        }
        tx.execute("UPDATE tasks SET title=?2,description=?3,assigned_member=?4,assigned_device=?5,parent_id=?6,priority=?7,input_json=?8 WHERE id=?1",params![id,body.title,body.description,body.assigned_member,assigned.device_id,body.parent_id,body.priority,body.input.to_string()])?;
        tx.execute("DELETE FROM task_dependencies WHERE task_id=?1", [id])?;
        for dep in body.dependencies {
            tx.execute(
                "INSERT INTO task_dependencies(task_id,depends_on_id) VALUES(?1,?2)",
                params![id, dep],
            )?;
        }
        if assigned.device_id != current.assigned_device || assigned.id != current.assigned_member {
            tx.execute("DELETE FROM session_bindings WHERE task_id=?1", [id])?;
        }
        let updated = task(&tx, id)?.ok_or_else(|| anyhow!("task missing"))?;
        tx.commit()?;
        Ok(updated)
    }
    pub fn delete_task(&self, id: &str) -> Result<()> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let current = task(&tx, id)?.ok_or_else(|| anyhow!("task not found"))?;
        if matches!(
            current.status.as_str(),
            "running" | "ready" | "waiting_permission" | "waiting_user"
        ) {
            return Err(anyhow!("active task cannot be deleted"));
        }
        let references:i64=tx.query_row("SELECT (SELECT COUNT(*) FROM task_dependencies WHERE depends_on_id=?1)+(SELECT COUNT(*) FROM tasks WHERE parent_id=?1)",[id],|r|r.get(0))?;
        if references > 0 {
            return Err(anyhow!("task has dependents or children"));
        }
        tx.execute("DELETE FROM events WHERE task_id=?1", [id])?;
        tx.execute("DELETE FROM session_bindings WHERE task_id=?1", [id])?;
        tx.execute("DELETE FROM task_runs WHERE task_id=?1", [id])?;
        tx.execute("DELETE FROM task_dependencies WHERE task_id=?1", [id])?;
        tx.execute("DELETE FROM tasks WHERE id=?1", [id])?;
        tx.commit()?;
        Ok(())
    }
    pub fn events(&self, limit: i64, offset: i64) -> Result<Vec<Value>> {
        let db = self.0.lock().unwrap();
        let mut stmt=db.prepare("SELECT id,timestamp,kind,crew_id,member_id,device_id,task_id,session_id,payload_json FROM events ORDER BY timestamp DESC,rowid DESC LIMIT ?1 OFFSET ?2")?;
        let rows=stmt.query_map(params![limit.clamp(1,500),offset.max(0)],|r|Ok(json!({"event_id":r.get::<_,String>(0)?,"timestamp":r.get::<_,i64>(1)?,"kind":r.get::<_,String>(2)?,"crew_id":r.get::<_,Option<String>>(3)?,"member_id":r.get::<_,Option<String>>(4)?,"device_id":r.get::<_,Option<String>>(5)?,"task_id":r.get::<_,Option<String>>(6)?,"session_id":r.get::<_,Option<String>>(7)?,"payload":serde_json::from_str::<Value>(&r.get::<_,String>(8)?).unwrap_or(json!({}))})))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }
    pub fn set_status(&self, id: &str, status: &str, output: Option<Value>) -> Result<()> {
        let db = self.0.lock().unwrap();
        let changed=db.execute("UPDATE tasks SET status=?2,output_json=?3,started_at=CASE WHEN ?2='running' THEN unixepoch() ELSE started_at END,finished_at=CASE WHEN ?2 IN ('completed','failed','cancelled') THEN unixepoch() ELSE NULL END WHERE id=?1",params![id,status,output.map(|v|v.to_string())])?;
        if changed == 0 {
            return Err(anyhow!("task not found"));
        }
        Ok(())
    }
    pub fn retry(&self, id: &str) -> Result<()> {
        let db = self.0.lock().unwrap();
        let changed=db.execute("UPDATE tasks SET status='pending',retry_count=retry_count+1,output_json=NULL,started_at=NULL,finished_at=NULL WHERE id=?1 AND status IN ('failed','cancelled')",[id])?;
        if changed == 0 {
            return Err(anyhow!("task cannot be retried"));
        }
        Ok(())
    }
    pub fn start_run(&self, task: &Task) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        self.0.lock().unwrap().execute("INSERT INTO task_runs(id,task_id,attempt,status,started_at) VALUES(?1,?2,?3,'running',unixepoch())",params![id,task.id,task.retry_count+1])?;
        Ok(id)
    }
    pub fn finish_run(&self, task_id: &str, status: &str, error: Option<&str>) -> Result<()> {
        self.0.lock().unwrap().execute("UPDATE task_runs SET status=?2,finished_at=unixepoch(),error=?3 WHERE id=(SELECT id FROM task_runs WHERE task_id=?1 AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1)",params![task_id,status,error])?;
        Ok(())
    }
    pub fn binding(&self, id: &str) -> Result<Option<String>> {
        let db = self.0.lock().unwrap();
        Ok(db
            .query_row(
                "SELECT ax_session_id FROM session_bindings WHERE task_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?)
    }
    pub fn bind(&self, task: &Task, session: &str) -> Result<()> {
        self.0.lock().unwrap().execute("INSERT INTO session_bindings(task_id,member_id,device_id,ax_session_id) VALUES(?1,?2,?3,?4) ON CONFLICT(task_id) DO UPDATE SET ax_session_id=excluded.ax_session_id",params![task.id,task.assigned_member,task.assigned_device,session])?;
        Ok(())
    }
    pub fn event(&self, kind: &str, task: Option<&Task>, payload: &Value) -> Result<Value> {
        let db = self.0.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let (crew, member, assigned_device, task_id) = task.map_or((None, None, None, None), |t| {
            (
                Some(t.crew_id.as_str()),
                Some(t.assigned_member.as_str()),
                Some(t.assigned_device.as_str()),
                Some(t.id.as_str()),
            )
        });
        let device = assigned_device.or_else(|| payload["device_id"].as_str());
        let session = task_id.and_then(|t| {
            db.query_row(
                "SELECT ax_session_id FROM session_bindings WHERE task_id=?1",
                [t],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten()
        });
        // The live bus carries content; the durable event index never copies AX messages,
        // tool arguments, permission inputs, or the final assistant response.
        let stored_payload = match kind {
            "agent.message.delta" | "agent.message.completed" => {
                json!({"text_bytes":payload["content"]["text"].as_str().map_or(0,str::len)})
            }
            "permission.requested" => {
                json!({"request_id":payload["request_id"],"tool":payload["request"]["toolCall"]["title"]})
            }
            "tool.started" | "tool.completed" | "tool.failed" => {
                json!({"tool_call_id":payload["toolCallId"],"status":payload["status"]})
            }
            "task.completed" => json!({"completed":true}),
            _ => payload.clone(),
        };
        db.execute("INSERT INTO events(id,kind,crew_id,member_id,device_id,task_id,session_id,payload_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![id,kind,crew,member,device,task_id,session,stored_payload.to_string()])?;
        Ok(
            json!({"event_id":id,"timestamp":unix_now(),"kind":kind,"crew_id":crew,"member_id":member,"device_id":device,"task_id":task_id,"session_id":session,"payload":payload}),
        )
    }
    fn validate_automation(&self, body: &NewAutomation) -> Result<()> {
        if body.name.trim().is_empty() {
            return Err(anyhow!("schedule name required"));
        }
        if body.message.trim().is_empty() {
            return Err(anyhow!("schedule message required"));
        }
        if !matches!(body.schedule_kind.as_str(), "interval" | "daily" | "weekly") {
            return Err(anyhow!("schedule kind must be interval, daily, or weekly"));
        }
        if body.schedule_kind == "interval" && body.interval_minutes < 1 {
            return Err(anyhow!("interval must be at least one minute"));
        }
        if body.schedule_kind != "interval"
            && body
                .daily_time
                .split_once(':')
                .is_none_or(|(hour, minute)| {
                    hour.parse::<u32>().map(|hour| hour > 23).unwrap_or(true)
                        || minute.parse::<u32>().map(|minute| minute > 59).unwrap_or(true)
                })
        {
            return Err(anyhow!("time must use HH:MM"));
        }
        if body
            .weekdays
            .split(',')
            .any(|day| !day.trim().is_empty() && !(1..=7).contains(&day.trim().parse::<i64>().unwrap_or(0)))
        {
            return Err(anyhow!("weekdays must be numbers from 1 to 7"));
        }
        if !matches!(body.approval.as_str(), "default" | "auto" | "ask") {
            return Err(anyhow!("approval must be default, auto, or ask"));
        }
        if let Some(member) = &body.member_id {
            if self.member(member)?.is_none() {
                return Err(anyhow!("agent not found"));
            }
        }
        Ok(())
    }
    pub fn create_automation(&self, body: NewAutomation) -> Result<Automation> {
        self.validate_automation(&body)?;
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
        self.validate_automation(&body)?;
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
        let current = self.automation(id)?.ok_or_else(|| anyhow!("schedule not found"))?;
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
        self.automation(id)?.ok_or_else(|| anyhow!("schedule missing"))
    }
    pub fn set_automation_enabled(&self, id: &str, enabled: bool) -> Result<Automation> {
        let changed = self
            .0
            .lock()
            .unwrap()
            .execute("UPDATE automations SET enabled=?2 WHERE id=?1", params![id, enabled])?;
        if changed == 0 {
            return Err(anyhow!("schedule not found"));
        }
        if !enabled {
            return self.automation(id)?.ok_or_else(|| anyhow!("schedule missing"));
        }
        let current = self.automation(id)?.ok_or_else(|| anyhow!("schedule missing"))?;
        let next = next_run(
            &current.schedule_kind,
            current.interval_minutes,
            &current.daily_time,
            &current.weekdays,
            current.utc_offset_minutes,
            unix_now(),
        );
        self.0
            .lock()
            .unwrap()
            .execute("UPDATE automations SET next_run_at=?2 WHERE id=?1", params![id, next])?;
        self.automation(id)?.ok_or_else(|| anyhow!("schedule missing"))
    }
    pub fn start_automation_run(&self, automation_id: &str, task_id: Option<&str>) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        self.0.lock().unwrap().execute("INSERT INTO automation_runs(id,automation_id,task_id,status,started_at) VALUES(?1,?2,?3,'running',unixepoch())",params![id,automation_id,task_id])?;
        Ok(id)
    }
    pub fn finish_automation_run(&self, automation_id: &str, status: &str, detail: &str) -> Result<()> {
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
    // ---- 手机设备配对与授权：临时配对码 → 桌面确认 → 设备授权 ----
    pub fn issue_client_pairing(&self) -> Result<ClientPairingInfo> {
        let mut bytes = [0u8; 24];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        let code = URL_SAFE_NO_PAD.encode(bytes);
        let short = {
            let alnum: String = code
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .take(4)
                .collect();
            format!("AX-{}", alnum.to_ascii_uppercase())
        };
        let hash = format!("{:x}", Sha256::digest(code.as_bytes()));
        self.0.lock().unwrap().execute(
            "INSERT INTO client_pairings(code_hash,expires_at) VALUES(?1,unixepoch()+300)",
            [hash],
        )?;
        Ok(ClientPairingInfo { code, short_code: short, expires_at: unix_now() + 300 })
    }
    /// 手机提交配对码：标记为待桌面确认，返回临时 device_id（配对码一次性）。
    pub fn redeem_client_pairing(&self, code: &str, name: &str, platform: &str) -> Result<ClientRedeem> {
        let hash = format!("{:x}", Sha256::digest(code.as_bytes()));
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let device_id = Uuid::new_v4().to_string();
        let changed = tx.execute(
            "UPDATE client_pairings SET used_at=unixepoch(),device_id=?2,name=?3,platform=?4,status='pending' WHERE code_hash=?1 AND used_at IS NULL AND expires_at>unixepoch()",
            params![hash, device_id, name, platform],
        )?;
        if changed != 1 {
            return Err(anyhow!("配对码无效、已过期或已被使用"));
        }
        tx.commit()?;
        Ok(ClientRedeem { status: "pending".into(), device_id })
    }
    pub fn pending_client_authorizations(&self) -> Result<Vec<AuthorizedClient>> {
        let db = self.0.lock().unwrap();
        let mut s = db.prepare("SELECT device_id,name,platform,used_at FROM client_pairings WHERE status='pending' AND expires_at>unixepoch() ORDER BY used_at")?;
        let rows = s.query_map([], |r| {
            Ok(AuthorizedClient {
                device_id: r.get(0)?,
                name: r.get(1)?,
                platform: r.get(2)?,
                status: "pending".into(),
                created_at: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                last_active: 0,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    }
    pub fn client_authorizations(&self) -> Result<Vec<AuthorizedClient>> {
        let db = self.0.lock().unwrap();
        let mut s = db.prepare("SELECT device_id,name,platform,created_at,last_active FROM client_authorizations WHERE revoked_at IS NULL ORDER BY created_at")?;
        let rows = s.query_map([], |r| {
            Ok(AuthorizedClient {
                device_id: r.get(0)?,
                name: r.get(1)?,
                platform: r.get(2)?,
                status: "authorized".into(),
                created_at: r.get(3)?,
                last_active: r.get(4)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    }
    /// 桌面端允许：生成设备长期凭证（明文一次性下发，哈希持久化），写入授权表。
    pub fn confirm_client_device(&self, device_id: &str) -> Result<String> {
        let mut bytes = [0u8; 24];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        let credential = URL_SAFE_NO_PAD.encode(bytes);
        let hash = format!("{:x}", Sha256::digest(credential.as_bytes()));
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let changed = tx.execute(
            "UPDATE client_pairings SET status='confirmed',credential_pending=?2 WHERE device_id=?1 AND status='pending'",
            params![device_id, credential],
        )?;
        if changed != 1 {
            return Err(anyhow!("授权请求不存在或已处理"));
        }
        let row: (String, String, i64) = tx.query_row(
            "SELECT name,platform,used_at FROM client_pairings WHERE device_id=?1",
            [device_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, Option<i64>>(2)?.unwrap_or(0))),
        )?;
        tx.execute(
            "INSERT OR REPLACE INTO client_authorizations(device_id,name,platform,credential_hash,created_at,last_active) VALUES(?1,?2,?3,?4,?5,unixepoch())",
            params![device_id, row.0, row.1, hash, row.2],
        )?;
        tx.commit()?;
        Ok(credential)
    }
    pub fn deny_client_device(&self, device_id: &str) -> Result<()> {
        let changed = self
            .0
            .lock()
            .unwrap()
            .execute("UPDATE client_pairings SET status='denied' WHERE device_id=?1 AND status='pending'", [device_id])?;
        if changed == 0 {
            return Err(anyhow!("授权请求不存在或已处理"));
        }
        Ok(())
    }
    /// 手机轮询领取：confirmed → 返回一次性凭证；pending → None（继续等）；denied/过期 → Err。
    pub fn claim_client_credential(&self, code: &str) -> Result<Option<String>> {
        let hash = format!("{:x}", Sha256::digest(code.as_bytes()));
        let db = self.0.lock().unwrap();
        let row: Option<(String, Option<String>, i64)> = db
            .query_row(
                "SELECT status,credential_pending,expires_at FROM client_pairings WHERE code_hash=?1",
                [&hash],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        match row {
            None => Err(anyhow!("配对码已失效，请刷新后重新扫码")),
            Some((_, _, expires)) if expires <= unix_now() => Err(anyhow!("配对码已过期，请刷新后重新扫码")),
            Some((status, _, _)) if status == "denied" => Err(anyhow!("配对请求已被拒绝")),
            Some((_, pending, _)) => {
                if let Some(credential) = pending {
                    db.execute("DELETE FROM client_pairings WHERE code_hash=?1", [&hash])?;
                    Ok(Some(credential))
                } else {
                    Ok(None)
                }
            }
        }
    }
    /// 校验设备凭证（哈希、未撤销），返回 device_id 供 touch。
    pub fn credential_device(&self, given: &str) -> Option<String> {
        let hash = format!("{:x}", Sha256::digest(given.as_bytes()));
        let db = self.0.lock().unwrap();
        db.query_row(
            "SELECT device_id FROM client_authorizations WHERE credential_hash=?1 AND revoked_at IS NULL",
            [hash],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten()
    }
    pub fn touch_client(&self, device_id: &str) {
        let _ = self.0.lock().unwrap().execute(
            "UPDATE client_authorizations SET last_active=unixepoch() WHERE device_id=?1",
            [device_id],
        );
    }
    pub fn has_client_authorization(&self) -> bool {
        let db = self.0.lock().unwrap();
        db.query_row(
            "SELECT 1 FROM client_authorizations WHERE revoked_at IS NULL LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()
        .is_ok_and(|row| row.is_some())
    }
    pub fn revoke_client_authorization(&self, device_id: &str) -> Result<()> {
        let changed = self
            .0
            .lock()
            .unwrap()
            .execute(
                "UPDATE client_authorizations SET revoked_at=unixepoch() WHERE device_id=?1 AND revoked_at IS NULL",
                [device_id],
            )?;
        if changed == 0 {
            return Err(anyhow!("设备不存在或未授权"));
        }
        Ok(())
    }
}
fn automation(db: &Connection, id: &str) -> Result<Option<Automation>> {
    Ok(db.query_row("SELECT id,name,message,schedule_kind,interval_minutes,daily_time,weekdays,utc_offset_minutes,member_id,model,approval,silent,strict_schedule,hide_from_chat,lean_context,folder,enabled,created_at,last_run_at,next_run_at,run_count,last_status FROM automations WHERE id=?1",[id],|r|Ok(Automation{id:r.get(0)?,name:r.get(1)?,message:r.get(2)?,schedule_kind:r.get(3)?,interval_minutes:r.get(4)?,daily_time:r.get(5)?,weekdays:r.get(6)?,utc_offset_minutes:r.get(7)?,member_id:r.get(8)?,model:r.get(9)?,approval:r.get(10)?,silent:r.get(11)?,strict_schedule:r.get(12)?,hide_from_chat:r.get(13)?,lean_context:r.get(14)?,folder:r.get(15)?,enabled:r.get(16)?,created_at:r.get(17)?,last_run_at:r.get(18)?,next_run_at:r.get(19)?,run_count:r.get(20)?,last_status:r.get(21)?})).optional()?)
}

#[cfg(test)]
mod schedule_tests {
    use super::{next_run, weekday_of};

    const OFFSET: i64 = 480;

    #[test]
    fn interval_schedules_ahead_of_the_last_run() {
        assert_eq!(next_run("interval", 15, "09:00", "", OFFSET, 1_000), 1_000 + 900);
        assert_eq!(next_run("interval", 0, "09:00", "", OFFSET, 1_000), 1_060);
    }

    #[test]
    fn daily_lands_on_the_local_wall_clock_time() {
        let from = 1_790_237_713;
        let next = next_run("daily", 60, "09:00", "", OFFSET, from);
        assert!(next > from && next - from <= 86_400);
        assert_eq!((next + OFFSET * 60).rem_euclid(86_400), 9 * 3_600);
    }

    #[test]
    fn weekly_lands_on_an_allowed_weekday() {
        let from = 1_790_237_713;
        let next = next_run("weekly", 60, "08:45", "1", OFFSET, from);
        assert!(next > from && next - from <= 7 * 86_400);
        assert_eq!(weekday_of((next + OFFSET * 60).div_euclid(86_400)), 1);
        assert_eq!((next + OFFSET * 60).rem_euclid(86_400), 8 * 3_600 + 45 * 60);
    }

    #[test]
    fn weekdays_are_numbered_from_monday() {
        // 1970-01-01 was a Thursday.
        assert_eq!(weekday_of(0), 4);
        assert_eq!(weekday_of(4), 1);
        assert_eq!(weekday_of(3), 7);
    }
}
fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn device(db: &Connection, id: &str) -> Result<Option<Device>> {
    Ok(db.query_row("SELECT id,name,hostname,platform,arch,ax_version,protocol_version,capabilities_json,status,last_seen,public_key FROM devices WHERE id=?1 AND revoked_at IS NULL",[id],|r|Ok(Device{id:r.get(0)?,name:r.get(1)?,hostname:r.get(2)?,platform:r.get(3)?,arch:r.get(4)?,ax_version:r.get(5)?,protocol_version:r.get(6)?,capabilities:serde_json::from_str(&r.get::<_,String>(7)?).unwrap_or(json!({})),status:r.get(8)?,last_seen:r.get(9)?,public_key:r.get(10)?})).optional()?)
}
fn crew(db: &Connection, id: &str) -> Result<Option<Crew>> {
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
fn member(db: &Connection, id: &str) -> Result<Option<Member>> {
    Ok(db.query_row("SELECT id,crew_id,name,role,device_id,cwd,provider,model,skills_json,mcp_servers_json,permission_profile,max_concurrency FROM crew_members WHERE id=?1",[id],|r|Ok(Member{id:r.get(0)?,crew_id:r.get(1)?,name:r.get(2)?,role:r.get(3)?,device_id:r.get(4)?,cwd:r.get(5)?,provider:r.get(6)?,model:r.get(7)?,skills:serde_json::from_str(&r.get::<_,String>(8)?).unwrap_or(json!([])),mcp_servers:serde_json::from_str(&r.get::<_,String>(9)?).unwrap_or(json!([])),permission_profile:r.get(10)?,max_concurrency:r.get(11)?})).optional()?)
}
fn task(db: &Connection, id: &str) -> Result<Option<Task>> {
    let base:Option<TaskRow>=db.query_row("SELECT id,crew_id,parent_id,title,description,assigned_member,assigned_device,priority,status,input_json,output_json,retry_count,created_at,started_at,finished_at FROM tasks WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?,r.get(10)?,r.get(11)?,r.get(12)?,r.get(13)?,r.get(14)?))).optional()?;
    let Some((
        id,
        crew_id,
        parent_id,
        title,
        description,
        assigned_member,
        assigned_device,
        priority,
        status,
        input,
        output,
        retry_count,
        created_at,
        started_at,
        finished_at,
    )) = base
    else {
        return Ok(None);
    };
    let mut s = db.prepare("SELECT depends_on_id FROM task_dependencies WHERE task_id=?1")?;
    let dependencies = s
        .query_map([&id], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Some(Task {
        id,
        crew_id,
        parent_id,
        title,
        description,
        assigned_member,
        assigned_device,
        dependencies,
        priority,
        status,
        input: serde_json::from_str(&input)?,
        output: output.map(|v| serde_json::from_str(&v)).transpose()?,
        retry_count,
        created_at,
        started_at,
        finished_at,
    }))
}
