import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { getProjectHostSetupForRepo } from '../../../shared/project-host-setup-lookup'
import { getRepoIdFromWorktreeId } from '../../../shared/worktree/id'
import { resolveWorkspaceStartCwd } from '../../../shared/workspace-start-path'
import type { AppState } from '@/store/types'
import { useAppStore } from '@/store'
import { createFloatingWorkspaceTerminalTab } from './floating-workspace-tab-creation'
import { revealFloatingWorkspacePanel } from './floating-workspace-panel-reveal'

type LocalProjectFolderState = Pick<AppState, 'repos' | 'projectHostSetups' | 'worktreesByRepo'>

/** The folder this computer's checkout of the workspace's project starts in, if it has one. */
export function resolveLocalProjectFolder(
  state: LocalProjectFolderState,
  worktreeId: string
): string | null {
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  const worktree = state.worktreesByRepo[repoId]?.find((entry) => entry.id === worktreeId)
  // Why prefer the remote row: one repo id can be registered on several hosts.
  const repo =
    state.repos.find(
      (entry) => entry.id === repoId && getRepoExecutionHostId(entry) !== LOCAL_EXECUTION_HOST_ID
    ) ?? state.repos.find((entry) => entry.id === repoId)
  const projectId =
    worktree?.projectId ??
    (repo ? getProjectHostSetupForRepo(state.projectHostSetups, repo).projectId : undefined)
  const localSetup = projectId
    ? state.projectHostSetups.find(
        (setup) =>
          setup.projectId === projectId &&
          setup.hostId === LOCAL_EXECUTION_HOST_ID &&
          setup.setupState === 'ready'
      )
    : undefined
  if (!localSetup) {
    return null
  }
  const localRepo = state.repos.find(
    (entry) =>
      entry.id === localSetup.repoId && getRepoExecutionHostId(entry) === LOCAL_EXECUTION_HOST_ID
  )
  return resolveWorkspaceStartCwd(localRepo?.path ?? localSetup.path, localRepo)
}

/** Opens a shell on this computer from a workspace whose terminals run on an SSH host. */
export async function openLocalTerminalForRemoteWorkspace(worktreeId: string): Promise<void> {
  const folder = resolveLocalProjectFolder(useAppStore.getState(), worktreeId)
  // Why the round trip: main swaps in a folder that exists when the checkout has moved.
  const startupCwd = folder ? await window.api.app.getFloatingTerminalCwd({ path: folder }) : ''
  const state = useAppStore.getState()
  // Why the floating workspace: it is local by construction, while every tab of an SSH
  // workspace is saved and restored with that host.
  revealFloatingWorkspacePanel(state)
  await createFloatingWorkspaceTerminalTab(state, undefined, undefined, startupCwd || undefined)
}
