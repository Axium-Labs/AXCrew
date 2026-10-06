use ax_crew::{
    domain::{distributed::*, unix_now},
    orchestration::distributed as service,
    storage::Db,
};
use serde_json::json;
use std::{path::PathBuf, sync::Arc};

struct Fixture {
    db: Db,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("axcrew-distributed-test-{}", uuid::Uuid::new_v4()));
        let db = Db::open(&root.join("crew.db")).unwrap();
        Self { db, root }
    }
    fn instance(&self, host: &str, role: &str, cpu: u32, concurrency: u32) -> Instance {
        let (instance, token) = service::enroll(
            &self.db,
            Enrollment {
                host_id: host.into(),
                host_name: host.into(),
                resources: Resources {
                    cpu,
                    ram_mb: 8192,
                    gpu: 1,
                },
                name: role.into(),
                capabilities: Capabilities {
                    roles: vec![role.into()],
                    models: vec!["model-1".into()],
                    skills: vec!["rust".into()],
                    ..Default::default()
                },
                projects: vec!["project-ax".into()],
                max_executions: concurrency,
                can_delegate: true,
            },
        )
        .unwrap();
        assert_eq!(
            service::authenticate(&self.db, &token).unwrap(),
            instance.id
        );
        assert!(instance.credential_hash.is_empty());
        service::restart(&self.db, &instance.id, "epoch-1").unwrap();
        service::heartbeat(
            &self.db,
            &instance.id,
            Heartbeat {
                host_inventory: None,
                capabilities: None,
                incarnation: "epoch-1".into(),
                active: vec![],
            },
        )
        .unwrap();
        instance
    }
    fn submit(
        &self,
        creator: &str,
        key: &str,
        role: &str,
        dependencies: Vec<String>,
    ) -> DistributedTask {
        service::submit(&self.db,creator,serde_json::from_value(json!({"request_id":key,"title":key,"input":"concrete work","project_id":"project-ax","dependencies":dependencies,
            "requirements":{"capabilities":{"roles":[role]},"resources":{"cpu":1}}})).unwrap()).unwrap()
    }
    fn report(&self, owner: &str, task: &DistributedTask, kind: &str, key: &str) -> Report {
        let report = Report {
            incarnation: task.incarnation.clone().unwrap(),
            task_id: task.id.clone(),
            generation: task.generation,
            message_id: key.into(),
            kind: kind.into(),
            text: format!("{kind}: test result"),
            artifacts: vec![],
        };
        service::report(&self.db, owner, report.clone()).unwrap();
        report
    }
}
impl Drop for Fixture {
    fn drop(&mut self) { /* SQLite file can stay locked until Db drops on Windows. */
    }
}

#[test]
fn automatic_inventory_is_shared_persistent_and_fenced() {
    let f = Fixture::new();
    let enrollment = || {
        serde_json::from_value::<Enrollment>(json!({"host_id":"auto-host","host_name":"Auto host","name":"AX","projects":["project-ax"],"max_executions":2})).unwrap()
    };
    let (a, _) = service::enroll(&f.db, enrollment()).unwrap();
    let (b, _) = service::enroll(&f.db, enrollment()).unwrap();
    assert_eq!(
        f.db.cluster_read().unwrap().hosts["auto-host"]
            .resources
            .cpu,
        0
    );
    let task = service::submit(&f.db,"admin",serde_json::from_value(json!({"request_id":"auto-placement","title":"Automatic placement","input":"work","project_id":"project-ax"})).unwrap()).unwrap();
    let heartbeat = |epoch: &str, gpu: Option<u32>| Heartbeat {
        incarnation: epoch.into(),
        active: vec![],
        capabilities: None,
        host_inventory: Some(HostInventory {
            hostname: "test-machine".into(),
            os: "windows".into(),
            arch: "x86_64".into(),
            cpu_name: "Test CPU".into(),
            cpu: 8,
            ram_mb: Some(16384),
            gpu,
            gpu_names: vec![],
            errors: vec![],
        }),
    };
    service::restart(&f.db, &a.id, "current").unwrap();
    service::heartbeat(&f.db, &a.id, heartbeat("current", Some(2))).unwrap();
    service::restart(&f.db, &b.id, "current").unwrap();
    service::heartbeat(&f.db, &b.id, heartbeat("current", Some(2))).unwrap();
    let state = f.db.cluster_read().unwrap();
    assert_eq!(state.hosts["auto-host"].resources.cpu, 8);
    assert_eq!(state.hosts["auto-host"].resources.gpu, 2);
    assert!(state.hosts["auto-host"].inventory_at > 0);
    assert!(state.tasks[&task.id].owner.is_some());
    let revision = state.revision;
    assert!(service::heartbeat(&f.db, &a.id, heartbeat("old", None)).is_err());
    assert_eq!(f.db.cluster_read().unwrap().revision, revision);
    service::heartbeat(&f.db, &a.id, heartbeat("current", None)).unwrap();
    let reopened = Db::open(&f.root.join("crew.db"))
        .unwrap()
        .cluster_read()
        .unwrap();
    assert!(
        reopened.hosts["auto-host"]
            .inventory
            .as_ref()
            .unwrap()
            .gpu
            .is_none()
    );
    assert_eq!(reopened.hosts["auto-host"].resources.gpu, 0);
}

