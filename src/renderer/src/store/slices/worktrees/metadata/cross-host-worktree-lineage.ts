import type { AppState } from '../../../types'
import type { WorktreeLineage } from '../../../../../../shared/worktree/lineage-types'
import type { CrossHostLineageEndpoint } from '../../../../../../shared/worktree/cross-host-lineage-request'
import { findWorktreeById } from '../../worktree-helpers'
import { selectWorktreesByRepo } from '../../../workspace-record-selectors'
import type { WorktreeSliceGet, WorktreeSliceSet } from '../listing/worktree-slice-types'
import { getWorktreeHostId, isCrossHostWorktreeLineage } from './worktree-lineage-host-merge'
import {
  projectLocalWorktreeLineageUpdate,
  projectWorktreeLineageToWorkspaceLineage
} from './worktree-lineage-refresh'

type LineageHostState = Pick<
  AppState,
  'repos' | 'settings' | 'worktreesByRepo' | 'detectedWorktreesByRepo' | 'worktreeLineageById'
>

export function crossHostLineageEndpoint(
  state: LineageHostState,
  worktreeId: string
): CrossHostLineageEndpoint | null {
  const worktree = findWorktreeById(selectWorktreesByRepo(state), worktreeId)
  const hostId = getWorktreeHostId(state, worktreeId)
  if (!worktree?.instanceId || !hostId) {
    return null
  }
  return {
    id: worktree.id,
    instanceId: worktree.instanceId,
    hostId,
    ...(worktree.projectId ? { projectId: worktree.projectId } : {})
  }
}

/** The child's current edge when the desktop, not the child's host, stores it. */
export function desktopHeldWorktreeLineage(
  state: LineageHostState,
  worktreeId: string
): WorktreeLineage | null {
  const lineage = state.worktreeLineageById[worktreeId]
  return lineage && isCrossHostWorktreeLineage(state, worktreeId, lineage.parentWorktreeId)
    ? lineage
    : null
}

/** Writes or clears a desktop-held edge and projects it onto both hosts' rows. */
export async function writeCrossHostWorktreeLineage(
  set: WorktreeSliceSet,
  get: WorktreeSliceGet,
  worktreeId: string,
  parentWorktreeId: string | null
): Promise<void> {
  const state = get()
  const previous = state.worktreeLineageById[worktreeId]
  let lineage: WorktreeLineage | null = null
  if (parentWorktreeId) {
    const child = crossHostLineageEndpoint(state, worktreeId)
    const parent = crossHostLineageEndpoint(state, parentWorktreeId)
    if (!child || !parent) {
      throw new Error('Both workspaces must be loaded to nest them across hosts.')
    }
    lineage = await window.api.worktrees.setCrossHostLineage({ child, parent })
  } else {
    await window.api.worktrees.setCrossHostLineage({ clearChildId: worktreeId })
  }
  set((s) => {
    const worktreeLineageById = { ...s.worktreeLineageById }
    if (lineage) {
      worktreeLineageById[worktreeId] = lineage
    } else {
      delete worktreeLineageById[worktreeId]
    }
    let projected: Pick<AppState, 'repos' | 'worktreesByRepo'> = s
    for (const hostId of new Set([
      getWorktreeHostId(s, worktreeId),
      previous ? getWorktreeHostId(s, previous.parentWorktreeId) : null,
      lineage ? getWorktreeHostId(s, lineage.parentWorktreeId) : null
    ])) {
      if (hostId) {
        projected = {
          ...projected,
          worktreesByRepo: projectLocalWorktreeLineageUpdate(projected, hostId, worktreeId, lineage)
        }
      }
    }
    return {
      worktreeLineageById,
      workspaceLineageByChildKey: projectWorktreeLineageToWorkspaceLineage(
        worktreeId,
        lineage,
        s.workspaceLineageByChildKey
      ),
      worktreesByRepo: projected.worktreesByRepo,
      sortEpoch: s.sortEpoch + 1
    }
  })
}
