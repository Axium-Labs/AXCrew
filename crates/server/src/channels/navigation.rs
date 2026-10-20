//! Deterministic chat navigation. No model calls; menu numbers refer to a snapshot.
use super::{conversations, *};

const MENU_TTL: i64 = 300;

pub(super) enum Action {
    Reply(String),
    Command(String),
}

#[derive(Clone, Copy)]
enum Kind {
    Main,
    Projects,
    Sessions,
}

#[derive(Clone)]
enum Choice {
    Menu(Kind),
    Command(String),
}

#[derive(Clone)]
pub(super) struct Menu {
    expires_at: i64,
    generation: String,
    task: Option<String>,
    cwd: String,
    kind: Kind,
    page: usize,
    pages: usize,
    choices: Vec<Choice>,
}

fn clear(app: &App, platform: &str, peer: &Peer) {
    app.channels
        .menus
        .lock()
        .unwrap()
        .remove(&(platform.into(), peer.id.clone()));
}

fn preview(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(120)
        .collect()
}

fn open(
    app: &App,
    platform: &str,
    cfg: &ChannelConfig,
    peer: &Peer,
    kind: Kind,
    requested_page: usize,
) -> Result<Action> {
    // Never arm a numeric selector alongside a live task question/approval.
    conversations::ensure_idle(app, peer)?;
    let mut rows = Vec::new();
    let title = match kind {
        Kind::Main => {
            rows.extend([
                ("切换项目".into(), Choice::Menu(Kind::Projects)),
                ("新建会话".into(), Choice::Command("/new".into())),
                ("查看历史会话".into(), Choice::Menu(Kind::Sessions)),
                (
                    "查看当前项目和状态".into(),
                    Choice::Command("/status".into()),
                ),
            ]);
            "会话菜单"
        }
        Kind::Projects => {
            let mut seen = std::collections::HashSet::new();
            for project in conversations::projects(app, cfg, peer)? {
                // Prefer the existing catalog order, while avoiding duplicate folders.
                if seen.insert(project.cwd.clone()) {
                    rows.push((
                        format!("{}\n   {}", preview(&project.name), preview(&project.cwd)),
                        Choice::Command(format!("/project {}", project.cwd)),
                    ));
                }
            }
            "选择项目（选中后准备新会话）"
        }
        Kind::Sessions => {
            for entry in conversations::history(app, peer)?.into_iter().rev() {
                if let Some(task) = app.db.task(&entry.task)? {
                    rows.push((
                        format!(
                            "{}{} [{}]\n   {}",
                            if peer.task.as_deref() == Some(&entry.task) {
                                "当前："
                            } else {
                                ""
                            },
                            preview(&entry.title),
                            task.status,
                            preview(&entry.cwd)
                        ),
                        Choice::Command(format!("/session {}", entry.id)),
                    ));
                }
            }
            "选择历史会话"
        }
    };
    let pages = rows.len().div_ceil(conversations::PAGE_SIZE).max(1);
    let page = requested_page.min(pages - 1);
    let mut body = format!("{title}（{}/{} 页）", page + 1, pages);
    let mut choices = Vec::new();
    for (index, (label, choice)) in rows
        .into_iter()
        .skip(page * conversations::PAGE_SIZE)
        .take(conversations::PAGE_SIZE)
        .enumerate()
    {
        body.push_str(&format!("\n{}. {label}", index + 1));
        choices.push(choice);
    }
    if choices.is_empty() {
        body.push_str(match kind {
            Kind::Projects => {
                "\n还没有可用项目。可以发送“切换项目 现有绝对路径”，或在电脑端添加项目。"
            }
            _ => "\n还没有历史会话，可以发送“新建会话”。",
        });
    } else {
        body.push_str("\n回复编号选择，五分钟内有效。");
    }
    if page > 0 {
        body.push_str("发送“上一页”翻页。");
    }
    if page + 1 < pages {
        body.push_str("发送“下一页”翻页。");
    }
    body.push_str("\n发送“返回菜单”返回，或“取消选择”关闭；其他文字照常聊天并关闭菜单。");
    let state = app.channels.store.snapshot();
    let mut menus = app.channels.menus.lock().unwrap();
    // Keep an expired peer's snapshot until its next reply so a late number gets
    // an expiry hint even if another peer has since opened a menu. Prune revoked
    // peer identities instead; the store already bounds approved peers.
    menus.retain(|(platform, id), _| {
        state
            .configs
            .get(platform)
            .is_some_and(|cfg| cfg.peers.iter().any(|peer| peer.id == *id && peer.approved))
    });
    menus.insert(
        (platform.into(), peer.id.clone()),
        Menu {
            expires_at: unix_now() + MENU_TTL,
            generation: cfg.generation.clone(),
            task: peer.task.clone(),
            cwd: peer.cwd.clone(),
            kind,
            page,
            pages,
            choices,
        },
    );
    Ok(Action::Reply(body))
}

