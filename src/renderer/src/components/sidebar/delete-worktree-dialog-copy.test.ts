import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import {
  countFolderWorkspaceDeletes,
  getDeleteWorktreeDialogCopy,
  isFolderWorkspaceDelete
} from './delete-worktree-dialog-copy'

const INSTANCE_UUID = '123e4567-e89b-12d3-a456-426614174000'

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-git',
    path: '/projects/mono',
    displayName: 'mono',
    badgeColor: '#999999',
    addedAt: 1,
    ...overrides
  }
}

const repoMap = new Map<string, Repo>([
  ['repo-git', makeRepo()],
  ['repo-in-place', makeRepo({ id: 'repo-in-place', inPlaceWorkspaces: true })],
  ['repo-folder', makeRepo({ id: 'repo-folder', kind: 'folder' })]
])

describe('isFolderWorkspaceDelete', () => {
  it('is true for an in-place instance id on a git repo', () => {
    expect(
      isFolderWorkspaceDelete(repoMap, {
        id: `repo-in-place::/projects/mono::workspace:${INSTANCE_UUID}`,
        repoId: 'repo-in-place'
      })
    ).toBe(true)
  })

  it('stays true for an instance id after the project setting is switched off', () => {
    expect(
      isFolderWorkspaceDelete(repoMap, {
        id: `repo-git::/projects/mono::workspace:${INSTANCE_UUID}`,
        repoId: 'repo-git'
      })
    ).toBe(true)
  })

  it('is false for a plain git worktree id', () => {
    expect(
      isFolderWorkspaceDelete(repoMap, { id: 'repo-git::/projects/mono', repoId: 'repo-git' })
    ).toBe(false)
  })

  it('is false for the root checkout of an in-place project', () => {
    expect(
      isFolderWorkspaceDelete(repoMap, {
        id: 'repo-in-place::/projects/mono',
        repoId: 'repo-in-place'
      })
    ).toBe(false)
  })

  it('is false for a path that merely contains the word workspace', () => {
    expect(
      isFolderWorkspaceDelete(repoMap, {
        id: 'repo-git::/projects/workspace-tools',
        repoId: 'repo-git'
      })
    ).toBe(false)
  })

  it('is true for folder repos', () => {
    expect(
      isFolderWorkspaceDelete(repoMap, { id: 'repo-folder::/projects/docs', repoId: 'repo-folder' })
    ).toBe(true)
  })

  it('is false for a missing worktree or an unknown repo without an instance id', () => {
    expect(isFolderWorkspaceDelete(repoMap, null)).toBe(false)
    expect(isFolderWorkspaceDelete(repoMap, { repoId: 'repo-unknown' })).toBe(false)
  })
})

describe('in-place delete copy', () => {
  const inPlaceWorktree = {
    id: `repo-in-place::/projects/mono::workspace:${INSTANCE_UUID}`,
    repoId: 'repo-in-place'
  }
  const gitWorktree = { id: 'repo-git::/projects/mono', repoId: 'repo-git' }

  it('counts in-place instances alongside folder workspaces, not git worktrees', () => {
    expect(countFolderWorkspaceDeletes(repoMap, [inPlaceWorktree, gitWorktree])).toBe(1)
  })

  it('forgets the entry only for a single in-place workspace delete', () => {
    const copy = getDeleteWorktreeDialogCopy({
      isBatchDelete: false,
      worktree: { displayName: 'api' },
      worktreeCount: 1,
      folderWorkspaceDeleteCount: 1,
      isFolderWorkspaceDelete: isFolderWorkspaceDelete(repoMap, inPlaceWorktree)
    })

    expect(copy.descriptionSuffix).toBe(
      'from Orca. The project folder on disk will not be deleted.'
    )
    expect(copy.mainWorktreeBlocker).toBe(
      'Remove the folder project instead of deleting this workspace.'
    )
  })

  it('removes from git and disk for a plain git worktree delete', () => {
    const copy = getDeleteWorktreeDialogCopy({
      isBatchDelete: false,
      worktree: { displayName: 'feature' },
      worktreeCount: 1,
      folderWorkspaceDeleteCount: 0,
      isFolderWorkspaceDelete: isFolderWorkspaceDelete(repoMap, gitWorktree)
    })

    expect(copy.descriptionSuffix).toBe('from git and delete its workspace folder.')
    expect(copy.mainWorktreeBlocker).toBe('Git does not allow removing the main worktree.')
  })
})
