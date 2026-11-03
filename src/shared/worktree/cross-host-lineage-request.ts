import type { ExecutionHostId } from '../execution-host'

/** One side of a desktop-held lineage edge, as the renderer sees that host's row. */
export type CrossHostLineageEndpoint = {
  id: string
  instanceId: string
  hostId: ExecutionHostId
  projectId?: string
}

export type CrossHostLineageRequest =
  | { child: CrossHostLineageEndpoint; parent: CrossHostLineageEndpoint }
  | { clearChildId: string }
