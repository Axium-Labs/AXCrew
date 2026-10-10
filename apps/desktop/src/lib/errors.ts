import { invoke } from '@tauri-apps/api/core'
import { useLang } from './i18n'

/**
 * Errors shown to people must explain what happened in plain words. Every
 * backend request (`api`) and desktop command (`call`) converts its failure
 * here, so the existing `String(error)` call sites already display readable
 * text. The original message stays on `detail` and in the console for
 * diagnosis; it is never rendered.
 */
type Rule = [RegExp, string, string]

const RULES: Rule[] = [
  [/Choose an existing workspace directory|工作目录不可用|workspace (directory )?(is )?(unavailable|invalid)/i, '工作目录不存在或无法访问，请重新选择一个现有文件夹。', 'The workspace is missing or inaccessible. Choose an existing folder.'],
  [/failed to fetch|networkerror|load failed|network request failed|error sending request|connection (refused|reset)|os error (10061|10054|111|104)|econnrefused|econnreset/i, 'AX Crew 后台没有响应。请确认程序正在运行，稍后重试。', 'The AX Crew service is not responding. Make sure it is running and try again.'],
  [/admin token required|unauthori[sz]ed|\b401\b|forbidden|\b403\b/i, '连接凭据已失效。请重新打开 AX Crew 或重新配对设备。', 'The connection credential is no longer valid. Reopen AX Crew or pair this device again.'],
  [/timed out|timeout|deadline has elapsed|os error 10060/i, '操作超时了，请稍后重试。', 'The operation timed out. Please try again.'],
  [/remote device (offline|disconnected)|device closed before|device offline/i, '远程设备已离线。请确认对方电脑已开启并连接，然后重试。', 'The remote device is offline. Make sure it is on and connected, then try again.'],
  [/ssh connection not found|invalid ssh id/i, '找不到这个 SSH 连接，它可能已被删除。', 'This SSH connection no longer exists.'],
  [/not a registered ax workspace/i, '这个文件夹还没有在远程设备上用 AX 打开过。请先在那台设备上用 AX 打开它。', 'This folder has not been opened with AX on the remote device yet. Open it there first.'],
  [/method not found|-32601|unknown (sub)?command|unrecognized subcommand|unexpected argument/i, '当前安装的 AX 版本太旧，不支持这个功能。请在设置 → 本地 AX 中更新 AX。', 'The installed AX is too old for this feature. Update AX in Settings → Local AX.'],
  [/ax (acp )?(stdin|stdout) unavailable|ax acp process closed|ax omitted|ax prompt failed|remote (acp|ax|prompt failed|open)/i, 'AX 在处理时意外中断了。请重试；如果反复出现，请在设置中检查 AX。', 'AX stopped unexpectedly. Try again, and check AX in Settings if it keeps happening.'],
  [/ax home unavailable|cannot locate the ax executable|ax(\.exe)? .*not found|no such file.*\bax\b/i, '找不到本机的 AX。请在设置 → 本地 AX 中安装或更新 AX。', 'AX was not found on this computer. Install or update it in Settings → Local AX.'],
  [/os error (2|3)\b|no such file or directory|cannot find the (file|path)|找不到指定的(文件|路径)/i, '找不到需要的文件或文件夹，它可能已被移动或删除。', 'A required file or folder was not found; it may have been moved or deleted.'],
  [/os error (5|13)\b|permission denied|access is denied|拒绝访问/i, '没有权限访问这个文件或文件夹。', 'Permission to access this file or folder was denied.'],
  [/os error (32|33)\b|being used by another process|另一个程序正在使用/i, '文件正被其他程序占用，请关闭相关程序后重试。', 'The file is in use by another program. Close it and try again.'],
  [/database is locked|database is busy|sqlite_busy/i, '数据正忙，请稍后重试。', 'The data store is busy. Please try again shortly.'],
  [/unique constraint|already exists|name conflict|duplicate/i, '已经存在同名的项目，请换一个名称。', 'An item with the same name already exists. Choose another name.'],
  [/task cancelled|stopReason.*cancelled/i, '任务已取消。', 'The task was cancelled.'],
  [/permission request (not found|no longer active)/i, '这个授权请求已经结束，无需再处理。', 'This approval request has already ended.'],
  [/task is no longer accepting guidance|finished before guidance|finished without accepting guidance/i, '这轮工作已经结束，补充内容会作为新消息发送。', 'This turn already finished; send your note as a new message.'],
  [/(task|schedule|agent|crew|member|device|project|environment|session|instance|workflow|host)( is)? (not found|missing)|找不到该会话/i, '要操作的内容已不存在，可能已被删除。请刷新后重试。', 'That item no longer exists; it may have been deleted. Refresh and try again.'],
  [/task is not pending|task already finished|dependencies are not complete/i, '任务当前的状态不能执行这个操作。', 'The task is not in a state that allows this action.'],
  [/(invalid|malformed).*(json|body)|expected value at line|eof while parsing|missing field|unknown variant/i, '收到的数据格式不正确。请更新 AX Crew 后重试。', 'Received data in an unexpected format. Update AX Crew and try again.'],
]

/** Raw diagnostics that mean nothing to someone using the app. */
const TECHNICAL = /\bos error \d+|panicked at|thread '|json-?rpc|"code"\s*:|\{\s*"|\bat [\w$.]+ \(|\b(Error|Exception)\b\s*:|::|\\\\\?\\|\b[A-Z]:\\|\/(usr|home|tmp|mnt)\/|0x[0-9a-f]{6,}|\bstatus(code)?\s*[:=]?\s*[45]\d\d\b|\b[45]\d\d (bad|internal|not|service)/i

const zh = () => useLang.getState().lang === 'zh'

/** Plain-language text for a raw failure message. */
export function humanizeError(raw: string): string {
  const text = raw.replace(/^(Error|Uncaught \w*Error):\s*/i, '').trim()
  if (!text) return zh() ? '操作没有完成，请重试。' : 'The operation did not complete. Please try again.'
  for (const [pattern, chinese, english] of RULES) if (pattern.test(text)) return zh() ? chinese : english
  if (TECHNICAL.test(text) || text.length > 240) return zh() ? '操作没有完成，请重试。如果问题持续，请重启 AX Crew。' : 'The operation did not complete. Try again, or restart AX Crew if it keeps happening.'
  return text
}

export class FriendlyError extends Error {
  readonly detail: string
  constructor(detail: string) {
    super(humanizeError(detail))
    this.name = 'FriendlyError'
    this.detail = detail
  }
  // `String(error)` is how the UI renders failures; omit the "Error:" prefix.
  override toString() { return this.message }
}

/** Convert any thrown value once; already-friendly errors pass through. */
export function friendly(reason: unknown): FriendlyError {
  if (reason instanceof FriendlyError) return reason
  const detail = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : (() => { try { return JSON.stringify(reason) ?? String(reason) } catch { return String(reason) } })()
  console.error('[ax-crew]', detail)
  return new FriendlyError(detail)
}

/** Also covers diagnostics returned as response fields rather than exceptions. */
export function errorText(reason: unknown): string {
  if (reason instanceof FriendlyError) return reason.message
  return humanizeError(reason instanceof Error ? reason.message : String(reason))
}

/** `invoke` with readable failures. */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(command, args) } catch (reason) { throw friendly(reason) }
}