#[test]
fn configured_capabilities_only_schedule_after_worker_reports_them() {
    let f = Fixture::new();
    let worker = f.instance("host", "code", 8, 2);
    let next = Capabilities {
        roles: vec!["test".into()],
        skills: vec!["testing".into()],
        ..Default::default()
    };
    service::configure(&f.db, &worker.id, next.clone()).unwrap();
    let task = f.submit("admin", "new-capability", "test", vec![]);
    assert_eq!(task.status, "pending");
    assert_eq!(
        f.db.cluster_read().unwrap().instances[&worker.id]
            .capabilities
            .roles,
        vec!["code"]
    );
    service::heartbeat(
        &f.db,
        &worker.id,
        Heartbeat {
            incarnation: "epoch-1".into(),
            active: vec![],
            host_inventory: None,
            capabilities: Some(next),
        },
    )
    .unwrap();
    let state = f.db.cluster_read().unwrap();
    assert!(state.instances[&worker.id].pending_capabilities.is_none());
    assert_eq!(
        state.tasks[&task.id].owner.as_deref(),
        Some(worker.id.as_str())
    );
    let (unconnected, _) = service::enroll(&f.db,serde_json::from_value(json!({"host_id":"new","host_name":"new","name":"new","projects":["project-ax"],"max_executions":1})).unwrap()).unwrap();
    assert!(service::configure(&f.db, &unconnected.id, Capabilities::default()).is_err());
}

#[test]
fn artifacts_are_immutable_idempotent_and_fenced_with_the_attempt() {
    let f = Fixture::new();
    let worker = f.instance("host-a", "code", 4, 2);
    let task = f.submit("admin", "artifact-job", "code", vec![]);
    let upload = || Upload {
        incarnation: task.incarnation.clone().unwrap(),
        task_id: task.id.clone(),
        generation: task.generation,
        kind: "log".into(),
        name: "test.log".into(),
        content_base64: String::new(),
    };
    let bytes = b"failure report";
    let artifact = service::upload(&f.db, &worker.id, upload(), bytes).unwrap();
    assert_eq!(
        service::upload(&f.db, &worker.id, upload(), bytes)
            .unwrap()
            .id,
        artifact.id
    );
    assert_eq!(artifact.sha256, service::hash(bytes));
    assert_eq!(f.db.cluster_blob_get(&artifact.sha256).unwrap(), bytes);
    assert_eq!(
        f.db.cluster_read().unwrap().tasks[&task.id].artifacts,
        vec![artifact.id.clone()]
    );
    f.report(&worker.id, &task, "completed", "finished-with-log");
    assert_eq!(
        f.db.cluster_read().unwrap().tasks[&task.id].artifacts,
        vec![artifact.id]
    );
    assert!(service::upload(&f.db, &worker.id, upload(), b"stale output").is_err());
    assert!(
        f.db.cluster_blob_get(&service::hash(b"stale output"))
            .is_err()
    );
}

