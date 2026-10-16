import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import type { Repo } from '../shared/repo-types'
import { resolveProjectStartFolderCwd } from './project-start-folder-cwd'

vi.mock('node:fs', () => ({ existsSync: vi.fn() }))

const repo: Repo = {
  id: 'repo-1',
  path: '/repo',
  displayName: 'repo',
  badgeColor: 'blue',
  addedAt: 0,
  kind: 'git',
  workspaceStartPath: 'packages/web'
}

beforeEach(() => vi.mocked(existsSync).mockReset())

describe('resolveProjectStartFolderCwd', () => {
  it.each([null, undefined, { ...repo, workspaceStartPath: undefined }])(
    'returns undefined without a configured start folder (%j)',
    (owner) => {
      expect(resolveProjectStartFolderCwd('/repo', owner)).toBeUndefined()
      expect(existsSync).not.toHaveBeenCalled()
    }
  )

  it('returns undefined when the start folder resolves to the workspace root', () => {
    expect(
      resolveProjectStartFolderCwd('/repo', { ...repo, workspaceStartPath: './' })
    ).toBeUndefined()
    expect(existsSync).not.toHaveBeenCalled()
  })

  it('returns the joined cwd when the local start folder exists', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    expect(resolveProjectStartFolderCwd('/repo', repo)).toBe('/repo/packages/web')
    expect(existsSync).toHaveBeenCalledWith('/repo/packages/web')
  })

  it('falls back when the local start folder has been deleted', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    expect(resolveProjectStartFolderCwd('/repo', repo)).toBeUndefined()
    expect(existsSync).toHaveBeenCalledWith('/repo/packages/web')
  })

  it('does not check an SSH start folder on the local filesystem', () => {
    expect(resolveProjectStartFolderCwd('/remote', { ...repo, connectionId: 'ssh-1' })).toBe(
      '/remote/packages/web'
    )
    expect(existsSync).not.toHaveBeenCalled()
  })

  it('ignores a persisted start folder that escapes the workspace', () => {
    expect(
      resolveProjectStartFolderCwd('/repo', { ...repo, workspaceStartPath: '../x' })
    ).toBeUndefined()
    expect(existsSync).not.toHaveBeenCalled()
  })
})
