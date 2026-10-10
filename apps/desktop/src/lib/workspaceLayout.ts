export const CHAT_MIN = 520
export const CHAT_TARGET = 560
export const DEFAULT_SPLIT = .45
export const LIST_WIDTH = 280
export const PANEL_GAP = 10
const RESTORE_MARGIN = 24

export type LayoutInput = {
  width: number; navigation: boolean; list: boolean; right: boolean
  rightTab: 'files' | 'chat' | 'details'; chat: boolean; ratio: number
}
export type WorkspaceLayout = {
  navigation: 'expanded' | 'compact' | 'hidden'
  navigationWidth: number; listDocked: boolean
  rightMode: 'closed' | 'docked' | 'drawer' | 'full'
  workspaceWidth: number; splitWidth: number; chatWidth: number; rightWidth: number; rightMin: number
}
export function clampSplit(ratio: number, width: number, rightMin: number) {
  const usable = Math.max(0, width)
  const preferred = Number.isFinite(ratio) ? ratio : DEFAULT_SPLIT
  return Math.max(0, Math.min(980, usable - CHAT_MIN, Math.max(rightMin, usable * preferred)))
}

/** One budget, measured outside the panels. Automatic decisions never write preferences. */
export function resolveWorkspaceLayout(input: LayoutInput, previous?: WorkspaceLayout): WorkspaceLayout {
  const width = Math.max(0, input.width), rightMin = input.rightTab === 'files' ? 420 : 320
  const chatVisible = input.chat || !input.right
  const rightNeeded = input.right && chatVisible ? rightMin + PANEL_GAP : 0
  const listNeeded = input.list ? LIST_WIDTH + PANEL_GAP : 0
  const chatNeeded = chatVisible ? CHAT_TARGET : 420
  const required = 240 + PANEL_GAP + listNeeded + rightNeeded + chatNeeded
  const navigationExpanded = input.navigation && width >= required + (previous && previous.navigation !== 'expanded' ? RESTORE_MARGIN : 0)
  const compactWidth = width < 640 ? 48 : 68
  const navigationWidth = navigationExpanded ? 240 : width >= CHAT_MIN + compactWidth + PANEL_GAP ? compactWidth : 0
  const workspaceWidth = Math.max(0, width - navigationWidth - (navigationWidth ? PANEL_GAP : 0))
  const listDocked = input.list && workspaceWidth >= listNeeded + rightNeeded + chatNeeded + (previous && !previous.listDocked ? RESTORE_MARGIN : 0)
  const available = Math.max(0, workspaceWidth - (listDocked ? listNeeded : 0))
  const splitWidth = Math.max(0, available - PANEL_GAP)
  const rightDocked = input.right && chatVisible && splitWidth >= CHAT_MIN + rightMin + (previous?.rightMode === 'drawer' ? RESTORE_MARGIN : 0)
  const rightMode = !input.right ? 'closed' : !chatVisible ? 'full' : rightDocked ? 'docked' : 'drawer'
  const rightWidth = rightMode === 'docked'
    ? input.rightTab === 'files' ? clampSplit(input.ratio, splitWidth, rightMin) : Math.min(380, splitWidth - CHAT_MIN)
    : rightMode === 'full' ? available : Math.min(input.rightTab === 'files' ? 900 : 380, workspaceWidth * .94)
  return {
    navigation: navigationExpanded ? 'expanded' : navigationWidth ? 'compact' : 'hidden', navigationWidth,
    listDocked, rightMode, workspaceWidth, splitWidth, rightWidth, rightMin,
    chatWidth: !chatVisible ? 0 : rightDocked ? splitWidth - rightWidth : available,
  }
}
