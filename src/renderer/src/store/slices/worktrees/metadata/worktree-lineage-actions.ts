import type { WorktreeSlice } from '../../worktree-helpers'
import type { WorktreeSliceGet, WorktreeSliceSet } from '../listing/worktree-slice-types'
import { parseExecutionHostId } from '../../../../../../shared/execution-host'
import { runtimeTargetForOwnerEnvironment } from '../../../../runtime/runtime-client-target'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import {
  applyWorktreeLineageUpdate,
  refreshWorktreeLineageForTarget,
  setWorktreeLineageForRuntime
} from './worktree-lineage-refresh'
import { hostRouteForWorktreeOwner } from '../listing/worktree-owner-target'
import { isCrossHostWorktreeLineage } from './worktree-lineage-host-merge'
import {
  desktopHeldWorktreeLineage,
  writeCrossHostWorktreeLineage
} from './cross-host-worktree-lineage'

// Why: one edge per child; a host's own edge is cleared first so the two stores never disagree.
async function nestAcrossHosts(
  set: WorktreeSliceSet,
  get: WorktreeSliceGet,
  worktreeId: string,
  parentWorktreeId: string
): Promise<void> {
  if (get().worktreeLineageById[worktreeId] && !desktopHeldWorktreeLineage(get(), worktreeId)) {
    const ownerRoute = hostRouteForWorktreeOwner(get(), worktreeId)
    applyWorktreeLineageUpdate(
      set,
      worktreeId,
      await setWorktreeLineageForRuntime(ownerRoute, worktreeId, { noParent: true })
    )
  }
  await writeCrossHostWorktreeLineage(set, get, worktreeId, parentWorktreeId)
}

// Why: this runs inside a catch, so letting the refresh reject would replace the failure it recovers from.
async function refreshWorktreeLineageBestEffort(
  ownerTarget: RuntimeClientTarget,
  set: WorktreeSliceSet,
  get: WorktreeSliceGet
): Promise<void> {
  try {
    await refreshWorktreeLineageForTarget(ownerTarget, set, get)
  } catch (err) {
    console.error('Failed to refresh worktree lineage after a failed write:', err)
  }
}

export function createFetchWorktreeLineage(
  set: WorktreeSliceSet,
  get: WorktreeSliceGet
): WorktreeSlice['fetchWorktreeLineage'] {
  return async (options) => {
    try {
      // Why: lineage is a focused-host refresh; host-merge so other hosts' fetched lineage is preserved.
      const ownerSettings = get().settings
      const parsedHost = options?.executionHostId
        ? parseExecutionHostId(options.executionHostId)
        : null
      const activeRuntimeEnvironmentId =
        parsedHost?.kind === 'runtime'
          ? parsedHost.environmentId
          : parsedHost || options?.forceLocalOwner
            ? null
            : ownerSettings?.activeRuntimeEnvironmentId
      await refreshWorktreeLineageForTarget(
        runtimeTargetForOwnerEnvironment(activeRuntimeEnvironmentId ?? null),
        set,
        get,
        {
          reuseRecentCompatibilityFailure: true
        }
      )
    } catch (err) {
      console.error('Failed to fetch worktree lineage:', err)
    }
  }
}

export function createUpdateWorktreeLineage(
  set: WorktreeSliceSet,
  get: WorktreeSliceGet
): WorktreeSlice['updateWorktreeLineage'] {
  return async (worktreeId, args) => {
    if (
      args.parentWorktreeId &&
      isCrossHostWorktreeLineage(get(), worktreeId, args.parentWorktreeId)
    ) {
      await nestAcrossHosts(set, get, worktreeId, args.parentWorktreeId)
      return
    }
    if (desktopHeldWorktreeLineage(get(), worktreeId)) {
      await writeCrossHostWorktreeLineage(set, get, worktreeId, null)
      if (args.noParent === true) {
        return
      }
    }
    // User-initiated unresolved routes must reject so both callers can toast, rather than silently skip.
    const ownerRoute = hostRouteForWorktreeOwner(get(), worktreeId)
    try {
      applyWorktreeLineageUpdate(
        set,
        worktreeId,
        await setWorktreeLineageForRuntime(ownerRoute, worktreeId, args)
      )
    } catch (err) {
      console.error('Failed to update worktree lineage:', err)
      await refreshWorktreeLineageBestEffort(ownerRoute.target, set, get)
      throw err
    }
  }
}

export function createAssignWorktreeParent(
  set: WorktreeSliceSet,
  get: WorktreeSliceGet
): WorktreeSlice['assignWorktreeParent'] {
  return async (worktreeId, args) => {
    if (isCrossHostWorktreeLineage(get(), worktreeId, args.parentWorktreeId)) {
      await nestAcrossHosts(set, get, worktreeId, args.parentWorktreeId)
      return
    }
    if (desktopHeldWorktreeLineage(get(), worktreeId)) {
      await writeCrossHostWorktreeLineage(set, get, worktreeId, null)
    }
    const ownerRoute = hostRouteForWorktreeOwner(get(), worktreeId)
    try {
      applyWorktreeLineageUpdate(
        set,
        worktreeId,
        await setWorktreeLineageForRuntime(ownerRoute, worktreeId, args)
      )
    } catch (err) {
      console.error('Failed to assign worktree parent:', err)
      // Unlike the update path this rethrows, so the recovery refresh must not mask the original cause.
      await refreshWorktreeLineageBestEffort(ownerRoute.target, set, get)
      throw err
    }
  }
}
