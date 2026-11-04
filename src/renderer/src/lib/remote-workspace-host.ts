import { parseRoutableExecutionHostId } from '../../../shared/execution-host'
import { isWslHostRuntimeEnvironment } from '../../../shared/runtime-environments'
import { getRepoIdFromWorktreeId } from '../../../shared/worktree/id'
import type { AppState } from '../store/types'
import { getConnectionIdFromState } from './connection-owner-resolution'
import { workspaceOwnerHostId } from './workspace-row-owner-host'

type RemoteWorkspaceHostState = Pick<
  AppState,
  'folderWorkspaces' | 'projectGroups' | 'repos' | 'worktreesByRepo' | 'runtimeEnvironments'
>

/**
 * Whether a workspace's terminals run on another machine: an SSH host, a devbox's managed
 * server or a paired Orca server. Managed devbox rows carry a `runtime:` host and no SSH id.
 */
export function workspaceRunsOnAnotherMachine(
  state: RemoteWorkspaceHostState,
  worktreeId: string
): boolean {
  if (getConnectionIdFromState(state, worktreeId)?.trim()) {
    return true
  }
  const rowHostId = state.worktreesByRepo[getRepoIdFromWorktreeId(worktreeId)]?.find(
    (worktree) => worktree.id === worktreeId
  )?.hostId
  const host = parseRoutableExecutionHostId(rowHostId ?? workspaceOwnerHostId(state, worktreeId))
  if (host?.kind === 'ssh') {
    return true
  }
  if (host?.kind !== 'runtime') {
    return false
  }
  // Why: a WSL host runs on this computer, so its terminals are already local.
  const environment = state.runtimeEnvironments.find((entry) => entry.id === host.environmentId)
  return !(environment && isWslHostRuntimeEnvironment(environment))
}
