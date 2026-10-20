# Chat channels

Settings → Chat platforms lists **Slack, Discord, Telegram, Webex, WeCom,
Feishu, Microsoft Teams, personal Weixin/WeChat, iMessage and WhatsApp**. Select
one platform to show its configuration. Inputs and QR progress are retained while
switching within the page. Selection never enables or saves a channel. Narrow
windows use a horizontally scrollable selector; keyboard arrows/Home/End also
switch platforms. Connections contains device and SSH settings only.

Every platform has a receiver and reply adapter, but no channel is connected
until its prerequisites and credentials are supplied. The UI reports provider
connection state separately from saved configuration. iMessage remains visible
but configuration is disabled when the server is not running on macOS.

Slack, Discord, WeCom and Feishu use outbound WebSockets; Telegram, Weixin and
Webex use outbound HTTPS polling. iMessage uses a local `imsg rpc` child and
WhatsApp a supervised Node.js companion. **Teams requires a public HTTPS callback**
and a single-tenant Azure Bot. No shared AXCrew relay is used. AX and a configured
model are needed to execute tasks. Native Android LAN pairing is unchanged.

## Configure and authorize

The **default project directory** is optional. It is used for a peer that has not
selected a project. With no default, connect/pair normally, then choose a project
in chat before sending a task. A configured nonempty default must be an existing
absolute directory. Changing the default never moves an existing conversation or
overrides a peer's selected project.

- Slack: create/install a Slack app, enable Socket Mode and subscribe to
  `message.im`. Bot Token needs `chat:write` and `im:history`; App Token needs
  `connections:write`. Both secrets are protected; reading status never returns
  either. Only ordinary DM messages are admitted, not bot/subtype/group events.
- Discord: create a bot in the Developer Portal and supply its Bot Token.
  The gateway uses only `DIRECT_MESSAGES` intent, heartbeats and acknowledgement
  checks. Guild messages, webhooks and other bots are ignored. Replies disable
  automatic mentions. Reconnects establish a fresh gateway session; messages
  during a disconnected interval are not guaranteed to be replayed.
- Webex: create a bot and supply its Bot Access Token. AXCrew lists direct rooms
  and polls each room every cycle (five-second pause between cycles). This
  bounded adapter supports fewer than 100 direct rooms and at most 100 unread
  messages per room per catchup; exceeding either limit reports a connection
  error instead of silently advancing past missing messages. Initial activation
  starts at the current time; group rooms and the bot's own messages are ignored.
- WeCom: create an AI bot using long-connection mode, supply Bot ID and Secret.
  Only `single` text callbacks are accepted. Replies use acknowledged
  `aibot_send_msg` private pushes; WeCom's proactive-send quotas apply.
- Microsoft Teams: create a **single-tenant** Azure Bot, enable its Teams channel,
  and provide Application ID, Client Secret, Tenant ID and public HTTPS origin.
  Set Azure's messaging endpoint to that origin plus `/api/messaging/teams`.
  Deploy a reverse proxy/tunnel forwarding only this route to the local server;
  this page does not create the proxy, bind a public listener or provision TLS.
  The server verifies Microsoft RS256 signatures, expiry/not-before, issuer,
  application audience, signing-key endorsements when present and the service-URL
  claim. Only personal conversations from the configured tenant are admitted.
  Reply origins are restricted to Microsoft Bot Framework/Teams service hosts.
  The status is `waiting_webhook` after token validation and `connected` after
  a valid personal message; this is not an automatic reachability test.
- iMessage: run AXCrew on a Mac signed into Messages, install `imsg`, and grant
  Full Disk Access and Messages Automation. Optional executable/database paths
  are passed as arguments, never shell text. The child uses JSON-RPC watch/send;
  only explicitly private incoming iMessage texts are admitted, not SMS, group
  messages or outgoing echoes. Watching starts at the current tail and does not
  replay historical messages. Windows/Linux cannot enable this channel.