pub(super) fn choose_project(
    app: &App,
    platform: &str,
    cfg: &ChannelConfig,
    peer: &Peer,
) -> Result<String> {
    let Action::Reply(menu) = open(app, platform, cfg, peer, Kind::Projects, 0)? else {
        unreachable!()
    };
    Ok(format!(
        "尚未选择项目，请先回复编号选择。刚才的任务尚未提交，选好项目后请重新发送任务内容。\n\n{menu}"
    ))
}

pub(super) fn welcome(
    app: &App,
    platform: &str,
    cfg: &ChannelConfig,
    peer: &Peer,
) -> Result<String> {
    let greeting = "账号绑定成功，欢迎使用 AXCrew！直接发送文字即可开始或继续聊天。";
    if conversations::ensure_idle(app, peer).is_err() {
        return Ok(format!(
            "{greeting}\n可发送“查看状态”或“取消任务”；当前工作结束后，随时发送“菜单”查看操作。"
        ));
    }
    // Approval delivery can race an inbound menu request. Keep its displayed
    // numbers intact rather than replacing the user's current selection.
    let has_menu = app
        .channels
        .menus
        .lock()
        .unwrap()
        .get(&(platform.into(), peer.id.clone()))
        .is_some_and(|m| {
            m.expires_at > unix_now()
                && m.generation == cfg.generation
                && m.task == peer.task
                && m.cwd == peer.cwd
        });
    if has_menu {
        return Ok(format!(
            "{greeting}\n请继续使用刚才的选择菜单；随时发送“菜单”查看全部操作。"
        ));
    }
    let Action::Reply(menu) = open(app, platform, cfg, peer, Kind::Main, 0)? else {
        unreachable!()
    };
    Ok(format!(
        "{greeting}\n下面是常用操作，回复编号即可选择；随时发送“菜单”重新打开。\n\n{menu}"
    ))
}

fn number(text: &str) -> Option<usize> {
    let text = text
        .strip_prefix("选择")
        .or_else(|| text.strip_prefix('选'))
        .or_else(|| text.strip_prefix('第'))
        .unwrap_or(text)
        .trim();
    let text = text
        .strip_suffix('个')
        .or_else(|| text.strip_suffix('项'))
        .unwrap_or(text)
        .trim();
    let text: String = text
        .chars()
        .map(|c| {
            if ('０'..='９').contains(&c) {
                char::from_u32(c as u32 - '０' as u32 + '0' as u32).unwrap()
            } else {
                c
            }
        })
        .collect();
    match text.as_str() {
        "一" => Some(1),
        "二" => Some(2),
        "三" => Some(3),
        "四" => Some(4),
        "五" => Some(5),
        "六" => Some(6),
        "七" => Some(7),
        "八" => Some(8),
        _ if !text.is_empty() && text.chars().all(|c| c.is_ascii_digit()) => {
            Some(text.parse().unwrap_or(usize::MAX))
        }
        _ => None,
    }
}

fn direct(text: &str) -> Option<String> {
    match text
        .trim_end_matches(['。', '！', '!', '？', '?'])
        .trim_end()
    {
        "新建会话" | "新开会话" | "新建聊天" | "开启新会话" | "新会话" | "开个新会话" =>
        {
            return Some("/new".into());
        }
        "当前项目"
        | "查看当前项目"
        | "当前在哪个项目"
        | "当前在哪个项目？"
        | "当前在哪个项目?"
        | "查看状态"
        | "任务状态" => return Some("/status".into()),
        "取消任务" | "取消当前任务" | "停止任务" | "停止当前任务" => {
            return Some("/cancel".into());
        }
        _ => {}
    }
    for prefix in [
        "切换到项目",
        "切换项目到",
        "切换到",
        "换到",
        "切换项目 ",
        "切换项目：",
        "切换项目:",
    ] {
        if let Some(arg) = text
            .strip_prefix(prefix)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return Some(format!("/project {arg}"));
        }
    }
    for prefix in ["新建会话 ", "新建会话：", "新建会话:"] {
        if let Some(arg) = text
            .strip_prefix(prefix)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return Some(format!("/new {arg}"));
        }
    }
    None
}