#[test]
fn placement_requires_ax_capability_and_shared_host_capacity() {
    let f = Fixture::new();
    let code = f.instance("host-a", "code", 2, 2);
    let test = f.instance("host-a", "test", 2, 2);
    let first = f.submit("admin", "code-1", "code", vec![]);
    let second = f.submit("admin", "code-2", "code", vec![]);
    let third = f.submit("admin", "test-1", "test", vec![]);
    assert_eq!(first.owner, Some(code.id.clone()));
    assert_eq!(second.owner, Some(code.id.clone()));
    assert_eq!(third.status, "pending");
    assert_eq!(f.db.cluster_read().unwrap().hosts.len(), 1);
    f.report(&code.id, &first, "completed", "code-1-result");
    let third = f.db.cluster_read().unwrap().tasks[&third.id].clone();
    assert_eq!(third.owner, Some(test.id));
    let mut spec = third.spec.clone();
    spec.request_id = "unsupported-model".into();
    spec.requirements.capabilities.models = vec!["missing-model".into()];
    assert_eq!(
        service::submit(&f.db, "admin", spec).unwrap().status,
        "pending"
    );
    let mut spec = third.spec.clone();
    spec.request_id = "gpu-unavailable".into();
    spec.requirements.resources.gpu = 2;
    assert_eq!(
        service::submit(&f.db, "admin", spec).unwrap().status,
        "pending"
    );
}
#[test]
fn dependencies_observations_and_failures_are_durable_collaboration_information() {
    let f = Fixture::new();
    let worker = f.instance("host", "test", 4, 3);
    let first = f.submit("admin", "test", "test", vec![]);
    let after = f.submit("admin", "analyze", "test", vec![first.id.clone()]);
    assert_eq!(after.status, "pending");
    f.report(&worker.id, &first, "observation", "obs");
    assert_eq!(
        f.db.cluster_read().unwrap().tasks[&first.id].status,
        "running"
    );
    f.report(&worker.id, &first, "failed", "failure");
    let state = f.db.cluster_read().unwrap();
    assert_eq!(state.tasks[&after.id].status, "failed");
    assert!(
        state
            .events
            .iter()
            .any(|e| e.kind == "task.observation" && e.detail.contains("test result"))
    );
    // AX may replan from a failed test without requiring a successful dependency.
    let analysis = f.submit(&worker.id, "analyze-failure", "test", vec![]);
    assert_eq!(analysis.status, "running");
    f.report(&worker.id, &analysis, "completed", "analysis-result");
    let follow = f.submit("admin", "follow", "test", vec![analysis.id]);
    let assigned = service::heartbeat(
        &f.db,
        &worker.id,
        Heartbeat {
            host_inventory: None,
            capabilities: None,
            incarnation: "epoch-1".into(),
            active: vec![],
        },
    )
    .unwrap();
    assert_eq!(
        assigned
            .iter()
            .find(|a| a.task.id == follow.id)
            .unwrap()
            .dependency_results[0]
            .result
            .as_deref(),
        Some("completed: test result")
    );
}
#[test]
fn restart_retains_leases_and_fences_old_execution_after_failover() {
    let f = Fixture::new();
    let old = f.instance("host-old", "code", 4, 2);
    let other = f.instance("host-new", "code", 4, 2);
    let mut spec:Submit=serde_json::from_value(json!({"request_id":"failover","title":"failover","input":"work","project_id":"project-ax","requirements":{"instance_id":old.id}})).unwrap();
    let first = service::submit(&f.db, "admin", spec.clone()).unwrap();
    let reopened = Db::open(&f.root.join("crew.db")).unwrap();
    assert_eq!(
        reopened.cluster_read().unwrap().tasks[&first.id].generation,
        first.generation
    );
    assert_eq!(
        reopened.cluster_read().unwrap().tasks[&first.id].status,
        "running"
    );
    reopened
        .cluster_update(|s| {
            s.tasks
                .get_mut(&first.id)
                .unwrap()
                .spec
                .requirements
                .instance_id = None;
            s.tasks.get_mut(&first.id).unwrap().lease_until = 0;
            s.instances.get_mut(&old.id).unwrap().last_seen = 0;
            service::reconcile(s, unix_now());
            Ok(())
        })
        .unwrap();
    let second = reopened.cluster_read().unwrap().tasks[&first.id].clone();
    assert_eq!(second.owner, Some(other.id.clone()));
    assert_eq!(second.generation, first.generation + 1);
    let stale = Report {
        incarnation: "epoch-1".into(),
        task_id: first.id.clone(),
        generation: first.generation,
        message_id: "stale".into(),
        kind: "completed".into(),
        text: "late".into(),
        artifacts: vec![],
    };
    assert!(service::report(&reopened, &old.id, stale).is_err());
    let duplicate = f.report(&other.id, &second, "completed", "done");
    service::report(&reopened, &other.id, duplicate.clone()).unwrap();
    let mut conflict = duplicate;
    conflict.text = "different".into();
    assert!(service::report(&reopened, &other.id, conflict).is_err());
    spec.request_id = "next".into();
    spec.requirements.instance_id = Some(other.id.clone());
    let next = service::submit(&reopened, "admin", spec).unwrap();
    service::restart(&reopened, &other.id, "epoch-2").unwrap();
    assert!(
        service::heartbeat(
            &reopened,
            &other.id,
            Heartbeat {
                host_inventory: None,
                capabilities: None,
                incarnation: "epoch-1".into(),
                active: vec![LeaseIdentity {
                    task_id: next.id,
                    generation: next.generation
                }]
            }
        )
        .is_err()
    );
}
#[test]
fn duplicate_submission_is_atomic_and_retry_does_not_change_request_identity() {
    let f = Fixture::new();
    let worker = f.instance("host", "test", 4, 2);
    let db = Arc::new(f.db.clone());
    let spec: Submit = serde_json::from_value(
        json!({"request_id":"duplicate","title":"same","input":"work","project_id":"project-ax"}),
    )
    .unwrap();
    let threads: Vec<_> = (0..8)
        .map(|_| {
            let db = db.clone();
            let spec = spec.clone();
            std::thread::spawn(move || service::submit(&db, "admin", spec).unwrap().id)
        })
        .collect();
    let ids: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert!(ids.iter().all(|id| id == &ids[0]));
    let task = f.db.cluster_read().unwrap().tasks[&ids[0]].clone();
    f.report(&worker.id, &task, "failed", "failed");
    service::control(&f.db, "admin", &task.id, "retry").unwrap();
    assert_eq!(service::submit(&f.db, "admin", spec).unwrap().id, task.id);
    assert_eq!(f.db.cluster_read().unwrap().tasks.len(), 1);
}
#[test]
fn policy_and_parent_generation_cannot_be_bypassed() {
    let f = Fixture::new();
    let worker = f.instance("host", "code", 4, 3);
    let parent = f.submit("admin", "parent", "code", vec![]);
    let mut spec:Submit=serde_json::from_value(json!({"request_id":"child","title":"child","input":"work","project_id":"project-ax","parent_id":parent.id,"parent_generation":parent.generation})).unwrap();
    let child = service::submit(&f.db, &worker.id, spec.clone()).unwrap();
    spec.request_id = "wrong-generation".into();
    spec.parent_generation = Some(parent.generation + 1);
    assert!(service::submit(&f.db, &worker.id, spec.clone()).is_err());
    spec.parent_id = None;
    spec.project_id = "unapproved-project".into();
    assert!(service::submit(&f.db, &worker.id, spec.clone()).is_err());
    service::control(&f.db, "admin", &parent.id, "cancel").unwrap();
    assert_eq!(
        f.db.cluster_read().unwrap().tasks[&child.id].status,
        "cancelled"
    );
    assert!(service::control(&f.db, "unrelated-instance", &child.id, "retry").is_err());
    assert!(
        f.db.cluster_read()
            .unwrap()
            .public()
            .instances
            .values()
            .all(|i| i.credential_hash.is_empty())
    );
}
#[test]
fn lost_host_exhausts_retries_without_erasing_history() {
    let f = Fixture::new();
    let worker = f.instance("host", "code", 4, 1);
    let task = f.submit("admin", "lost", "code", vec![]);
    for _ in 0..3 {
        f.db.cluster_update(|state| {
            state.tasks.get_mut(&task.id).unwrap().lease_until = 0;
            service::reconcile(state, unix_now());
            Ok(())
        })
        .unwrap();
    }
    let task = f.db.cluster_read().unwrap().tasks[&task.id].clone();
    assert_eq!(task.status, "failed");
    assert_eq!(task.attempts.len(), 3);
    assert!(task.attempts.iter().all(|a| a.ended_at.is_some()));
    service::control(&f.db, "admin", &task.id, "retry").unwrap();
    service::enable(&f.db, "hosts", &worker.host_id, false).unwrap();
    assert_eq!(
        f.db.cluster_read().unwrap().tasks[&task.id].status,
        "pending"
    );
}