- WhatsApp: install Node.js 20+ (with npm), click **Install / repair connection
  component** while the channel is disabled, then save/connect and scan from
  WhatsApp → Linked devices. The component uses pinned Baileys 7.0.0-rc14 and a
  lockfile embedded in the server, installed under `chat-runtime/whatsapp` beside
  the database. The companion is embedded too; no development checkout is needed
  at runtime. Optional Node executable path can override `node`. It uses the
  unofficial WhatsApp Web protocol, so platform/account restrictions may apply.
  Only new private texts from other accounts are accepted; groups, status feeds,
  historical sync, media and outgoing echoes are ignored. Link credentials and
  Signal keys are persisted through the protected channel store, never plaintext
  auth files. Phone-side logout clears local auth and peer bindings. Disconnect
  removes local auth/bindings; remove the linked device on the phone to revoke it
  at WhatsApp too. No personal account or phone number is included in the app.
- Personal Weixin uses Tencent's published iLink/ClawBot protocol. Choose Weixin
  QR login, scan and confirm in Weixin, and enter a verification code if requested.
  Account eligibility and interface availability are controlled by Weixin. No
  injected personal-account client or OpenClaw runtime is installed.
- Feishu needs an internal app with a bot, private-message receive/read and bot
  send permissions, and the `im.message.receive_v1` event subscribed using long
  connection. Publish/enable the app and grant the intended user access. Enter
  App ID and App Secret. Group webhook bots are not incoming-message apps.
- Telegram needs a BotFather Bot Token and access to `api.telegram.org`. Use a
  dedicated bot without a webhook or another `getUpdates` consumer. AXCrew does
  not delete another app's webhook. Initial connection skips old updates; messages
  older than five minutes are ignored.

After connecting, generate a five-minute `/pair ...` command on the computer,
send it in the bot's private chat, then approve the displayed sender ID on the
computer. Knowing the bot address does not authorize control. Commands are
single-use, not restored across restarts, and do not themselves approve peers.
At most 64 peers per platform are retained; pending requests expire.

Disable stops connection/submission/replies and discards queued messages. Disconnect and remove credentials
also removes bindings and queued messages. Replacing credentials clears bindings;
a different bot cannot inherit authorization. Revoke removes one peer's access.
These actions do not delete conversations or cancel work already accepted.

## First-use guidance

The first desktop approval of a new binding queues a welcome message with a live
numbered main menu. The platform dispatcher consumes the protected per-peer
`welcome_pending` flag before attempting delivery; repeated approval clicks,
reconnects and restarts do not replay an attempted welcome. A pending unsent flag
survives restart. Old bindings default to no pending welcome, and revocation or
credential replacement removes the binding/flag. A disabled platform waits until
enabled. Failed/ambiguous welcome sends report delivery error and are not retried
automatically; users can send `菜单` or a help phrase to open the menu themselves.

Welcome messages are dispatched before admitted chat input. If a peer already has
a selection menu, it remains current; active work receives a brief welcome with
status/cancel hints instead of a numeric selector. No model/task is created for
welcome/help navigation.

An ordinary first task with no selected/default project opens the numbered project
menu and explicitly says that the original task has not been submitted. After
selecting a project, resend the task text; it is not silently queued or executed.
New-conversation/project/history confirmations include a brief reminder to send
`菜单`. Ordinary task responses do not repeat the full help text.

## Natural-language navigation and numbered menus

Navigation is deterministic program logic; no model/classifier is called to
interpret management messages. It recognizes the following complete phrases
(with optional trailing Chinese/English sentence punctuation):

- `菜单`, `会话菜单`, `帮助`, `返回菜单`, `怎么用`, `怎么使用`, `你能做什么`: main menu.
- `切换项目`, `换个项目`, `选择项目`, `查看项目`, `项目列表`: numbered local project menu.
- `历史会话`, `查看历史会话`, `查看会话`, `切换会话`, `会话列表`: numbered own-peer history menu.
- `新建会话`, `新开会话`, `新建聊天`, `开启新会话`, `新会话`, `开个新会话`: new conversation in the
  current project. With no selected/default directory, opens the project menu.
- `当前项目`, `查看当前项目`, `当前在哪个项目`, `查看状态`, `任务状态`: project/task status.
- `取消任务`, `取消当前任务`, `停止任务`, `停止当前任务`: cancel the current task.

`切换到 项目名`, `切换到项目 项目名`, `切换项目到 项目名`, `换到 项目名`,
`切换项目 项目名` and `新建会话 项目名` accept the existing exact project ID/name or
absolute-directory syntax. The `切换项目` and `新建会话` argument forms also accept
Chinese/English colons. These are fixed syntactic forms, not fuzzy semantic search.
Existing slash commands remain available. Unmatched text follows ordinary AX chat
submission (or the project chooser when no workspace is selected); development requests merely mentioning navigation are not intercepted.

