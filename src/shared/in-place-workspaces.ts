import type { Repo } from './repo-types'
import { isFolderRepo } from './repo-kind'
import { FOLDER_WORKSPACE_INSTANCE_SEPARATOR } from './worktree/id'

/** True when a new workspace is registered on the project checkout instead of `git worktree add`. */
export function createsWorkspacesInPlace(repo: Pick<Repo, 'kind' | 'inPlaceWorkspaces'>): boolean {
  return isFolderRepo(repo) || repo.inPlaceWorkspaces === true
}

/** True for a `repoId::path::workspace:<uuid>` entry that shares its checkout with the project root. */
export function isInPlaceWorkspaceInstanceId(worktreeId: string): boolean {
  return worktreeId.includes(FOLDER_WORKSPACE_INSTANCE_SEPARATOR)
}
