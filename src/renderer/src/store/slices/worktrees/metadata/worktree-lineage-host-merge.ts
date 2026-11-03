import type { AppState } from '../../../types'
import type {
  WorkspaceLineage,
  WorktreeLineage
} from '../../../../../../shared/worktree/lineage-types'
import { parseWorkspaceKey } from '../../../../../../shared/workspace-scope'
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import { findWorktreeById, getRepoIdFromWorktreeId } from '../../worktree-helpers'
import { findRepoForHost } from '../../repo-host-identity'
import { reuseEqualRecordMap } from '../../repo-identity-reconcile'
import {
  selectDetectedWorktreesByRepo,
  selectWorktreesByRepo
} from '../../../workspace-record-selectors'

export function getWorktreeHostId(
  state: Pick<AppState, 'repos' | 'settings' | 'worktreesByRepo' | 'detectedWorktreesByRepo'>,
  worktreeId: string
): ExecutionHostId | null {
  const worktree = findWorktreeById(selectWorktreesByRepo(state), worktreeId)
  if (worktree?.hostId) {
    return worktree.hostId
  }
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  const detected = selectDetectedWorktreesByRepo(state)[repoId]?.worktrees.find(
    (entry) => entry.id === worktreeId
  )
  if (detected?.hostId) {
    return detected.hostId
  }
  const repo = findRepoForHost(state.repos, repoId, { settings: state.settings })
  return repo ? getRepoExecutionHostId(repo) : null
}

type HostLookupState = Pick<
  AppState,
  'repos' | 'settings' | 'worktreesByRepo' | 'detectedWorktreesByRepo'
>

/** True for an edge whose parent is on another host; only the desktop's own store holds those. */
export function isCrossHostWorktreeLineage(
  state: HostLookupState,
  childWorktreeId: string,
  parentWorktreeId: string
): boolean {
  const childHostId = getWorktreeHostId(state, childWorktreeId)
  const parentHostId = getWorktreeHostId(state, parentWorktreeId)
  return childHostId !== null && parentHostId !== null && childHostId !== parentHostId
}

// Why: a host's own snapshot never carries cross-host edges, so only the desktop's refresh may drop them.
function isOwnedByHostRefresh(
  state: HostLookupState,
  hostId: ExecutionHostId,
  childWorktreeId: string,
  parentWorktreeId: string | null
): boolean {
  if (parentWorktreeId && isCrossHostWorktreeLineage(state, childWorktreeId, parentWorktreeId)) {
    return hostId === 'local'
  }
  return getWorktreeHostId(state, childWorktreeId) === hostId
}

export function mergeLineageForHost(
  state: Pick<
    AppState,
    'repos' | 'settings' | 'worktreesByRepo' | 'detectedWorktreesByRepo' | 'worktreeLineageById'
  >,
  hostId: ExecutionHostId,
  lineage: Readonly<Record<string, WorktreeLineage>>,
  lineageAtRequestStart?: Readonly<Record<string, WorktreeLineage>>
): Readonly<Record<string, WorktreeLineage>> {
  // Any per-row write since request start wins, including creates, reassignment and deletes the reply would undo.
  const writtenSinceRequestStart = (worktreeId: string): boolean =>
    lineageAtRequestStart !== undefined &&
    lineageAtRequestStart[worktreeId] !== state.worktreeLineageById[worktreeId]
  const next: Record<string, WorktreeLineage> = {}
  for (const [worktreeId, existing] of Object.entries(state.worktreeLineageById)) {
    if (
      !isOwnedByHostRefresh(state, hostId, worktreeId, existing.parentWorktreeId) ||
      writtenSinceRequestStart(worktreeId)
    ) {
      next[worktreeId] = existing
    }
  }
  for (const [worktreeId, incoming] of Object.entries(lineage)) {
    if (!writtenSinceRequestStart(worktreeId)) {
      next[worktreeId] = incoming
    }
  }
  return reuseEqualRecordMap(state.worktreeLineageById, next)
}

export function mergeWorkspaceLineageForHost(
  state: Pick<
    AppState,
    | 'repos'
    | 'settings'
    | 'worktreesByRepo'
    | 'detectedWorktreesByRepo'
    | 'workspaceLineageByChildKey'
  >,
  hostId: ExecutionHostId,
  lineage: Readonly<Record<string, WorkspaceLineage>>,
  lineageAtRequestStart?: Readonly<Record<string, WorkspaceLineage>>
): Readonly<Record<string, WorkspaceLineage>> {
  const writtenSinceRequestStart = (childKey: string): boolean =>
    lineageAtRequestStart !== undefined &&
    lineageAtRequestStart[childKey] !== state.workspaceLineageByChildKey[childKey]
  const next: Record<string, WorkspaceLineage> = {}
  for (const [childKey, existing] of Object.entries(state.workspaceLineageByChildKey)) {
    const childScope = parseWorkspaceKey(existing.childWorkspaceKey)
    const childHostId =
      childScope?.type === 'worktree' ? getWorktreeHostId(state, childScope.worktreeId) : null
    const parentScope = parseWorkspaceKey(existing.parentWorkspaceKey)
    const parentWorktreeId = parentScope?.type === 'worktree' ? parentScope.worktreeId : null
    // A focused host refresh can no longer prove unknown-host child rows are current.
    if (
      childScope?.type !== 'worktree' ||
      (childHostId !== null &&
        !isOwnedByHostRefresh(state, hostId, childScope.worktreeId, parentWorktreeId)) ||
      writtenSinceRequestStart(childKey)
    ) {
      next[childKey] = existing
    }
  }
  for (const [childKey, incoming] of Object.entries(lineage)) {
    if (!writtenSinceRequestStart(childKey)) {
      next[childKey] = incoming
    }
  }
  return reuseEqualRecordMap(state.workspaceLineageByChildKey, next)
}
