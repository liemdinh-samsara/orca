import { isWindowsAbsolutePathLike } from './cross-platform-path'
import type { Repo } from './repo-types'

/** '' clears the setting; null rejects absolute paths and paths that climb out of the workspace. */
export function normalizeWorkspaceStartPath(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || isWindowsAbsolutePathLike(trimmed)) {
    return null
  }
  const segments = trimmed.split(/[\\/]+/).filter((segment) => segment && segment !== '.')
  return segments.includes('..') ? null : segments.join('/')
}

/** Where a workspace's terminals start: `worktreePath` joined with the repo's start folder. */
export function resolveWorkspaceStartCwd(
  worktreePath: string,
  repo: Pick<Repo, 'workspaceStartPath'> | null | undefined
): string {
  const startPath = repo?.workspaceStartPath
    ? normalizeWorkspaceStartPath(repo.workspaceStartPath)
    : null
  if (!startPath) {
    return worktreePath
  }
  const separator =
    isWindowsAbsolutePathLike(worktreePath) && !worktreePath.includes('/') ? '\\' : '/'
  return `${worktreePath.replace(/[\\/]+$/, '')}${separator}${startPath.split('/').join(separator)}`
}
