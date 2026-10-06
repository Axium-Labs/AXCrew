use ax_crew::{
    domain::connections::{Project, SshConnection},
    orchestration::connections::validate_ssh,
    storage::Db,
};

#[test]
fn ssh_rejects_options_and_shell_syntax() {
    let mut value = SshConnection {
        id: String::new(),
        name: "test".into(),
        host: "user@host.example".into(),
        port: Some(22),
        identity_file: None,
    };
    assert!(validate_ssh(&value).is_ok());
    for host in [
        "-oProxyCommand=evil",
        "user@-option",
        "host; echo bad",
        "host$(echo bad)",
        "host\nother",
        "user@@host",
        "user@",
    ] {
        value.host = host.into();
        assert!(validate_ssh(&value).is_err(), "{host}");
    }
    value.host = "user@host.example".into();
    value.port = Some(0);
    assert!(validate_ssh(&value).is_err());
}

#[test]
fn projects_and_ssh_survive_restart_without_changing_bound_environments() {
    let path = std::env::temp_dir().join(format!("crew-connections-{}.db", uuid::Uuid::new_v4()));
    {
        let db = Db::open(&path).unwrap();
        let config = SshConnection {
            id: "ssh:test".into(),
            name: "Build host".into(),
            host: "user@build".into(),
            port: Some(2222),
            identity_file: Some("C:/keys/my key".into()),
        };
        db.save_ssh(&config).unwrap();
        let member = db
            .ensure_remote_session_member(&config.id, "/srv/project")
            .unwrap();
        assert_eq!(
            member.id,
            db.ensure_remote_session_member(&config.id, "/srv/project")
                .unwrap()
                .id
        );
        db.save_project(&Project {
            id: "project".into(),
            name: "Demo".into(),
            device_id: config.id.clone(),
            cwd: member.cwd.clone(),
            member_id: member.id,
        })
        .unwrap();
    }
    let db = Db::open(&path).unwrap();
    assert_eq!(db.ssh_connections().unwrap()[0].host, "user@build");
    let project = db.projects().unwrap().remove(0);
    assert_eq!(project.cwd, "/srv/project");
    db.remove_project(&project.id).unwrap();
    assert!(db.member(&project.member_id).unwrap().is_some());
    db.revoke_device("ssh:test").unwrap();
    assert!(db.ssh_connections().unwrap().is_empty());
    drop(db);
    std::fs::remove_file(path).unwrap();
}
