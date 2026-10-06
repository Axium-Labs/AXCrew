//! Test-only OpenSSH stand-in: executes remote stdin with Git Bash, without AX.
use std::{io::{Read,Write},process::{Command,Stdio}};
fn main(){
    let args=std::env::args().skip(1).collect::<Vec<_>>();
    assert_eq!(args.last().map(String::as_str),Some("sh -s"));
    let host=args.get(args.len()-2).unwrap().split('@').last().unwrap();
    let root=std::path::PathBuf::from(std::env::var_os("MOCK_SSH_ROOT").unwrap()).join(host);
    if root.join("disabled").exists(){eprintln!("connection refused");std::process::exit(255);}
    let mut script=String::new();std::io::stdin().read_to_string(&mut script).unwrap();
    assert!(!script.contains("ax acp"),"Remote AX must never be launched");
    let mut log=std::fs::OpenOptions::new().create(true).append(true).open(root.join("ssh.log")).unwrap();
    writeln!(log,"{} {}",host,script.replace('\n'," | ")).unwrap();
    let timed = script.contains("LOCAL_AX_REMOTE_SHELL");
    let started = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
    let shell=std::env::var_os("MOCK_REMOTE_SHELL").unwrap();
    let mut child=Command::new(shell).args(["--noprofile","--norc","-s"]).current_dir(&root)
        .env_remove("AX_HOME").env_remove("DEEPSEEK_API_KEY").env("PATH",std::env::var("MOCK_REMOTE_PATH").unwrap())
        .stdin(Stdio::piped()).stdout(Stdio::inherit()).stderr(Stdio::inherit()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(script.as_bytes()).unwrap();
    let code=child.wait().unwrap().code().unwrap_or(255);
    if timed {
        let ended=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
        let mut times=std::fs::OpenOptions::new().create(true).append(true).open(root.join("execution-times.txt")).unwrap();
        writeln!(times,"{started} {ended}").unwrap();
    }
    std::process::exit(code);
}
