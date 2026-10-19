//! Project selection and conversation bookmarks belong to one approved peer.
use super::*;
use crate::domain::task::Task;

const PAGE_SIZE: usize = 8;

fn line(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect()
}

pub(super) fn workspace(app: &App, cfg: &ChannelConfig, peer: &Peer) -> Result<String> {
    if let Some(task) = peer
        .task
        .as_deref()
        .map(|id| app.db.task(id))
        .transpose()?
        .flatten()
    {
        return Ok(app
            .db
            .member(&task.assigned_member)?
            .ok_or_else(|| anyhow::anyhow!("会话环境已删除，请发送 /new 项目ID"))?
            .cwd);
    }
    Ok(if peer.cwd.is_empty() {
        cfg.cwd.clone()
    } else {
        peer.cwd.clone()
    })
}

pub(super) fn summary(app: &App, cfg: &ChannelConfig, peer: &Peer) -> Result<String> {
    let cwd = workspace(app, cfg, peer)?;
    if cwd.is_empty() {
        return Ok("尚未选择项目。发送 /projects 查看项目，/project 项目ID 选择项目。".into());
    }
    let name = app
        .db
        .projects()?
        .into_iter()
        .find(|p| p.device_id == "local" && p.cwd == cwd)
        .map(|p| p.name)
        .unwrap_or_else(|| {
            std::path::Path::new(&cwd)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| cwd.clone())
        });
    Ok(format!("项目：{}\n工作目录：{cwd}", line(&name)))
}

pub(super) fn history(app: &App, peer: &Peer) -> Result<Vec<ChannelConversation>> {
    let mut entries = peer.conversations.clone();
    // Upgrade old bindings lazily, without importing any other desktop/peer task.
    if let Some(task) = peer
        .task
        .as_deref()
        .map(|id| app.db.task(id))
        .transpose()?
        .flatten()
        && !entries.iter().any(|entry| entry.task == task.id)
        && let Some(member) = app.db.member(&task.assigned_member)?
    {
        entries.push(ChannelConversation {
            id: task.id.clone(),
            task: task.id,
            cwd: member.cwd,
            title: task.title,
        });
    }
    Ok(entries)
}

pub(super) fn update_peer<T>(
    app: &App,
    platform: &str,
    cfg: &ChannelConfig,
    peer: &Peer,
    action: impl FnOnce(&mut Peer) -> Result<T>,
) -> Result<T> {
    app.channels.store.update(|state| {
        let current = state
            .configs
            .get_mut(platform)
            .filter(|c| c.enabled && c.generation == cfg.generation)
            .and_then(|c| {
                c.peers
                    .iter_mut()
                    .find(|p| p.id == peer.id && p.approved && p.task == peer.task)
            })
            .ok_or_else(|| anyhow::anyhow!("连接或会话已变化，请重新发送命令"))?;
        action(current)
    })
}

pub(super) fn remember(peer: &mut Peer, task: &Task, cwd: &str) {
    if let Some(entry) = peer
        .conversations
        .iter_mut()
        .find(|c| Some(&c.task) == peer.task.as_ref())
    {
        entry.task = task.id.clone();
    } else {
        peer.conversations.push(ChannelConversation {
            id: task.id.clone(),
            task: task.id.clone(),
            cwd: cwd.into(),
            title: task.title.clone(),
        });
    }
    peer.task = Some(task.id.clone());
    peer.cwd = cwd.into();
    peer.notified.clear();
}

fn ensure_idle(app: &App, peer: &Peer) -> Result<()> {
    if let Some(task) = peer
        .task
        .as_deref()
        .map(|id| app.db.task(id))
        .transpose()?
        .flatten()
    {
        ensure!(
            !super::dispatch::active(&task),
            "当前任务还在执行，请先 /cancel 或等待完成"
        );
        if let Some(binding) = app.db.binding(&task.id)? {
            ensure!(
                !app.db
                    .conversation_tasks(&task.assigned_device, &binding)?
                    .iter()
                    .any(super::dispatch::active),
                "当前会话还在执行，请先在电脑端取消或等待完成"
            );
        }
    }
    Ok(())
}

struct Project {
    id: String,
    name: String,
    cwd: String,
}
fn projects(app: &App, cfg: &ChannelConfig, peer: &Peer) -> Result<Vec<Project>> {
    let mut projects = vec![];
    if !cfg.cwd.is_empty() {
        projects.push(Project {
            id: "default".into(),
            name: "默认项目".into(),
            cwd: cfg.cwd.clone(),
        });
    }
    projects.extend(
        app.db
            .projects()?
            .into_iter()
            .filter(|p| p.device_id == "local")
            .map(|p| Project {
                id: p.id,
                name: p.name,
                cwd: p.cwd,
            }),
    );
    projects.extend(crate::ax::projects().into_iter().map(|p| {
        Project {
            id: format!("ax:{}", p.id),
            name: std::path::Path::new(&p.root)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.root.clone()),
            cwd: p.root,
        }
    }));
    if !peer.cwd.is_empty() && !projects.iter().any(|p| p.cwd == peer.cwd) {
        projects.push(Project {
            id: "current".into(),
            name: "已选项目".into(),
            cwd: peer.cwd.clone(),
        });
    }
    projects.retain(|p| {
        std::path::Path::new(&p.cwd).is_absolute() && std::path::Path::new(&p.cwd).is_dir()
    });
    Ok(projects)
}