Menus show at most eight numbered choices per page. Reply `1`, `选择1`, `选1`,
`第一个` or a full-width digit to choose; `上一页`/`下一页` page through a list,
`返回`/`返回菜单` open the main menu and `取消选择` closes it. Explicit `取消菜单`,
`关闭菜单`, `退出菜单` also close it; `取消`/`不选了` close only an open menu and
never cancel a task. Use `取消任务` for task cancellation.

Numbers select only within the same approved platform/sender/chat menu. Choices
are snapshots of the displayed directory/session IDs; changes in catalog order do
not renumber an already displayed menu. Each opened page is valid for five minutes.
Invalid numbers retain the current menu and return a hint. A valid choice consumes
it once and uses the existing workspace, ownership, active-task and approval checks.
A generation/current-conversation/selected-directory change invalidates the menu.
Missing directories/history entries return errors without moving the conversation.

Any other ordinary text or slash command closes a pending menu. Without a menu,
numbers are ordinary conversation text. Menus are in-memory and are discarded at
server restart; project selection/history remains persisted. An expired or stale
menu reply returns a refresh hint rather than executing a task. Navigation menus
cannot be opened while the current conversation has active work, questions or
approvals. If a question/task starts after a menu opens, the menu is discarded and
numeric text uses the existing task/answer flow, preserving question option replies.

## Commands and scope

Only approved private text chats are accepted. Groups, bot-originated messages and
media are ignored. Each platform/sender/chat binding owns an independent current
conversation. Plain text starts a local AX session or continues that conversation.
Project selection is independent for each platform/sender/chat binding.
Authorization permits selecting existing local projects/directories through AX permissions;
separate conversations are not per-account filesystem sandboxes.

- `/help`, `/start`: command help.
- `/projects [page]`: list available local Crew projects, registered local AX
  workspaces, the default and the peer's selected directory. Lists use eight
  entries per page and include copyable selection commands; remote projects and
  missing directories are omitted.
- `/project`: show the current project. `/project <project ID, exact name or
  existing absolute directory>` selects a project and prepares a fresh conversation.
  IDs in the list are stable; ambiguous names require an ID. Quoted paths with
  spaces are accepted. `default` selects the configured default directory.
- `/new [project ID, exact name or existing absolute directory]`: prepare a new
  conversation in the current project, or select the supplied project. The first
  ordinary text creates its first task. Existing conversations remain available.
- `/sessions [page]`: list only conversations created by this peer through this
  channel, across its projects, eight per page. Existing pre-upgrade current
  bindings are retained lazily; discarded pre-upgrade history cannot be recovered.
- `/session <conversation ID>`: switch to an entry from this peer's history and
  restore its original workspace. The stable conversation ID is its first stored
  task ID; subsequent turns update its latest task without adding duplicate entries.
  Desktop-only conversations and another peer's IDs cannot be selected.
- `/status`: current project/directory, task, terminal text and pending questions/approvals.
- `/cancel`: cancel this peer's current task.
- `/allow <request_id>`: allow one pending tool action in this conversation.
- `/deny <request_id>`: reject one pending tool action in this conversation.

New/project/history switches require current work, including pending questions or
approvals, to finish or be cancelled first. Active desktop turns in the same bound
conversation also prevent leaving it. Switching does not cancel or move work.
Deleted history tasks are omitted from the list; selecting one or a missing
workspace returns an error. Project and history commands are handled directly by
Crew rather than passed to the model.

Session/question APIs and ApprovalBroker remain authoritative. Channel turns
narrow Allow environments to Ask and retain Deny environments. There is no chat
command for Allow All, session-wide approval, trust management, model/platform
secret access or selecting someone else's task. Approvals must still be pending
and map to the current task's event index. Other text while work is active gets
a status/cancel hint; waiting-user questions use the existing answer flow.

Final results, questions and approval prompts are polled and returned as plain
text. Replies use 1,500-character chunks, capped at 12,000 characters; the full
output stays on the desktop. This version does not stream every token, transfer
files, support groups, select remote environments or switch models in chat.

## Reliability

