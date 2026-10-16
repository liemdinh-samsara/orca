import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import {
  resolveWorkspaceRootCwdOverride,
  resolveWorkspaceTerminalDefaultCwd
} from './workspace-start-cwd'

const INSTANCE_UUID = '123e4567-e89b-12d3-a456-426614174000'
const INSTANCE_ID = `repo-1::/projects/mono::workspace:${INSTANCE_UUID}`

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/projects/mono',
    displayName: 'mono',
    badgeColor: '#999999',
    addedAt: 1,
    ...overrides
  }
}

describe('resolveWorkspaceTerminalDefaultCwd', () => {
  it('joins the start folder for the repo that owns the worktree id', () => {
    const repos = [
      makeRepo({ id: 'repo-other', workspaceStartPath: 'other' }),
      makeRepo({ id: 'repo-1', workspaceStartPath: 'services/api' })
    ]

    expect(
      resolveWorkspaceTerminalDefaultCwd(repos, 'repo-1::/projects/mono', '/projects/mono')
    ).toBe('/projects/mono/services/api')
  })

  it('returns the worktree path when the repo is unknown', () => {
    const repos = [makeRepo({ id: 'repo-other', workspaceStartPath: 'other' })]

    expect(
      resolveWorkspaceTerminalDefaultCwd(repos, 'repo-1::/projects/mono', '/projects/mono')
    ).toBe('/projects/mono')
  })

  it('returns the worktree path when the repo has no start folder', () => {
    expect(
      resolveWorkspaceTerminalDefaultCwd([makeRepo()], 'repo-1::/projects/mono', '/projects/mono')
    ).toBe('/projects/mono')
  })

  it('parses the repo id before the first separator for in-place instance ids', () => {
    const repos = [makeRepo({ workspaceStartPath: 'web' })]

    expect(resolveWorkspaceTerminalDefaultCwd(repos, INSTANCE_ID, '/projects/mono')).toBe(
      '/projects/mono/web'
    )
  })
})

describe('resolveWorkspaceRootCwdOverride', () => {
  it('returns undefined when the repo has no start folder', () => {
    expect(resolveWorkspaceRootCwdOverride([makeRepo()], INSTANCE_ID)).toBeUndefined()
  })

  it('returns undefined when the repo is unknown', () => {
    expect(resolveWorkspaceRootCwdOverride([], INSTANCE_ID)).toBeUndefined()
  })

  it('returns the checkout path for a plain worktree id', () => {
    const repos = [makeRepo({ workspaceStartPath: 'services/api' })]

    expect(resolveWorkspaceRootCwdOverride(repos, 'repo-1::/projects/mono')).toBe('/projects/mono')
  })

  it('strips the ::workspace:<uuid> suffix from the checkout path', () => {
    const repos = [makeRepo({ workspaceStartPath: 'services/api' })]

    expect(resolveWorkspaceRootCwdOverride(repos, INSTANCE_ID)).toBe('/projects/mono')
  })
})