fn resolve_project(app: &App, cfg: &ChannelConfig, peer: &Peer, arg: &str) -> Result<String> {
    let arg = arg
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .unwrap_or(arg);
    let path = std::path::Path::new(arg);
    if path.is_absolute() {
        ensure!(
            arg.len() <= 4096 && path.is_dir(),
            "项目目录不存在，请填写现有绝对路径"
        );
        return Ok(arg.into());
    }
    let projects = projects(app, cfg, peer)?;
    if let Some(project) = projects.iter().find(|p| p.id == arg) {
        return Ok(project.cwd.clone());
    }
    let matching: Vec<_> = projects.iter().filter(|p| p.name == arg).collect();
    ensure!(
        matching.len() <= 1,
        "有多个同名项目，请使用 /projects 中的项目ID"
    );
    Ok(matching
        .first()
        .ok_or_else(|| {
            anyhow::anyhow!("找不到项目，请发送 /projects，或使用 /project 现有绝对路径")
        })?
        .cwd
        .clone())
}

fn page(arg: &str, count: usize) -> Result<(usize, usize)> {
    let page = if arg.is_empty() {
        1
    } else {
        arg.parse::<usize>()
            .map_err(|_| anyhow::anyhow!("页码须为正整数"))?
    };
    let pages = count.div_ceil(PAGE_SIZE).max(1);
    ensure!(page > 0 && page <= pages, "页码超出范围，共 {pages} 页");
    Ok((page, pages))
}

pub(super) fn command(
    app: &App,
    platform: &str,
    cfg: &ChannelConfig,
    peer: &Peer,
    text: &str,
) -> Result<Option<String>> {
    let (command, arg) = text
        .split_once(char::is_whitespace)
        .map(|(a, b)| (a, b.trim()))
        .unwrap_or((text, ""));
    match command {
        "/projects" => {
            let projects = projects(app, cfg, peer)?;
            let (page, pages) = page(arg, projects.len())?;
            let mut body = format!("本机项目（{page}/{pages} 页）：");
            for p in projects.iter().skip((page - 1) * PAGE_SIZE).take(PAGE_SIZE) {
                body.push_str(&format!(
                    "\n{}\n{}\n/project {}\n",
                    line(&p.name),
                    p.cwd,
                    p.id
                ));
            }
            body.push_str("\n/project 项目ID或名称或现有绝对路径 选择项目\n/projects 页码 翻页");
            Ok(Some(body))
        }
        "/project" | "/new" => {
            if command == "/project" && arg.is_empty() {
                return Ok(Some(format!(
                    "{}\n/project 项目ID或名称或现有绝对路径 切换项目",
                    summary(app, cfg, peer)?
                )));
            }
            ensure_idle(app, peer)?;
            let cwd = if arg.is_empty() {
                workspace(app, cfg, peer)?
            } else {
                resolve_project(app, cfg, peer, arg)?
            };
            ensure!(
                !cwd.is_empty(),
                "尚未选择项目，请发送 /projects，再发送 /project 项目ID"
            );
            super::validate_default_workspace(&cwd)?;
            let history = history(app, peer)?;
            update_peer(app, platform, cfg, peer, |p| {
                p.conversations = history;
                p.cwd = cwd.clone();
                p.task = None;
                p.notified.clear();
                Ok(())
            })?;
            Ok(Some(format!(
                "已准备新会话，发送文字开始。\n工作目录：{cwd}\n原会话保留，可用 /sessions 查看。"
            )))
        }
        "/sessions" => {
            let mut entries = history(app, peer)?;
            let mut existing = Vec::new();
            for entry in entries.drain(..).rev() {
                if let Some(task) = app.db.task(&entry.task)? {
                    existing.push((entry, task));
                }
            }
            let (page, pages) = page(arg, existing.len())?;
            let mut body = format!("此账号的历史会话（{page}/{pages} 页）：");
            for (entry, task) in existing.iter().skip((page - 1) * PAGE_SIZE).take(PAGE_SIZE) {
                body.push_str(&format!(
                    "\n{}{} [{}]\n{}\n/session {}\n",
                    if peer.task.as_deref() == Some(&entry.task) {
                        "当前："
                    } else {
                        ""
                    },
                    line(&entry.title),
                    task.status,
                    entry.cwd,
                    entry.id
                ));
            }
            if existing.is_empty() {
                body.push_str("\n还没有历史会话，发送文字即可开始。");
            }
            body.push_str("\n/session 会话ID 切换会话\n/sessions 页码 翻页");
            Ok(Some(body))
        }
        "/session" => {
            ensure_idle(app, peer)?;
            let history = history(app, peer)?;
            let entry = history
                .iter()
                .find(|c| c.id == arg)
                .ok_or_else(|| anyhow::anyhow!("找不到此账号的会话，请发送 /sessions"))?
                .clone();
            let task = app
                .db
                .task(&entry.task)?
                .ok_or_else(|| anyhow::anyhow!("会话已删除，请发送 /sessions"))?;
            let member = app
                .db
                .member(&task.assigned_member)?
                .ok_or_else(|| anyhow::anyhow!("会话环境已删除"))?;
            ensure!(
                member.device_id == "local" && member.cwd == entry.cwd,
                "会话环境已变化，请在电脑端检查"
            );
            super::validate_default_workspace(&entry.cwd)?;
            update_peer(app, platform, cfg, peer, |p| {
                p.conversations = history;
                p.cwd = entry.cwd.clone();
                p.task = Some(entry.task.clone());
                p.notified.clear();
                Ok(())
            })?;
            Ok(Some(format!(
                "已切换会话：{}\n工作目录：{}\n/status 查看状态和结果，发送文字继续。",
                line(&entry.title),
                entry.cwd
            )))
        }
        _ => Ok(None),
    }
}
