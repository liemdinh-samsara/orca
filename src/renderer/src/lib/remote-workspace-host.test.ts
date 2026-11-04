import { describe, expect, it } from 'vitest'
import { UNRESOLVED_OWNER_HOST_ID } from '../../../shared/execution-host'
import type { AppState } from '../store/types'
import { workspaceRunsOnAnotherMachine } from './remote-workspace-host'

type Fixture = {
  repos: { id: string; connectionId?: string | null; executionHostId?: string }[]
  worktrees?: { id: string; repoId: string; hostId?: string }[]
  runtimeEnvironments?: { id: string; orcadDeployment?: { kind: 'wsl'; distro: string } }[]
}

function state({ repos, worktrees = [], runtimeEnvironments = [] }: Fixture) {
  const worktreesByRepo: Record<string, Fixture['worktrees']> = {}
  for (const worktree of worktrees) {
    worktreesByRepo[worktree.repoId] = [...(worktreesByRepo[worktree.repoId] ?? []), worktree]
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the selector reads only ids, connection ids, host ids and WSL deployment kinds.
  return {
    repos,
    worktreesByRepo,
    runtimeEnvironments,
    folderWorkspaces: [],
    projectGroups: []
  } as unknown as Pick<
    AppState,
    'folderWorkspaces' | 'projectGroups' | 'repos' | 'worktreesByRepo' | 'runtimeEnvironments'
  >
}

describe('workspaceRunsOnAnotherMachine', () => {
  it('is true for a workspace on an SSH connection', () => {
    expect(
      workspaceRunsOnAnotherMachine(
        state({ repos: [{ id: 'repo', connectionId: 'devbox4' }] }),
        'repo::/home/ubuntu/co/mono'
      )
    ).toBe(true)
  })

  it("is true for a devbox workspace served by the devbox's managed server", () => {
    const managed = state({
      repos: [{ id: 'repo', connectionId: null, executionHostId: 'runtime:env-1' }],
      runtimeEnvironments: [{ id: 'env-1' }]
    })
    expect(workspaceRunsOnAnotherMachine(managed, 'repo::/home/ubuntu/co/mono')).toBe(true)
  })

  it("prefers the workspace row's host when the repo row names this computer", () => {
    const shared = state({
      repos: [{ id: 'repo', connectionId: null }],
      worktrees: [{ id: 'repo::/home/ubuntu/co/mono', repoId: 'repo', hostId: 'runtime:env-1' }]
    })
    expect(workspaceRunsOnAnotherMachine(shared, 'repo::/home/ubuntu/co/mono')).toBe(true)
  })

  it('is false on this computer, in a WSL host and while the owner is unresolved', () => {
    expect(
      workspaceRunsOnAnotherMachine(
        state({ repos: [{ id: 'repo', connectionId: null }] }),
        'repo::/Users/me/co/mono'
      )
    ).toBe(false)
    const wsl = state({
      repos: [{ id: 'repo', executionHostId: 'runtime:wsl-1' }],
      runtimeEnvironments: [{ id: 'wsl-1', orcadDeployment: { kind: 'wsl', distro: 'Ubuntu' } }]
    })
    expect(workspaceRunsOnAnotherMachine(wsl, 'repo::/home/me/mono')).toBe(false)
    const unresolved = state({ repos: [{ id: 'repo', executionHostId: UNRESOLVED_OWNER_HOST_ID }] })
    expect(workspaceRunsOnAnotherMachine(unresolved, 'repo::/x')).toBe(false)
    expect(workspaceRunsOnAnotherMachine(unresolved, 'missing::/x')).toBe(false)
  })
})
