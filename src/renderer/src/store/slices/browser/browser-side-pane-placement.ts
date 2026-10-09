import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../shared/constants'
import { resolveBrowserSidePaneTarget } from '@/lib/browser-side-pane-target'
import type { BrowserSliceGet } from './browser-slice-contract'

/** Returns the right-hand pane for a user-opened browser tab, splitting one off when none exists. */
export function placeInBrowserSidePane(
  get: BrowserSliceGet,
  worktreeId: string,
  requestedGroupId: string | undefined
): string | undefined {
  const state = get()
  const sourceGroupId =
    requestedGroupId ??
    state.activeGroupIdByWorktree[worktreeId] ??
    state.groupsByWorktree[worktreeId]?.[0]?.id
  if (!sourceGroupId || worktreeId === FLOATING_TERMINAL_WORKTREE_ID) {
    return requestedGroupId
  }
  const sourceTabs = (state.unifiedTabsByWorktree[worktreeId] ?? []).filter(
    (tab) => tab.groupId === sourceGroupId
  )
  const target = resolveBrowserSidePaneTarget({
    layout: state.layoutByWorktree[worktreeId],
    sourceGroupId,
    sourceHasBrowser: sourceTabs.some((tab) => tab.contentType === 'browser'),
    sourceIsEmpty: sourceTabs.length === 0
  })
  const groupId =
    target.kind === 'group'
      ? target.groupId
      : state.createEmptySplitGroup(worktreeId, sourceGroupId, 'right')
  if (!groupId) {
    return sourceGroupId
  }
  const isSidePane = target.kind === 'split-right' || target.isSidePane
  const group = get().groupsByWorktree[worktreeId]?.find((candidate) => candidate.id === groupId)
  // Why: the side pane defaults to a vertical tab list; a choice the user made either way is kept.
  if (isSidePane && group && group.tabStripOrientation === undefined) {
    get().setTabGroupStripOrientation(worktreeId, groupId, 'vertical')
  }
  return groupId
}
