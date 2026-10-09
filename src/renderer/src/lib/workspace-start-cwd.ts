import type { Repo } from '../../../shared/repo-types'
import { getRepoIdFromWorktreeId, splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import { resolveWorkspaceStartCwd } from '../../../shared/workspace-start-path'

/** Default cwd for new terminals in a workspace: its root, or the owning project's start folder. */
export function resolveWorkspaceTerminalDefaultCwd(
  repos: readonly Repo[],
  worktreeId: string,
  worktreePath: string
): string {
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  return resolveWorkspaceStartCwd(
    worktreePath,
    repos.find((repo) => repo.id === repoId)
  )
}

/** Root cwd for terminals that must ignore the start folder (setup scripts); undefined when unset. */
export function resolveWorkspaceRootCwdOverride(
  repos: readonly Repo[],
  worktreeId: string
): string | undefined {
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  if (!repos.find((repo) => repo.id === repoId)?.workspaceStartPath) {
    return undefined
  }
  return splitWorktreeIdForFilesystem(worktreeId)?.worktreePath
}
