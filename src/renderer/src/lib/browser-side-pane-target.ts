import type { TabGroupLayoutNode } from '../../../shared/tab-types'
import { findReusableRightSplitGroupId } from './emulator-right-split-target'

export type BrowserSidePaneTarget =
  | { kind: 'group'; groupId: string; isSidePane: boolean }
  | { kind: 'split-right'; sourceGroupId: string }

function containsGroup(node: TabGroupLayoutNode, groupId: string): boolean {
  if (node.type === 'leaf') {
    return node.groupId === groupId
  }
  return containsGroup(node.first, groupId) || containsGroup(node.second, groupId)
}

/** True when the group sits in the right half of some left/right split. */
export function isInRightSplit(node: TabGroupLayoutNode | undefined, groupId: string): boolean {
  if (!node || node.type === 'leaf') {
    return false
  }
  if (node.direction === 'horizontal' && containsGroup(node.second, groupId)) {
    return true
  }
  return isInRightSplit(node.first, groupId) || isInRightSplit(node.second, groupId)
}

/** Picks the pane a user-opened browser tab lands in: the pane right of the source, or a new one. */
export function resolveBrowserSidePaneTarget(args: {
  layout: TabGroupLayoutNode | undefined
  sourceGroupId: string
  sourceHasBrowser: boolean
  sourceIsEmpty: boolean
}): BrowserSidePaneTarget {
  const { layout, sourceGroupId } = args
  if (isInRightSplit(layout, sourceGroupId)) {
    return { kind: 'group', groupId: sourceGroupId, isSidePane: true }
  }
  // Why: a left pane that already shows a browser is where the user chose to browse.
  if (args.sourceHasBrowser) {
    return { kind: 'group', groupId: sourceGroupId, isSidePane: false }
  }
  const rightGroupId = findReusableRightSplitGroupId(layout, sourceGroupId)
  if (rightGroupId) {
    return { kind: 'group', groupId: rightGroupId, isSidePane: true }
  }
  // Why: splitting an empty pane would leave a blank pane beside the browser.
  if (args.sourceIsEmpty) {
    return { kind: 'group', groupId: sourceGroupId, isSidePane: false }
  }
  return { kind: 'split-right', sourceGroupId }
}
