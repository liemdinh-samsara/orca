import type { Repo } from '../../../../shared/repo-types'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import type { DetectedWorktree, Worktree } from '../../../../shared/worktree/types'
import { toDetectedWorktree } from '../../../../shared/worktree/ownership'
import type { Store } from '../../../persistence/loading-store/store'
import { isFolderRepo } from '../../../../shared/repo-kind'
import { FOLDER_WORKSPACE_INSTANCE_SEPARATOR } from '../../../../shared/worktree/id'
import { getFolderWorkspaceRootId, mergeFolderWorkspace } from '../folder-workspace-model'

/**
 * Git listings only report what `git worktree list` sees, so in-place workspaces (metadata rows on the
 * project checkout) are appended here. Listed regardless of the repo setting so turning it off later
 * does not orphan entries that already own terminals.
 */
export function appendInPlaceGitWorkspaces<T extends Worktree>(
  repo: Repo,
  worktrees: T[],
  metadata: Readonly<Record<string, WorktreeMeta>>
): (T | Worktree)[] {
  if (isFolderRepo(repo)) {
    return worktrees
  }
  const prefix = `${getFolderWorkspaceRootId(repo)}${FOLDER_WORKSPACE_INSTANCE_SEPARATOR}`
  const instanceIds = Object.keys(metadata).filter((worktreeId) => worktreeId.startsWith(prefix))
  const root = worktrees.find((worktree) => worktree.isMainWorktree)
  if (instanceIds.length === 0 || !root) {
    return worktrees
  }
  const instances = instanceIds.map((worktreeId): Worktree => ({
    ...mergeFolderWorkspace(repo, worktreeId, metadata[worktreeId]),
    hostId: metadata[worktreeId].hostId ?? root.hostId,
    // Why: the entry shares the root checkout, so git status, branch and PR lookups follow it.
    head: root.head,
    branch: root.branch
  }))
  return [...worktrees, ...instances]
}

/** Detected-listing twin: the sidebar refresh is authoritative, so a missing row would be purged. */
export function appendInPlaceDetectedGitWorkspaces<T extends DetectedWorktree>(
  store: Pick<Store, 'getSettings'>,
  repo: Repo,
  detected: T[],
  metadata: Readonly<Record<string, WorktreeMeta>>
): (T | DetectedWorktree)[] {
  const appended = appendInPlaceGitWorkspaces(repo, detected, metadata).slice(detected.length)
  if (appended.length === 0) {
    return detected
  }
  const settings = store.getSettings()
  return [
    ...detected,
    ...appended.map((worktree) =>
      toDetectedWorktree({
        repo,
        worktree,
        meta: metadata[worktree.id],
        settings,
        knownOrcaLayouts: [],
        isLegacyRepoForVisibility: true
      })
    )
  ]
}
