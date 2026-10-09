import { describe, expect, it } from 'vitest'
import type { Repo } from './repo-types'
import { applyNewProjectWorkspaceDefault, createsWorkspacesInPlace } from './in-place-workspaces'

function repo(overrides: Partial<Repo>): Repo {
  return {
    id: 'r1',
    path: '/repo',
    displayName: 'repo',
    badgeColor: '#000',
    addedAt: 0,
    kind: 'git',
    ...overrides
  }
}

describe('applyNewProjectWorkspaceDefault', () => {
  it('turns in-place workspaces on for a new git project', () => {
    const added = repo({})
    applyNewProjectWorkspaceDefault(added)
    expect(added.inPlaceWorkspaces).toBe(true)
    expect(createsWorkspacesInPlace(added)).toBe(true)
  })

  it('keeps a mode the caller already chose', () => {
    const added = repo({ inPlaceWorkspaces: false })
    applyNewProjectWorkspaceDefault(added)
    expect(added.inPlaceWorkspaces).toBe(false)
  })

  it('leaves folder projects alone', () => {
    const added = repo({ kind: 'folder' })
    applyNewProjectWorkspaceDefault(added)
    expect(added.inPlaceWorkspaces).toBeUndefined()
  })
})
