import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { appendInPlaceGitWorkspaces } from './in-place-workspace-catalog'

const repo: Repo = {
  id: 'repo-1',
  path: '/code/monolith',
  displayName: 'monolith',
  badgeColor: '#000000',
  addedAt: 0,
  kind: 'git',
  inPlaceWorkspaces: true
}
const instanceId = `${repo.id}::${repo.path}::workspace:11111111-2222-3333-4444-555555555555`

function meta(overrides: Partial<WorktreeMeta>): WorktreeMeta {
  return {
    displayName: '',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

function worktree(overrides: Partial<Worktree>): Worktree {
  return {
    id: `${repo.id}::${repo.path}`,
    repoId: repo.id,
    path: repo.path,
    head: 'abc123',
    branch: 'refs/heads/main',
    isBare: false,
    isMainWorktree: true,
    displayName: 'monolith',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

describe('appendInPlaceGitWorkspaces', () => {
  it('lists each in-place workspace on the root checkout with its branch', () => {
    const root = worktree({})
    const metadata: Record<string, WorktreeMeta> = {
      [root.id]: meta({ displayName: 'monolith' }),
      [instanceId]: meta({ displayName: 'fleet api', instanceId: 'instance-1' })
    }

    const result = appendInPlaceGitWorkspaces(repo, [root], metadata)

    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({
      id: instanceId,
      path: repo.path,
      branch: 'refs/heads/main',
      head: 'abc123',
      isMainWorktree: false,
      displayName: 'fleet api',
      instanceId: 'instance-1'
    })
  })

  it('keeps existing in-place workspaces after the setting is turned off', () => {
    const root = worktree({})
    const result = appendInPlaceGitWorkspaces({ ...repo, inPlaceWorkspaces: false }, [root], {
      [instanceId]: meta({ displayName: 'fleet api' })
    })
    expect(result.map((item) => item.id)).toEqual([root.id, instanceId])
  })

  it('ignores other repos and folder projects', () => {
    const root = worktree({})
    const otherRepoInstance = `other::${repo.path}::workspace:11111111-2222-3333-4444-555555555555`
    expect(
      appendInPlaceGitWorkspaces(repo, [root], { [otherRepoInstance]: meta({ displayName: 'x' }) })
    ).toEqual([root])
    expect(
      appendInPlaceGitWorkspaces({ ...repo, kind: 'folder' }, [root], {
        [instanceId]: meta({ displayName: 'x' })
      })
    ).toEqual([root])
  })
})
