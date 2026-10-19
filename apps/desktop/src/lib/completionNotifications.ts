import { isTauri, invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { conversationIdentity, useAttention } from '../store/attention'
import { useLang } from './i18n'
import { conversations, sessionTitle } from './conversations'
import { useSessionUi } from '../store/sessions'
import { queryClient } from './runtime'
import type { CrewEvent, LocalAxOverview, Session, Task } from './types'
import { modelConnection, modelConnectionText } from './modelConnection'

let nativeQueue = Promise.resolve()
function updateNative(alertTask?: string) {
  if (!isTauri()) return
  // Always read the newest state when the command runs: a read acknowledgment
  // must not be overwritten by an older badge update still waiting on IPC.
  nativeQueue = nativeQueue.then(async () => {
    const state = useAttention.getState()
    const count = new Set(Object.values(state.unread).map(item => item.conversation ?? item.taskId)).size
    await invoke('completion_attention', { unreadCount: count, alert: !!alertTask && !!state.unread[alertTask] && !state.focused })
  }).catch(error => console.warn('[ax-crew] Completion attention unavailable', error))
}

export function startCompletionNotifications() {
  let disposed = false, unlisten: (() => void) | undefined
  const focus = (value: boolean) => { if (!disposed) useAttention.getState().setFocused(value) }
  const browserFocus = () => focus(document.visibilityState !== 'hidden' && document.hasFocus())
  if (isTauri()) {
    const window = getCurrentWindow()
    let focusChanged = false
    // Subscribe before reading the initial state, so a late initial response
    // cannot overwrite a newer native focus event.
    void window.onFocusChanged(({ payload }) => { focusChanged = true; focus(payload) }).then(async stop => {
      if (disposed) { stop(); return }
      unlisten = stop
      const [focused, visible, minimized] = await Promise.all([window.isFocused(), window.isVisible(), window.isMinimized()])
      if (!focusChanged) focus(focused && visible && !minimized)
    }).catch(error => console.warn('[ax-crew] Window focus unavailable', error))
  } else {
    browserFocus()
    window.addEventListener('focus', browserFocus)
    window.addEventListener('blur', browserFocus)
    document.addEventListener('visibilitychange', browserFocus)
  }
  updateNative()
  const unsubscribe = useAttention.subscribe((state, previous) => {
    if (state.unread !== previous.unread || state.focused !== previous.focused) updateNative()
  })
  return () => {
    disposed = true; unlisten?.(); unsubscribe()
    window.removeEventListener('focus', browserFocus)
    window.removeEventListener('blur', browserFocus)
    document.removeEventListener('visibilitychange', browserFocus)
    useAttention.getState().setFocused(false)
  }
}

export async function notifyCompletion(event: CrewEvent) {
  if (!event.task_id || !['task.completed', 'task.failed'].includes(event.kind)) return
  const binding = queryClient.getQueryData<Session[]>(['sessions'])?.find(item => item.task_id === event.task_id)
  const session = event.session_id ?? binding?.ax_session_id
  const device = event.device_id ?? binding?.device_id
  const conversation = session && device ? conversationIdentity(device, session) : undefined
  const state = useAttention.getState()
  if (!state.complete({ eventId: event.event_id, taskId: event.task_id, conversation, failed: event.kind === 'task.failed' })) return
  // Codex's default turn-complete policy sounds only when the app is unfocused.
  // Other conversations still receive unread dots while the app is in use.
  if (state.focused || !isTauri()) return
  updateNative(event.task_id)
  try {
    let granted = await isPermissionGranted()
    if (!granted) granted = await requestPermission() === 'granted'
    if (!granted || useAttention.getState().focused || !useAttention.getState().unread[event.task_id]) return
    const tasks = queryClient.getQueryData<Task[]>(['tasks']) ?? []
    const group = conversations(queryClient.getQueryData<Session[]>(['sessions']) ?? [], tasks, [event.task_id]).find(item => item.tasks.some(task => task.id === event.task_id))
    const task = group?.root ?? tasks.find(item => item.id === event.task_id)
    const zh = useLang.getState().lang === 'zh'
    const local = device === 'local' ? queryClient.getQueryData<LocalAxOverview>(['localAx'])?.projects.flatMap(project => project.sessions).find(item => item.id === session) : undefined
    const metadata = useSessionUi.getState().metadata
    const title = (conversation ? metadata[conversation]?.title : undefined) ?? sessionTitle(task?.title, local?.title, zh ? 'AX Crew 会话' : 'AX Crew conversation')
    const connection = modelConnection(event.payload.model_connection) ?? modelConnection(task?.output?.model_connection)
    const failureTitle = connection?.status === 'failed' ? modelConnectionText(connection, zh ? 'zh' : 'en') : (zh ? '任务失败' : 'Task failed')
    sendNotification({ title: event.kind === 'task.completed' ? (zh ? '任务已完成' : 'Task completed') : failureTitle, body: title, sound: '' })
  } catch (error) { console.warn('[ax-crew] Completion notification unavailable', error) }
}