pub(super) fn handle(
    app: &App,
    platform: &str,
    cfg: &ChannelConfig,
    peer: &Peer,
    text: &str,
) -> Result<Option<Action>> {
    if text.starts_with('/') {
        clear(app, platform, peer);
        return Ok(None);
    }
    let phrase = text
        .trim_end_matches(['。', '！', '!', '？', '?'])
        .trim_end();
    let kind = match phrase {
        "菜单" | "会话菜单" | "帮助" | "返回菜单" | "怎么用" | "怎么使用" | "你能做什么" => {
            Some(Kind::Main)
        }
        "切换项目" | "换个项目" | "选择项目" | "查看项目" | "项目列表" => {
            Some(Kind::Projects)
        }
        "历史会话" | "查看历史会话" | "查看会话" | "切换会话" | "会话列表" => {
            Some(Kind::Sessions)
        }
        _ => None,
    };
    if let Some(kind) = kind {
        clear(app, platform, peer);
        return open(app, platform, cfg, peer, kind, 0).map(Some);
    }
    if let Some(command) = direct(text) {
        clear(app, platform, peer);
        if command == "/new" && conversations::workspace(app, cfg, peer)?.is_empty() {
            return open(app, platform, cfg, peer, Kind::Projects, 0).map(Some);
        }
        return Ok(Some(Action::Command(command)));
    }
    if matches!(phrase, "取消选择" | "取消菜单" | "关闭菜单" | "退出菜单") {
        clear(app, platform, peer);
        return Ok(Some(Action::Reply(
            "已关闭选择菜单，原项目和会话保持不变。发送文字继续聊天，或发送“菜单”重新打开。".into(),
        )));
    }
    let menu = app
        .channels
        .menus
        .lock()
        .unwrap()
        .get(&(platform.into(), peer.id.clone()))
        .cloned();
    let Some(menu) = menu else {
        return Ok(None);
    };
    if matches!(phrase, "取消" | "不选了") {
        clear(app, platform, peer);
        return Ok(Some(Action::Reply(
            "已关闭选择菜单，原项目和会话保持不变。发送文字继续聊天，或发送“菜单”重新打开。".into(),
        )));
    }
    let number = number(text);
    let paging = matches!(text, "上一页" | "下一页" | "返回");
    if number.is_none() && !paging {
        clear(app, platform, peer);
        return Ok(None);
    }
    if menu.expires_at <= unix_now()
        || menu.generation != cfg.generation
        || menu.task != peer.task
        || menu.cwd != peer.cwd
    {
        clear(app, platform, peer);
        return Ok(Some(Action::Reply(
            "菜单已过期或当前会话已变化，请发送“菜单”重新选择；本条没有执行任务或切换。".into(),
        )));
    }
    if conversations::ensure_idle(app, peer).is_err() {
        // A task/question started since the menu opened: preserve its answer path.
        clear(app, platform, peer);
        return Ok(None);
    }
    match text {
        "返回" => return open(app, platform, cfg, peer, Kind::Main, 0).map(Some),
        "上一页" if menu.page == 0 => {
            return Ok(Some(Action::Reply(
                "已经是第一页，请回复编号选择，或发送“取消选择”。".into(),
            )));
        }
        "下一页" if menu.page + 1 >= menu.pages => {
            return Ok(Some(Action::Reply(
                "已经是最后一页，请回复编号选择，或发送“取消选择”。".into(),
            )));
        }
        "上一页" => return open(app, platform, cfg, peer, menu.kind, menu.page - 1).map(Some),
        "下一页" => return open(app, platform, cfg, peer, menu.kind, menu.page + 1).map(Some),
        _ => {}
    }
    let index = number.unwrap_or(0);
    let Some(choice) = index
        .checked_sub(1)
        .and_then(|i| menu.choices.get(i))
        .cloned()
    else {
        return Ok(Some(Action::Reply(if menu.choices.is_empty() {
            "此菜单没有可选项，请发送“返回菜单”或“取消选择”。".into()
        } else {
            format!(
                "编号无效，请回复 1～{}，或发送“取消选择”。",
                menu.choices.len()
            )
        })));
    };
    clear(app, platform, peer);
    match choice {
        Choice::Menu(kind) => open(app, platform, cfg, peer, kind, 0).map(Some),
        Choice::Command(command)
            if command == "/new" && conversations::workspace(app, cfg, peer)?.is_empty() =>
        {
            open(app, platform, cfg, peer, Kind::Projects, 0).map(Some)
        }
        Choice::Command(command) => Ok(Some(Action::Command(command))),
    }
}
