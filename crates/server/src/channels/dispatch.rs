//! Only desktop-approved private peers can submit or inspect their own turns.
use super::*;
use crate::{api::sessions, domain::task::Task};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue},
};

fn headers(app: &App) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    let token = app
        .admin_token
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("desktop authentication required"))?;
    headers.insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {token}"))?,
    );
    Ok(headers)
}
pub(super) fn active(task: &Task) -> bool {
    matches!(
        task.status.as_str(),
        "pending" | "ready" | "running" | "waiting_permission" | "waiting_user"
    )
}
fn approvals(app: &App, task: &str) -> Result<Vec<Value>> {
    let pending = app.approvals.pending();
    Ok(app
        .db
        .events(500, 0)?
        .into_iter()
        .filter(|event| {
            event["kind"] == "permission.requested"
                && event["task_id"] == task
                && pending
                    .iter()
                    .any(|p| p["request_id"] == event["payload"]["request_id"])
        })
        .map(|event| event["payload"].clone())
        .collect())
}
fn describe(app: &App, task: &Task) -> Result<String> {
    let mut result = format!("任务 {}\n状态：{}", task.id, task.status);
    for request in approvals(app, &task.id)? {
        result.push_str(&format!(
            "\n审批：{}\n允许一次 /allow {}\n拒绝 /deny {}",
            request["tool"].as_str().unwrap_or("工具操作"),
            request["request_id"].as_str().unwrap_or_default(),
            request["request_id"].as_str().unwrap_or_default()
        ));
    }
    if task.status == "waiting_user" {
        result.push_str(&format!(
            "\n请回答：{}",
            task.output
                .as_ref()
                .map(|o| o["question"].to_string())
                .unwrap_or_default()
        ));
    }
    if !active(task) {
        let output = task
            .output
            .as_ref()
            .map(|o| {
                o["text"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| o.to_string())
            })
            .unwrap_or_default();
        result.push_str(&format!("\n{output}"));
    }
    Ok(result)
}
async fn command(
    app: &App,
    platform: &str,
    cfg: &ChannelConfig,
    peer: &Peer,
    text: &str,
) -> Result<String> {
    let routed_text;
    let text = match super::navigation::handle(app, platform, cfg, peer, text)? {
        Some(super::navigation::Action::Reply(reply)) => return Ok(reply),
        Some(super::navigation::Action::Command(command)) => {
            routed_text = command;
            routed_text.as_str()
        }
        None => text,
    };
    let task = peer
        .task
        .as_deref()
        .map(|id| app.db.task(id))
        .transpose()?
        .flatten();
    if text == "/help" || text == "/start" {
        return Ok("直接发送文字开始或继续会话。\n发送“菜单”打开编号菜单；“切换项目”“查看历史会话”打开选择列表，回复编号即可选择。\n“新建会话”开启新会话；“切换到 项目名”直接选项目；“查看状态”“取消任务”查看或取消任务。\n菜单五分钟有效，可发送“上一页”“下一页”“返回菜单”“取消选择”。\n备用指令：\n/projects [页码] 查看本机项目\n/project 项目ID或名称或现有绝对路径 切换项目并准备新会话\n/new [项目ID或名称或现有绝对路径] 新建会话\n/sessions [页码] 查看自己的历史会话\n/session 会话ID 切换历史会话\n/status 查看当前项目、状态和结果\n/cancel 取消当前任务\n/allow 编号 允许一次工具操作\n/deny 编号 拒绝操作\n每个账号的会话独立，权限仍由 AX 控制。".into());
    }
    if text == "/axcrew_message_too_large" {
        return Ok("消息超过 16000 字节，请缩短后重新发送；这条消息没有执行。".into());
    }
    if text == "/status" {
        let state = task
            .as_ref()
            .map(|t| describe(app, t))
            .unwrap_or_else(|| Ok("还没有会话，发送文字即可开始。".into()))?;
        return Ok(format!(
            "{}\n{state}",
            super::conversations::summary(app, cfg, peer)?
        ));
    }
    if text == "/cancel" {
        if let Some(task) = &task {
            app.scheduler.cancel(&task.id)?;
            return Ok("已请求取消当前任务。".into());
        }
        return Ok("没有可取消的任务。".into());
    }
    if let Some(response) = super::conversations::command(app, platform, cfg, peer, text)? {
        return Ok(response);
    }
    if let Some((allow, id)) = text
        .strip_prefix("/allow ")
        .map(|id| (true, id))
        .or_else(|| text.strip_prefix("/deny ").map(|id| (false, id)))
    {
        let task = task
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("没有待审批任务"))?;
        ensure!(
            approvals(app, &task.id)?
                .iter()
                .any(|p| p["request_id"].as_str() == Some(id.trim())),
            "审批不属于当前会话或已过期"
        );
        app.approvals
            .resolve(id.trim(), if allow { "allow_once" } else { "reject_once" })?;
        return Ok(if allow {
            "已允许这一次操作。"
        } else {
            "已拒绝操作。"
        }
        .into());
    }
    ensure!(!text.starts_with('/'), "未知命令，请发送 /help");
    ensure!(
        peer.task.is_none() || task.is_some(),
        "当前会话已删除，请发送 /new 新建会话"
    );
    ensure!(
        task.as_ref()
            .is_none_or(|t| !active(t) || t.status == "waiting_user"),
        "任务正在执行，请等待完成，或发送 /status、/cancel"
    );
    let member = if let Some(task) = &task {
        app.db
            .member(&task.assigned_member)?
            .ok_or_else(|| anyhow::anyhow!("会话环境已删除，请发送 /new"))?
    } else {
        let cwd = super::conversations::workspace(app, cfg, peer)?;
        if cwd.is_empty() {
            return super::navigation::choose_project(app, platform, cfg, peer);
        }
        app.db.ensure_local_session_member(&cwd, None, None)?
    };
    // Preserve an explicit Deny environment. An Allow environment is narrowed to Ask.
    let permission = if member.permission_profile == "deny" {
        None
    } else {
        Some("ask")
    };
    let body = json!({"text":text,"permission_profile":permission,"member_id":member.id});
    let history = super::conversations::history(app, peer)?;
    let result = if let Some(task) = task {
        sessions::session_message(
            State(app.clone()),
            headers(app)?,
            Path(task.id),
            Json(serde_json::from_value(body)?),
        )
        .await
    } else {
        sessions::create_session(
            State(app.clone()),
            headers(app)?,
            Json(serde_json::from_value(body)?),
        )
        .await
    }
    .map_err(|_| anyhow::anyhow!("任务提交未确认，请在电脑端检查会话；不会自动重发"))?
    .0;
    super::conversations::update_peer(app, platform, cfg, peer, |p| {
        p.conversations = history;
        super::conversations::remember(p, &result, &member.cwd);
        Ok(())
    })
    .map_err(|_| {
        anyhow::anyhow!(
            "任务已接收，但会话记录保存未确认，请在电脑端检查任务 {}；不要重复发送",
            result.id
        )
    })?;
    Ok(format!("已接收，任务 {}。", result.id))
}
async fn incoming(app: &App, message: Inbound) -> Result<()> {
    let Some(cfg) = app
        .channels
        .store
        .snapshot()
        .configs
        .get(&message.platform)
        .cloned()
        .filter(|c| c.enabled)
    else {
        return Ok(());
    };
    let peer = cfg
        .peers
        .iter()
        .find(|p| p.approved && p.chat == message.chat && p.sender == message.sender)
        .cloned();
    let Some(mut peer) = peer else {
        if app.channels.accept_pairing(&message)? {
            let cfg = app
                .channels
                .store
                .snapshot()
                .configs
                .get(&message.platform)
                .cloned()
                .unwrap_or_default();
            if let Some(peer) = cfg
                .peers
                .iter()
                .find(|p| p.chat == message.chat && p.sender == message.sender)
            {
                app.channels
                    .send(
                        &message.platform,
                        &cfg,
                        peer,
                        "绑定请求已收到，请在电脑 AXCrew 的聊天渠道中确认这个账号。",
                    )
                    .await?;
            }
        }
        return Ok(());
    };
    if !message.context.is_empty() {
        peer.context = message.context.clone();
        app.channels.store.update(|state| {
            if let Some(p) = state
                .configs
                .get_mut(&message.platform)
                .and_then(|c| c.peers.iter_mut().find(|p| p.id == peer.id))
            {
                p.context = message.context;
            }
            Ok(())
        })?;
    }
    let response = match command(app, &message.platform, &cfg, &peer, message.text.trim()).await {
        Ok(text) => text,
        Err(error) => error.to_string(),
    };
    app.channels
        .send(&message.platform, &cfg, &peer, &response)
        .await
}
async fn notify(app: &App, only_platform: &str) -> Result<()> {
    for (platform, cfg) in app.channels.store.snapshot().configs {
        if !cfg.enabled || platform != only_platform {
            continue;
        }
        for peer in cfg.peers.iter().filter(|p| p.approved) {
            let Some(task) = peer
                .task
                .as_deref()
                .map(|id| app.db.task(id))
                .transpose()?
                .flatten()
            else {
                continue;
            };
            if active(&task)
                && !matches!(task.status.as_str(), "waiting_permission" | "waiting_user")
            {
                continue;
            }
            let body = describe(app, &task)?;
            let signature = format!(
                "{}:{}:{}:{}",
                task.id,
                task.status,
                approvals(app, &task.id)?
                    .iter()
                    .map(|p| p["request_id"].as_str().unwrap_or_default())
                    .collect::<Vec<_>>()
                    .join(","),
                task.output
                    .as_ref()
                    .and_then(|o| o["question"]["id"].as_str())
                    .unwrap_or_default()
            );
            if peer.notified == signature {
                continue;
            }
            app.channels.store.update(|state| {
                if let Some(p) = state
                    .configs
                    .get_mut(&platform)
                    .and_then(|c| c.peers.iter_mut().find(|p| p.id == peer.id))
                {
                    p.notified = signature;
                }
                Ok(())
            })?;
            if app
                .channels
                .send(&platform, &cfg, peer, &body)
                .await
                .is_err()
            {
                app.channels.set_state(&platform, "delivery_error");
            }
        }
    }
    Ok(())
}
async fn send_welcomes(app: &App, only_platform: &str) -> Result<()> {
    for (platform, cfg) in app.channels.store.snapshot().configs {
        if !cfg.enabled || platform != only_platform {
            continue;
        }
        for peer in cfg.peers.iter().filter(|p| p.approved && p.welcome_pending) {
            // Persist consumption before sending: an ambiguous delivery is not
            // replayed after reconnect/restart or a repeated approval click.
            let claimed = super::conversations::update_peer(app, &platform, &cfg, peer, |p| {
                let pending = p.welcome_pending;
                p.welcome_pending = false;
                Ok(pending)
            })?;
            if !claimed {
                continue;
            }
            let body = super::navigation::welcome(app, &platform, &cfg, peer)?;
            if app
                .channels
                .send(&platform, &cfg, peer, &body)
                .await
                .is_err()
            {
                app.channels.set_state(&platform, "delivery_error");
            }
        }
    }
    Ok(())
}
pub async fn run(app: App, platform: &'static str) {
    loop {
        // Establish welcome choices before accepting a newly approved peer's
        // first reply, so a queued number refers to the displayed menu.
        if send_welcomes(&app, platform).await.is_err() {
            app.channels.set_state(platform, "delivery_error");
        }
        if app
            .channels
            .store
            .snapshot()
            .inbox
            .iter()
            .any(|m| m.platform == platform)
            && let Ok(Some(message)) = app.channels.store.update(|state| {
                Ok(state
                    .inbox
                    .iter()
                    .position(|m| m.platform == platform)
                    .and_then(|i| state.inbox.remove(i)))
            })
        {
            let platform = message.platform.clone();
            if incoming(&app, message).await.is_err() {
                app.channels.set_state(&platform, "delivery_error");
            }
        }
        if notify(&app, platform).await.is_err() { /* A transient state read does not replay submissions. */
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}
