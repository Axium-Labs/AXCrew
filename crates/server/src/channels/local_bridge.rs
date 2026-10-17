//! Supervised imsg/WhatsApp children. Stdio only; credentials never use argv/files.
use super::*;
use std::process::Stdio;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
};
fn hidden(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    #[cfg(not(windows))]
    let _ = command;
}
pub async fn install_whatsapp(c: &Channels) -> Result<()> {
    ensure!(
        !c.store
            .snapshot()
            .configs
            .get("whatsapp")
            .is_some_and(|cfg| cfg.enabled),
        "请先停用 WhatsApp 再安装或修复连接组件"
    );
    let _lock = c
        .install
        .try_lock()
        .map_err(|_| anyhow::anyhow!("WhatsApp component installation already running"))?;
    let dir = c.runtime_dir.join("whatsapp");
    tokio::fs::create_dir_all(&dir).await?;
    tokio::fs::write(
        dir.join("package.json"),
        include_str!("../../../../apps/channel-bridge/package.json"),
    )
    .await?;
    tokio::fs::write(
        dir.join("package-lock.json"),
        include_str!("../../../../apps/channel-bridge/package-lock.json"),
    )
    .await?;
    let mut command = if cfg!(windows) {
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/D", "/C", "npm.cmd ci --omit=dev --no-audit --no-fund"]);
        cmd
    } else {
        let mut cmd = Command::new("npm");
        cmd.args(["ci", "--omit=dev", "--no-audit", "--no-fund"]);
        cmd
    };
    command
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    hidden(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| anyhow::anyhow!("请先安装 Node.js 20 或更新版本（含 npm）"))?;
    let status = tokio::time::timeout(Duration::from_secs(300), child.wait()).await??;
    ensure!(
        status.success(),
        "WhatsApp 组件安装失败，请检查 Node.js、npm 和网络后重试"
    );
    Ok(())
}
pub fn imessage_event(v: &Value) -> Option<Inbound> {
    if v["method"] != "message" {
        return None;
    }
    let m = &v["params"]["message"];
    // Missing group metadata is not evidence of a private conversation.
    if m["is_group"] != false || m["is_from_me"] != false || m["service"] != "iMessage" {
        return None;
    }
    let sender = m["sender"].as_str()?;
    Some(Inbound {
        platform: "imessage".into(),
        id: m["guid"].as_str()?.into(),
        chat: m["chat_id"].as_i64()?.to_string(),
        sender: sender.into(),
        text: m["text"].as_str()?.into(),
        context: String::new(),
    })
}
pub async fn run(app: &App, platform: &str, cfg: &ChannelConfig) -> Result<()> {
    let c = &app.channels;
    let whatsapp = platform == "whatsapp";
    ensure!(
        whatsapp || cfg!(target_os = "macos"),
        "iMessage requires macOS"
    );
    let mut command = Command::new(if cfg.bridge_path.is_empty() {
        if whatsapp { "node" } else { "imsg" }
    } else {
        &cfg.bridge_path
    });
    if whatsapp {
        let runtime = std::fs::canonicalize(c.runtime_dir.join("whatsapp"))
            .map_err(|_| anyhow::anyhow!("请先安装 WhatsApp 连接组件"))?;
        command
            .args([
                "--input-type=module",
                "-e",
                include_str!("../../../../apps/channel-bridge/whatsapp.mjs"),
            ])
            .arg(runtime);
        *c.qr.lock().unwrap() = None;
    } else {
        command.arg("rpc");
        if !cfg.database_path.is_empty() {
            command.args(["--db", &cfg.database_path]);
        }
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    hidden(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| anyhow::anyhow!("platform bridge executable unavailable"))?;
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    let initial = if whatsapp {
        json!({"jsonrpc":"2.0","id":"init","method":"initialize","params":{"auth":cfg.bridge_auth}})
    } else {
        json!({"jsonrpc":"2.0","id":"init","method":"watch.subscribe","params":{"attachments":false,"since_rowid":0}})
    };
    input.write_all(format!("{initial}\n").as_bytes()).await?;
    let mut outgoing = c.register(platform, cfg);
    let mut pending: BTreeMap<
        String,
        (std::time::Instant, tokio::sync::oneshot::Sender<Result<()>>),
    > = BTreeMap::new();
    let mut timer = tokio::time::interval(Duration::from_secs(10));
    let started = std::time::Instant::now();
    let mut initialized = false;
    let mut line = Vec::new();
    loop {
        tokio::select! {
            _=timer.tick()=>{
                ensure!(initialized||started.elapsed()<Duration::from_secs(45),"platform bridge initialization timed out");
                let expired:Vec<_>=pending.iter().filter(|(_, (at,_))|at.elapsed()>Duration::from_secs(25)).map(|(id,_)|id.clone()).collect();
                for id in expired{if let Some((_,reply))=pending.remove(&id){let _=reply.send(Err(anyhow::anyhow!("bridge acknowledgement timed out")));}}
            }
            Some(request)=outgoing.recv()=>{
                let id=uuid::Uuid::new_v4().to_string();
                let frame=json!({"jsonrpc":"2.0","id":id,"method":"send","params":request.body});
                input.write_all(format!("{frame}\n").as_bytes()).await?;
                pending.insert(id,(std::time::Instant::now(),request.reply));
            }
            result=async { (&mut output).take(8*1024*1024+1).read_until(b'\n',&mut line).await }=>{
                ensure!(result?>0,"platform bridge closed");ensure!(line.len()<=8*1024*1024,"bridge frame too large");
                let v:Value=serde_json::from_slice(&line)?;line.clear();
                if let Some(id)=v["id"].as_str(){
                    if id=="init"{ensure!(v["error"].is_null(),"platform bridge initialization failed");initialized=true;if !whatsapp{c.set_state(platform,"connected");}}
                    if let Some((_,reply))=pending.remove(id){let _=reply.send(if v["error"].is_null(){Ok(())}else{Err(anyhow::anyhow!("platform bridge rejected reply"))});}
                }
                if whatsapp {
                    match v["type"].as_str(){
                        Some("auth")=>{
                            c.store.update(|state|{let current=state.configs.get_mut(platform).filter(|current|current.enabled&&current.secret==cfg.secret&&current.generation==cfg.generation).ok_or_else(||anyhow::anyhow!("channel changed"))?;current.bridge_auth=v["value"].clone();Ok(())})?;
                            input.write_all(format!("{}\n",json!({"method":"auth.saved","id":v["id"]})).as_bytes()).await?;
                        }
                        Some("qr")=>{*c.qr.lock().unwrap()=v["value"].as_str().map(str::to_owned);c.set_state(platform,"pairing");}
                        Some("connected")=>{*c.qr.lock().unwrap()=None;c.set_state(platform,"connected");}
                        Some("closed")=>{*c.qr.lock().unwrap()=None;
                            if v["logged_out"]==true{c.store.update(|state|{if let Some(current)=state.configs.get_mut(platform).filter(|current|current.generation==cfg.generation){current.bridge_auth=Value::Null;current.peers.clear();state.inbox.retain(|m|m.platform!=platform);}Ok(())})?;}
                            return Err(anyhow::anyhow!("WhatsApp disconnected; check linked devices"));}
                        Some("message")=>{let m=&v["message"];if let (Some(id),Some(chat),Some(sender),Some(text))=(m["id"].as_str(),m["chat"].as_str(),m["sender"].as_str(),m["text"].as_str()){c.enqueue_current(Inbound{platform:platform.into(),id:id.into(),chat:chat.into(),sender:sender.into(),text:text.into(),context:String::new()},cfg)?;}}
                        _=>{}
                    }
                }else if let Some(m)=imessage_event(&v){c.enqueue_current(m,cfg)?;}else if v["method"]=="watch.overflow"{anyhow::bail!("iMessage watch overflow");}
            }
        }
    }
}
