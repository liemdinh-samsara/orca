import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { getRepoHeaderCreateState } from './repo-header-create-state'

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'orca',
    badgeColor: '#999999',
    addedAt: 1,
    ...overrides
  }
}

// Fork-only cases; upstream removed its own cases for this helper (#36844).
describe('repo header create state for in-place workspaces', () => {
  it('reads Create workspace for in-place git repos', () => {
    expect(
      getRepoHeaderCreateState({
        repo: makeRepo({ inPlaceWorkspaces: true }),
        label: 'monorepo',
        sshGate: { connectionId: null, status: null }
      })
    ).toEqual({
      disabled: false,
      tooltip: 'Create workspace for monorepo',
      ariaLabel: 'Create workspace for monorepo',
      requiresSshReconnect: false
    })
  })

  it('keeps the worktree wording for git repos with in-place workspaces switched off', () => {
    expect(
      getRepoHeaderCreateState({
        repo: makeRepo({ inPlaceWorkspaces: false }),
        label: 'orca',
        sshGate: { connectionId: null, status: null }
      })
    ).toMatchObject({
      tooltip: 'Create new worktree for orca',
      ariaLabel: 'Create new worktree for orca'
    })
  })

  it('allows connected in-place SSH repos as workspace creates', () => {
    expect(
      getRepoHeaderCreateState({
        repo: makeRepo({ connectionId: 'ssh-1', inPlaceWorkspaces: true }),
        label: 'remote-mono',
        sshGate: { connectionId: 'ssh-1', status: 'connected' }
      })
    ).toMatchObject({
      disabled: false,
      tooltip: 'Create workspace for remote-mono',
      requiresSshReconnect: false
    })
  })

  it('still requires a reconnect for a disconnected in-place SSH repo', () => {
    expect(
      getRepoHeaderCreateState({
        repo: makeRepo({ connectionId: 'ssh-1', inPlaceWorkspaces: true }),
        label: 'remote-mono',
        sshGate: { connectionId: 'ssh-1', status: 'disconnected' }
      })
    ).toEqual({
      disabled: true,
      tooltip: 'Reconnect SSH target before creating workspaces',
      ariaLabel: 'Reconnect SSH target before creating workspaces for remote-mono',
      requiresSshReconnect: true
    })
  })
})
