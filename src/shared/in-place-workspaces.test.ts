import { describe, expect, it } from 'vitest'
import type { Repo } from './repo-types'
import {
  applyNewProjectWorkspaceDefault,
  createsWorkspacesInPlace,
  isInPlaceWorkspaceInstanceId
} from './in-place-workspaces'

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

describe('createsWorkspacesInPlace', () => {
  it.each([
    { kind: 'folder' as const, expected: true },
    { kind: 'git' as const, expected: false },
    { kind: 'git' as const, inPlaceWorkspaces: false, expected: false },
    { kind: 'git' as const, inPlaceWorkspaces: true, expected: true }
  ])(
    'returns $expected for $kind with inPlaceWorkspaces=$inPlaceWorkspaces',
    ({ expected, ...options }) => {
      expect(createsWorkspacesInPlace(repo(options))).toBe(expected)
    }
  )
})

describe('isInPlaceWorkspaceInstanceId', () => {
  it.each([
    ['repo::/p::workspace:11111111-2222-3333-4444-555555555555', true],
    ['repo::/p', false],
    ['repo::/projects/workspace/code', false]
  ])('recognizes only the instance separator in %s', (id, expected) => {
    expect(isInPlaceWorkspaceInstanceId(id)).toBe(expected)
  })
})
