import { existsSync } from 'node:fs'
import type { Repo } from '../shared/repo-types'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../shared/execution-host'
import { resolveWorkspaceStartCwd } from '../shared/workspace-start-path'

/** The project's start folder inside `workspacePath`, or undefined when unset or missing locally. */
export function resolveProjectStartFolderCwd(
  workspacePath: string,
  repo: Repo | null | undefined
): string | undefined {
  const cwd = resolveWorkspaceStartCwd(workspacePath, repo)
  if (!repo || cwd === workspacePath) {
    return undefined
  }
  // Why: a deleted start folder must not break spawns; only the local host can be checked here.
  if (getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID && !existsSync(cwd)) {
    return undefined
  }
  return cwd
}