Platforms have independent receiver/reconnect and dispatch loops. Saving one
platform only restarts that platform. Configuration generations prevent stale
connections from admitting messages or persisting credentials after replacement. Telegram offsets
and Weixin cursors persist. Feishu acknowledges after bounded local admission.
The inbox holds 128 messages; the deduplication window retains 4,096 IDs.

Admission persists before acknowledging/advancing the provider cursor. Processing
removes a message before submitting its mutation, favoring duplicate prevention:
a crash in this window can lose a submission/acknowledgement. Mutations and
ambiguous outgoing sends are not automatically retried. Failed notifications are
not repeatedly replayed; check `/status` or desktop state before resubmitting.
This is not transactional exactly-once delivery across a chat platform and Crew.

## Storage and management API

`chat-channels.dat` beside the Crew database contains configuration, credentials,
bindings, each peer's selected directory and conversation bookmarks, cursors and
the bounded inbox. Older sidecars load with empty project/history fields.
Writes persist before memory changes.
Windows uses current-user DPAPI for the entire file. On Unix the JSON sidecar is
created with owner-only mode 0600; protect its directory/backups. Never upload it.
Status returns no app secrets, bot tokens or Weixin context/login tokens.

Only the desktop administrator token can manage channels:

- `GET /api/channels`: redacted status for all ten platforms.
- `PUT /api/channels/{platform}`: `{enabled,cwd,app_id?,secret?,app_token?,tenant_id?,public_url?,bridge_path?,database_path?}`; an omitted/empty
  secret/App Token retains the stored credential. Status additionally exposes
  `available`, `app_token_configured`, non-secret bridge/tenant/public URL fields,
  and the current WhatsApp QR challenge for the desktop only. Enabling requires credentials; `cwd` may be empty. A nonempty default must be an existing absolute directory.
- `POST /api/channels/whatsapp/install`: desktop-admin installation/repair of the
  pinned optional companion dependency. Requires Node.js/npm and network access.
- `POST /api/messaging/teams`: Microsoft-authenticated public Bot Framework
  ingress (256 KiB body limit), **not** authenticated with the Crew admin token.
- `DELETE /api/channels/{platform}`: disconnect and remove credentials/bindings.
- `POST /api/channels/{platform}/pairing`: one-time command and expiry.
- `POST /api/channels/{platform}/peers/{id}/approve` and
  `DELETE /api/channels/{platform}/peers/{id}`: approve/revoke an account.
- `POST /api/channels/weixin/login`: temporary QR challenge.
- `POST /api/channels/weixin/login/status`: `{id,verify_code?}`; saves credentials
  on confirmation and returns only the login status.

Weixin redirects/API origins must be HTTPS under `weixin.qq.com`; discovered
Feishu sockets must be WSS on allowed Feishu/Lark hosts. HTTP redirects are not
followed. TLS certificate verification remains enabled.

Messages, commands, approval summaries and replies pass through the chosen chat
platform. This is not an end-to-end encrypted Crew tunnel through that provider.
Local adapter/flow validation does not establish live account delivery: actual
Weixin eligibility, Feishu publication/permissions and Telegram credentials still
need user-account validation. New adapter validation uses local protocol fixtures;
actual provider delivery, account eligibility and macOS permissions require live
account/device validation. Compilation does not establish that these are working
with a particular real account.

## Source references

- [Tencent Weixin protocol](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)
- [Feishu official SDK](https://github.com/larksuite/oapi-sdk-python/blob/v2_main/lark_oapi/ws/client.py)
- [Telegram Bot API](https://core.telegram.org/bots/api)

Weixin follows the published 2.4.10 client wire convention, declaring AXCrew's own
bot-agent identifier. Feishu framing follows the official protobuf wire contract.
New platforms should use separate adapters and reuse local authorization and the
normal session API.

Upstream MIT notices are retained in `licenses/feishu-sdk-MIT.txt` and
`licenses/tencent-weixin-MIT.txt`.

Additional protocol references:
- [Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)
- [Discord Gateway](https://discord.com/developers/docs/events/gateway)
- [Webex messages](https://developer.webex.com/messaging/docs/api/v1/messages)
- [WeCom official SDK](https://github.com/WecomTeam/aibot-node-sdk)
- [Teams authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication)
- [imsg JSON-RPC](https://github.com/openclaw/imsg/blob/main/docs/rpc.md)
- [Baileys](https://github.com/WhiskeySockets/Baileys)
