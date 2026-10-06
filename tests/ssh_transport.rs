use super::*;
#[test]
fn ssh_never_starts_remote_ax_and_uses_fixed_remote_shell() {
    let config = SshConnection {
        id: "ssh:test".into(),
        name: "Test".into(),
        host: "user@host".into(),
        port: Some(2222),
        identity_file: Some("C:/keys/my key".into()),
    };
    let cmd = command(&config).unwrap();
    let args = cmd
        .as_std()
        .get_args()
        .map(|a| a.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert!(args.iter().any(|a| a == "BatchMode=yes"));
    assert!(args.iter().any(|a| a == "StrictHostKeyChecking=accept-new"));
    assert_eq!(args[args.len() - 2], "user@host");
    assert_eq!(args.last().unwrap(), "sh -s");
    assert!(!args.iter().any(|a| a.contains("ax acp")));
    assert!(args.windows(2).any(|a| a == ["-i", "C:/keys/my key"]));
    assert_eq!(quote("/srv/it's a project"), "'/srv/it'\"'\"'s a project'");
    assert!(local_workspace("ssh:../escape").is_err());
}
