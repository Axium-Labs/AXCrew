import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type UnreadCompletion = { eventId: string; taskId: string; conversation?: string; failed: boolean }
type Attention = {
  unread: Record<string, UnreadCompletion>
  seen: string[]
  focused: boolean
  views: Record<string, string[]>
  setFocused: (focused: boolean) => void
  setView: (surface: string, keys: string[]) => void
  forget: (keys: string[]) => void
  complete: (completion: UnreadCompletion) => boolean
}
export const conversationIdentity = (device: string, session: string) => `${device}:${session}`
export const taskIdentity = (task: string) => `task:${task}`
const viewed = (item: UnreadCompletion, views: Record<string, string[]>) => Object.values(views).some(keys => keys.includes(taskIdentity(item.taskId)) || !!item.conversation && keys.includes(item.conversation))
const acknowledge = (unread: Attention['unread'], focused: boolean, views: Attention['views']) => {
  if (!focused) return unread
  const remaining = Object.entries(unread).filter(([, item]) => !viewed(item, views))
  return remaining.length === Object.keys(unread).length ? unread : Object.fromEntries(remaining)
}

// Task IDs identify individual turns. Conversation identities keep a completion
// attached to the same row even when a follow-up creates another task ID.
export const useAttention = create<Attention>()(persist((set, get) => ({
  unread: {}, seen: [], focused: false, views: {},
  setFocused: focused => set(state => ({ focused, unread: acknowledge(state.unread, focused, state.views) })),
  setView: (surface, keys) => set(state => {
    const views = { ...state.views, [surface]: keys }
    return { views, unread: acknowledge(state.unread, state.focused, views) }
  }),
  forget: keys => set(state => ({ unread: acknowledge(state.unread, true, { deleted: keys }) })),
  complete: item => {
    const state = get()
    if (state.seen.includes(item.eventId)) return false
    const reading = state.focused && viewed(item, state.views)
    set({ seen: [...state.seen.slice(-999), item.eventId], unread: reading ? state.unread : { ...state.unread, [item.taskId]: item } })
    return !reading
  },
}), { name: 'ax-crew-completion-attention', partialize: ({ unread, seen }) => ({ unread, seen }) }))

export function hasUnreadCompletion(unread: Attention['unread'], keys: string[]): boolean {
  return Object.values(unread).some(item => keys.includes(taskIdentity(item.taskId)) || !!item.conversation && keys.includes(item.conversation))
}
