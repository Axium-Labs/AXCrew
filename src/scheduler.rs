use crate::{
    db::{Db, NewTask, Task},
    transport::{Transport, TransportEvent},
};
use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::sync::{broadcast, mpsc, watch};
type Running = Arc<Mutex<HashMap<String, (String, watch::Sender<bool>)>>>;

#[derive(Clone)]
pub struct Scheduler {
    db: Db,
    transport: Arc<dyn Transport>,
    events: broadcast::Sender<Value>,
    running: Running,
    max_concurrency: usize,
}
impl Scheduler {
    pub fn new(
        db: Db,
        transport: Arc<dyn Transport>,
        events: broadcast::Sender<Value>,
        max_concurrency: usize,
    ) -> Self {
        Self {
            db,
            transport,
            events,
            running: Arc::new(Mutex::new(HashMap::new())),
            max_concurrency: max_concurrency.max(1),
        }
    }
    pub fn emit(&self, kind: &str, task: Option<&Task>, payload: Value) {
        if let Ok(event) = self.db.event(kind, task, &payload) {
            let _ = self.events.send(event);
        }
    }
    pub fn start(&self, id: &str) -> Result<Task> {
        let task = self.db.task(id)?.ok_or_else(|| anyhow!("task not found"))?;
        if task.status != "pending" {
            return Err(anyhow!("task is not pending"));
        }
        let tasks = self.db.tasks()?;
        if !task.dependencies.iter().all(|id| {
            tasks
                .iter()
                .any(|item| &item.id == id && item.status == "completed")
        }) {
            return Err(anyhow!("dependencies are not complete"));
        }
        self.db.set_status(id, "ready", None)?;
        self.db.task(id)?.ok_or_else(|| anyhow!("task missing"))
    }
    pub fn cancel(&self, id: &str) -> Result<Task> {
        let task = self.db.task(id)?.ok_or_else(|| anyhow!("task not found"))?;
        if matches!(task.status.as_str(), "completed" | "failed" | "cancelled") {
            return Err(anyhow!("task already finished"));
        }
        if let Some((_, tx)) = self.running.lock().unwrap().get(id) {
            tx.send(true).ok();
        }
        self.db.set_status(id, "cancelled", None)?;
        self.db.finish_run(id, "cancelled", None)?;
        self.emit("task.cancelled", Some(&task), json!({}));
        self.db.task(id)?.ok_or_else(|| anyhow!("task missing"))
    }
    pub fn retry(&self, id: &str) -> Result<Task> {
        self.db.retry(id)?;
        self.db.task(id)?.ok_or_else(|| anyhow!("task missing"))
    }
    pub fn revoke_device(&self, id: &str) -> Result<()> {
        if id == "local" {
            return Err(anyhow!("local device cannot be revoked"));
        }
        for task in self.db.tasks()?.into_iter().filter(|task| {
            task.assigned_device == id
                && matches!(
                    task.status.as_str(),
                    "pending" | "ready" | "running" | "waiting_permission"
                )
        }) {
            if let Some((_, tx)) = self.running.lock().unwrap().get(&task.id) {
                tx.send(true).ok();
            }
            let reason = json!({"error":"assigned device was revoked"});
            self.db
                .set_status(&task.id, "failed", Some(reason.clone()))?;
            self.db
                .finish_run(&task.id, "failed", Some("device revoked"))?;
            self.emit("task.failed", Some(&task), reason);
        }
        Ok(())
    }
    pub async fn run(self) {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
        loop {
            interval.tick().await;
            if let Err(e) = self.tick() {
                eprintln!("scheduler: {e}");
            }
        }
    }
    /// Watches the automations table; a separate, slower loop so a bad schedule
    /// can never stall task dispatch.
    pub async fn run_automations(self) {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            interval.tick().await;
            if let Err(e) = self.dispatch_due() {
                eprintln!("automations: {e}");
            }
        }
    }
    pub fn dispatch_due(&self) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        for automation in self.db.due_automations(now)? {
            match self.launch(&automation.id, true) {
                Ok(_) => {}
                Err(error) => {
                    eprintln!("automation {}: {error}", automation.id);
                    self.db.schedule_next(&automation.id, "failed")?;
                    self.db
                        .finish_automation_run(&automation.id, "failed", &error.to_string())?;
                }
            }
        }
        Ok(())
    }
    /// Creates and starts the session an automation describes. `advance` moves
    /// the next trigger forward; a manual "run now" leaves the schedule intact.
    pub fn launch(&self, id: &str, advance: bool) -> Result<Task> {
        let automation = self
            .db
            .automation(id)?
            .ok_or_else(|| anyhow!("schedule not found"))?;
        let member = match &automation.member_id {
            Some(member) => self
                .db
                .member(member)?
                .ok_or_else(|| anyhow!("agent not found"))?,
            None => self
                .db
                .default_session_member()?
                .ok_or_else(|| anyhow!("no execution environment configured"))?,
        };
        let mut input = json!({"prompt":automation.message,"display_text":automation.message,"automation_id":automation.id});
        if automation.hide_from_chat {
            input["hidden"] = json!(true);
        }
        if automation.lean_context {
            input["lean_context"] = json!(true);
        }
        match automation.approval.as_str() {
            "auto" => input["permission_profile"] = json!("yolo"),
            "ask" => input["permission_profile"] = json!("ask"),
            _ => {}
        }
        let task = self.db.create_task(NewTask {
            crew_id: member.crew_id.clone(),
            title: automation.name.chars().take(60).collect(),
            description: format!("定时任务 · {}", automation.name),
            assigned_member: member.id,
            parent_id: None,
            dependencies: vec![],
            priority: 0,
            input,
        })?;
        self.db
            .start_automation_run(&automation.id, Some(&task.id))?;
        if advance {
            self.db.schedule_next(&automation.id, "scheduled")?;
        } else {
            self.db.record_automation_launch(&automation.id, "manual")?;
        }
        self.start(&task.id)?;
        self.emit(
            "automation.started",
            Some(&task),
            json!({"automation_id":automation.id,"name":automation.name}),
        );
        Ok(task)
    }
    fn tick(&self) -> Result<()> {
        let tasks = self.db.tasks()?;
        for task in &tasks {
            if task.status != "pending" || task.dependencies.is_empty() {
                continue;
            }
            let deps = task
                .dependencies
                .iter()
                .filter_map(|id| tasks.iter().find(|other| &other.id == id))
                .collect::<Vec<_>>();
            if deps
                .iter()
                .any(|dep| matches!(dep.status.as_str(), "failed" | "cancelled"))
            {
                self.db.set_status(
                    &task.id,
                    "failed",
                    Some(json!({"error":"dependency failed or cancelled"})),
                )?;
                self.emit("task.failed", Some(task), json!({"reason":"dependency"}));
            } else if deps.len() == task.dependencies.len()
                && deps.iter().all(|dep| dep.status == "completed")
            {
                self.db.set_status(&task.id, "ready", None)?;
            }
        }
        let mut ready = self
            .db
            .tasks()?
            .into_iter()
            .filter(|t| t.status == "ready")
            .collect::<Vec<_>>();
        ready.sort_by(|a, b| {
            b.priority
                .cmp(&a.priority)
                .then(a.created_at.cmp(&b.created_at))
        });
        for task in ready {
            let member = self
                .db
                .member(&task.assigned_member)?
                .ok_or_else(|| anyhow!("assigned member missing"))?;
            let mut running = self.running.lock().unwrap();
            if running.len() >= self.max_concurrency {
                break;
            }
            let member_count = running.values().filter(|(id, _)| id == &member.id).count();
            if member_count >= member.max_concurrency as usize || running.contains_key(&task.id) {
                continue;
            }
            let Some(device) = self.db.device(&task.assigned_device)? else {
                self.db.set_status(
                    &task.id,
                    "failed",
                    Some(json!({"error":"assigned device was revoked"})),
                )?;
                self.emit(
                    "task.failed",
                    Some(&task),
                    json!({"reason":"device revoked"}),
                );
                continue;
            };
            if !matches!(device.status.as_str(), "online" | "busy") {
                continue;
            }
            let (tx, rx) = watch::channel(false);
            running.insert(task.id.clone(), (member.id.clone(), tx));
            drop(running);
            self.db.start_run(&task)?;
            self.db.set_status(&task.id, "running", None)?;
            self.db.set_device_status(&task.assigned_device, "busy")?;
            self.emit(
                "task.started",
                Some(&task),
                json!({"attempt":task.retry_count+1}),
            );
            let worker = self.clone();
            tokio::spawn(async move {
                worker.execute(task, member, rx).await;
            });
        }
        Ok(())
    }
    async fn execute(
        &self,
        task: Task,
        mut member: crate::db::Member,
        cancel: watch::Receiver<bool>,
    ) {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let session = self.db.binding(&task.id).unwrap_or(None);
        let transport = self.transport.clone();
        let mut task_copy = task.clone();
        task_copy.input = self.materialize_input(&task);
        if let Some(mode) = task.input.get("permission_profile").and_then(Value::as_str) {
            member.permission_profile = match mode {
                "trust" | "yolo" => "allow",
                "ask" | "read" => "ask",
                _ => member.permission_profile.as_str(),
            }
            .to_owned();
        }
        let handle = tokio::spawn(async move {
            transport
                .execute(&task_copy, &member, session, cancel, tx)
                .await
        });
        tokio::pin!(handle);
        let result = loop {
            tokio::select! {
                event=rx.recv()=>if let Some(event)=event {match event {
                    TransportEvent::Bound(session)=>{if let Err(e)=self.db.bind(&task,&session){eprintln!("binding: {e}");}else{self.emit("session.bound",Some(&task),json!({"ax_session_id":session}));}},
                    TransportEvent::Update(value)=>self.map_update(&task,value),
                }},
                outcome=&mut handle=>break outcome.map_err(|e|anyhow!(e)).and_then(|r|r),
            }
        };
        while let Ok(event) = rx.try_recv() {
            match event {
                TransportEvent::Bound(session) => {
                    if self.db.bind(&task, &session).is_ok() {
                        self.emit(
                            "session.bound",
                            Some(&task),
                            json!({"ax_session_id":session}),
                        );
                    }
                }
                TransportEvent::Update(value) => self.map_update(&task, value),
            }
        }
        // A cancel or revoke wins over a late completion from the transport.
        if self
            .db
            .task(&task.id)
            .ok()
            .flatten()
            .is_some_and(|t| !matches!(t.status.as_str(), "running" | "waiting_permission"))
        {
            self.running.lock().unwrap().remove(&task.id);
            self.restore_device_status(&task);
            return;
        }
        match result {
            Ok(output) => {
                let _ = self
                    .db
                    .set_status(&task.id, "completed", Some(output.clone()));
                let _ = self.db.finish_run(&task.id, "completed", None);
                self.emit(
                    "agent.message.completed",
                    Some(&task),
                    json!({"content":{"text":output["text"]}}),
                );
                self.emit("task.completed", Some(&task), output);
            }
            Err(e) => {
                if task.assigned_device != "local"
                    && (e.to_string().contains("disconnected") || e.to_string().contains("offline"))
                {
                    let _ = self.db.set_device_status(&task.assigned_device, "offline");
                    let _ = self.db.set_status(&task.id, "ready", None);
                    let _ = self
                        .db
                        .finish_run(&task.id, "interrupted", Some(&e.to_string()));
                    self.emit(
                        "device.disconnected",
                        Some(&task),
                        json!({"resume_session":true}),
                    );
                } else {
                    let value = json!({"error":e.to_string()});
                    let _ = self.db.set_status(&task.id, "failed", Some(value.clone()));
                    let _ = self.db.finish_run(&task.id, "failed", Some(&e.to_string()));
                    self.emit("task.failed", Some(&task), value);
                }
            }
        }
        self.running.lock().unwrap().remove(&task.id);
        self.restore_device_status(&task);
    }
    fn materialize_input(&self, task: &Task) -> Value {
        let Some(options) = task.input.as_object() else {
            return task.input.clone();
        };
        let Some(prompt) = options.get("prompt").and_then(Value::as_str) else {
            return task.input.clone();
        };
        if options.get("include_dependencies").and_then(Value::as_bool) != Some(true) {
            return Value::String(prompt.to_owned());
        }
        let mut context = String::from("Dependency outputs:\n");
        for id in &task.dependencies {
            if let Ok(Some(predecessor)) = self.db.task(id) {
                let result = predecessor
                    .output
                    .as_ref()
                    .and_then(|output| output["text"].as_str())
                    .unwrap_or("");
                context.push_str(&format!(
                    "{} ({}): {}\n",
                    predecessor.id, predecessor.title, result
                ));
            }
        }
        Value::String(format!("{context}\nTask:\n{prompt}"))
    }
    fn restore_device_status(&self, task: &Task) {
        let busy = self.running.lock().unwrap().keys().any(|id| {
            self.db
                .task(id)
                .ok()
                .flatten()
                .is_some_and(|t| t.assigned_device == task.assigned_device)
        });
        if !busy
            && self
                .db
                .device(&task.assigned_device)
                .ok()
                .flatten()
                .is_some_and(|d| d.status == "busy")
        {
            let _ = self.db.set_device_status(&task.assigned_device, "online");
        }
    }
    fn map_update(&self, task: &Task, value: Value) {
        if value["kind"] == "permission.requested" {
            let _ = self.db.set_status(&task.id, "waiting_permission", None);
        }
        if value["kind"] == "permission.resolved" {
            let _ = self.db.set_status(&task.id, "running", None);
        }
        let kind = if value["sessionUpdate"].is_null() {
            value["kind"].as_str().unwrap_or("agent.update").to_owned()
        } else {
            match value["sessionUpdate"].as_str().unwrap_or("") {
                "agent_message_chunk" => "agent.message.delta",
                "tool_call" => "tool.started",
                "tool_call_update" if value["rawOutput"]["status"] == "error" => "tool.failed",
                "tool_call_update" => match value["status"].as_str() {
                    Some("failed" | "error") => "tool.failed",
                    Some("completed" | "success") => "tool.completed",
                    Some("pending" | "in_progress" | "running") => "tool.progress",
                    _ => "tool.updated",
                },
                _ => "agent.update",
            }
            .to_owned()
        };
        self.emit(&kind, Some(task), value);
    }
}
