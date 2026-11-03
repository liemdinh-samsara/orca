import type { ExecutionHostId } from '../../../../shared/execution-host'
import { sharesDesktopWorktreeLineageBoundary } from '../../../../shared/resolved-worktree-lineage'
import { hostWorktreeTarget } from '../../../../shared/worktree/host-qualified-identity'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import type { CrossHostLineageRequest } from '../../../../shared/worktree/cross-host-lineage-request'
import type { Store } from '../../../persistence/loading-store/store'

type CrossHostLineageStore = Pick<
  Store,
  'getWorktreeLineage' | 'setWorktreeLineage' | 'removeWorktreeLineage'
> & { getWorktreeMeta(worktreeId: string): Pick<WorktreeMeta, 'hostId'> | undefined }

// Why the desktop: a managed host's runtime only sees its own workspaces, so an edge whose parent
// is on another host (a Mac checkout and its SSH devbox) can be stored only here.
export function writeCrossHostWorktreeLineage(
  store: CrossHostLineageStore,
  request: CrossHostLineageRequest,
  now: number = Date.now()
): WorktreeLineage | null {
  if ('clearChildId' in request) {
    store.removeWorktreeLineage(lineageBucket(store, request.clearChildId, 'local'))
    return null
  }
  const { child, parent } = request
  if (child.hostId === parent.hostId) {
    throw new Error('Same-host lineage belongs to that host.')
  }
  if (child.id === parent.id) {
    throw new Error('A worktree cannot parent itself.')
  }
  if (!sharesDesktopWorktreeLineageBoundary(child, parent)) {
    throw new Error('Workspaces on different hosts nest only within one project.')
  }
  const visited = new Set<string>()
  for (let cursor: string | undefined = parent.id; cursor;) {
    if (cursor === child.id) {
      throw new Error('That parent would create a lineage cycle.')
    }
    if (visited.has(cursor)) {
      break
    }
    visited.add(cursor)
    cursor = store.getWorktreeLineage(cursor)?.parentWorktreeId
  }
  const lineage: WorktreeLineage = {
    worktreeId: child.id,
    worktreeInstanceId: child.instanceId,
    parentWorktreeId: parent.id,
    parentWorktreeInstanceId: parent.instanceId,
    origin: 'manual',
    capture: { source: 'manual-action', confidence: 'explicit' },
    createdAt: now
  }
  const written = store.setWorktreeLineage(lineageBucket(store, child.id, child.hostId), lineage)
  if (!written) {
    throw new Error('This desktop cannot record lineage for that workspace.')
  }
  return written
}

// Why saved meta first: relay-era edges sit in a bucket owned by the child's old ssh: host id.
function lineageBucket(store: CrossHostLineageStore, childId: string, fallback: ExecutionHostId) {
  return hostWorktreeTarget({
    id: childId,
    hostId: store.getWorktreeMeta(childId)?.hostId ?? fallback
  })
}