#[test]
fn coordinator_loss_preserves_workflow_and_children_then_another_ax_recovers() {
    let f = Fixture::new();
    let coordinator = f.instance("host-a", "code", 4, 2);
    let tester = f.instance("host-b", "test", 4, 2);
    let parent = f.submit("admin", "coordinate", "code", vec![]);
    assert_eq!(parent.owner.as_deref(), Some(coordinator.id.as_str()));
    let replacement = f.instance("host-c", "code", 4, 2);
    let workflow_id = parent.spec.workflow_id.clone().unwrap();
    let mut child:Submit=serde_json::from_value(json!({"request_id":"stable-test-step","title":"remote-test","input":"test work","project_id":"project-ax","parent_id":parent.id,"parent_generation":parent.generation,"requirements":{"capabilities":{"roles":["test"]}}})).unwrap();
    let submitted = service::submit(&f.db, &coordinator.id, child.clone()).unwrap();
    let source = Report {
        incarnation: "epoch-1".into(),
        task_id: parent.id.clone(),
        generation: parent.generation,
        message_id: "checkpoint".into(),
        kind: "observation".into(),
        text: "".into(),
        artifacts: vec![],
    };
    let checkpoint = service::checkpoint(
        &f.db,
        &coordinator.id,
        &workflow_id,
        0,
        json!({"stage":"awaiting_test","task_id":submitted.id}),
        Some(source.clone()),
    )
    .unwrap();
    assert!(
        service::checkpoint(
            &f.db,
            &coordinator.id,
            &workflow_id,
            0,
            json!({}),
            Some(source.clone())
        )
        .is_err()
    );
    service::enable(&f.db, "instances", &coordinator.id, false).unwrap();
    let state = f.db.cluster_read().unwrap();
    let resumed = state.tasks[&parent.id].clone();
    assert_eq!(resumed.owner, Some(replacement.id.clone()));
    assert_eq!(state.tasks[&submitted.id].owner, Some(tester.id.clone()));
    assert_eq!(state.tasks[&submitted.id].status, "running");
    assert_eq!(state.workflows[&workflow_id].state, checkpoint.state);
    assert!(
        service::checkpoint(
            &f.db,
            &coordinator.id,
            &workflow_id,
            checkpoint.revision,
            json!({"stage":"stale"}),
            Some(source)
        )
        .is_err()
    );
    child.parent_generation = Some(resumed.generation);
    assert_eq!(
        service::submit(&f.db, &replacement.id, child).unwrap().id,
        submitted.id
    );
    assert_eq!(f.db.cluster_read().unwrap().tasks.len(), 2);
    f.report(&tester.id, &submitted, "completed", "test-result");
    let assignments = service::heartbeat(
        &f.db,
        &replacement.id,
        Heartbeat {
            host_inventory: None,
            capabilities: None,
            incarnation: "epoch-1".into(),
            active: vec![],
        },
    )
    .unwrap();
    let recovery = assignments.iter().find(|a| a.task.id == parent.id).unwrap();
    assert_eq!(
        recovery.workflow.as_ref().unwrap().state["stage"],
        "awaiting_test"
    );
    assert!(
        recovery
            .workflow_tasks
            .iter()
            .any(|t| t.id == submitted.id && t.result.is_some())
    );
    f.report(&replacement.id, &resumed, "completed", "replanned-done");
    assert_eq!(
        f.db.cluster_read().unwrap().workflows[&workflow_id].status,
        "completed"
    );
}
