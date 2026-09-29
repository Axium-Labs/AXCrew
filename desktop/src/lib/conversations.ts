import type { Session, Task } from './types'

export const isActiveTask = (task?: Task) => !!task && ['pending', 'ready', 'running', 'waiting_permission'].includes(task.status)
export type Conversation = { key: string; root: Task; latest: Task; binding?: Session; tasks: Task[] }

// Task IDs identify turns; device + AX session identifies the conversation.
export function conversations(bindings: Session[], tasks: Task[], startingIds: string[] = []): Conversation[] {
  const groups = new Map<string, { binding?: Session; tasks: Task[] }>()
  const byTask = new Map(bindings.map(binding => [binding.task_id, binding]))
  for (const task of tasks) {
    const binding = byTask.get(task.id)
    if (!binding && !startingIds.includes(task.id)) continue
    const key = binding ? `${binding.device_id}:${binding.ax_session_id}` : `starting:${task.id}`
    const group = groups.get(key) ?? { binding, tasks: [] }
    group.tasks.push(task)
    groups.set(key, group)
  }
  return [...groups].map(([key, group]) => {
    const ids = new Set(group.tasks.map(task => task.id))
    const depth = (task: Task): number => {
      const seen = new Set<string>(); let current: Task | undefined = task
      while (current?.parent_id && ids.has(current.parent_id) && !seen.has(current.parent_id)) {
        seen.add(current.parent_id); current = group.tasks.find(item => item.id === current!.parent_id)
      }
      return seen.size
    }
    const ordered = [...group.tasks].sort((a, b) => depth(a) - depth(b) || a.created_at - b.created_at || a.id.localeCompare(b.id))
    const latest = [...ordered].reverse().find(isActiveTask) ?? ordered[ordered.length - 1]
    return { key, root: ordered[0], latest, binding: byTask.get(latest.id) ?? group.binding, tasks: ordered }
  }).sort((a, b) => b.latest.created_at - a.latest.created_at)
}
