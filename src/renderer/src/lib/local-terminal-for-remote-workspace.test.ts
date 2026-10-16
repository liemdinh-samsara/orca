import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectHostSetup } from '../../../shared/project-types'
import type { Repo } from '../../../shared/repo-types'
import type { Worktree } from '../../../shared/worktree/types'

const mocks = vi.hoisted(() => {
  const store: { state: object } = { state: {} }
  return { store, reveal: vi.fn(), createFloatingTab: vi.fn(async () => null) }
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.store.state } }))
vi.mock('./floating-workspace-panel-reveal', () => ({
  revealFloatingWorkspacePanel: mocks.reveal
}))
vi.mock('./floating-workspace-tab-creation', () => ({
  createFloatingWorkspaceTerminalTab: mocks.createFloatingTab
}))

import {
  openLocalTerminalForRemoteWorkspace,
  resolveLocalProjectFolder
} from './local-terminal-for-remote-workspace'

const PROJECT = 'github:acme/mono'

function repo(overrides: Partial<Repo>): Repo {
  return {
    id: 'repo',
    path: '/repo',
    displayName: 'mono',
    badgeColor: '#000',
    addedAt: 1,
    kind: 'git',
    ...overrides
  }
}

function setup(overrides: Partial<ProjectHostSetup>): ProjectHostSetup {
  return {
    id: 'setup',
    projectId: PROJECT,
    hostId: 'local',
    repoId: 'repo',
    path: '/repo',
    displayName: 'mono',
    setupState: 'ready',
    setupMethod: 'imported-existing-folder',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function devboxState(extra: { setups?: ProjectHostSetup[]; worktreeProjectId?: string } = {}) {
  const worktree: Pick<Worktree, 'id' | 'repoId' | 'projectId'> = {
    id: 'devbox::/home/ubuntu/co/mono',
    repoId: 'devbox',
    ...(extra.worktreeProjectId ? { projectId: extra.worktreeProjectId } : {})
  }
  return {
    repos: [
      repo({ id: 'devbox', path: '/home/ubuntu/co/mono', connectionId: 'devbox4' }),
      repo({ id: 'mac', path: '/Users/me/co/mono', workspaceStartPath: 'projects/ray' })
    ],
    projectHostSetups: extra.setups ?? [
      setup({
        id: 'devbox',
        repoId: 'devbox',
        hostId: 'ssh:devbox4',
        path: '/home/ubuntu/co/mono'
      }),
      setup({ id: 'mac', repoId: 'mac', path: '/Users/me/co/mono' })
    ],
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only id, repoId and projectId.
    worktreesByRepo: { devbox: [worktree as Worktree] }
  }
}

describe('resolveLocalProjectFolder', () => {
  it("starts in this computer's checkout of the project, in its start folder", () => {
    expect(resolveLocalProjectFolder(devboxState(), 'devbox::/home/ubuntu/co/mono')).toBe(
      '/Users/me/co/mono/projects/ray'
    )
  })

  it('uses the project the workspace row names', () => {
    const state = devboxState({
      worktreeProjectId: 'github:acme/other',
      setups: [setup({ id: 'mac', repoId: 'mac', projectId: 'github:acme/other' })]
    })
    expect(resolveLocalProjectFolder(state, 'devbox::/home/ubuntu/co/mono')).toBe(
      '/Users/me/co/mono/projects/ray'
    )
  })

  it('uses the remote registration when local and remote repos share an id', () => {
    const state = devboxState()
    state.repos.unshift(repo({ id: 'devbox', path: '/local/unrelated' }))
    state.projectHostSetups.unshift(
      setup({
        id: 'unrelated',
        repoId: 'devbox',
        projectId: 'github:acme/unrelated',
        path: '/local/unrelated'
      })
    )
    expect(resolveLocalProjectFolder(state, 'devbox::/home/ubuntu/co/mono')).toBe(
      '/Users/me/co/mono/projects/ray'
    )
  })

  it('uses the local setup path when its repository is no longer registered', () => {
    const state = devboxState()
    state.repos = state.repos.filter((entry) => entry.id !== 'mac')
    expect(resolveLocalProjectFolder(state, 'devbox::/home/ubuntu/co/mono')).toBe(
      '/Users/me/co/mono'
    )
  })

  it('has no folder when the project is not set up on this computer', () => {
    const notReady = devboxState({
      setups: [
        setup({ id: 'devbox', repoId: 'devbox', hostId: 'ssh:devbox4' }),
        setup({ id: 'mac', repoId: 'mac', setupState: 'not-set-up' })
      ]
    })
    expect(resolveLocalProjectFolder(notReady, 'devbox::/home/ubuntu/co/mono')).toBeNull()
    expect(resolveLocalProjectFolder(devboxState(), 'folder:unknown')).toBeNull()
  })
})

describe('openLocalTerminalForRemoteWorkspace', () => {
  const getFloatingTerminalCwd = vi.fn(async ({ path }: { path: string }) => path)

  beforeEach(() => {
    mocks.store.state = devboxState()
    mocks.reveal.mockReset()
    mocks.createFloatingTab.mockClear()
    getFloatingTerminalCwd.mockReset()
    getFloatingTerminalCwd.mockImplementation(async ({ path }) => path)
    vi.stubGlobal('window', { api: { app: { getFloatingTerminalCwd } } })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('opens a floating terminal in the local checkout', async () => {
    await openLocalTerminalForRemoteWorkspace('devbox::/home/ubuntu/co/mono')

    expect(getFloatingTerminalCwd).toHaveBeenCalledWith({ path: '/Users/me/co/mono/projects/ray' })
    expect(mocks.reveal).toHaveBeenCalledWith(mocks.store.state)
    expect(mocks.createFloatingTab).toHaveBeenCalledWith(
      mocks.store.state,
      undefined,
      undefined,
      '/Users/me/co/mono/projects/ray'
    )
  })

  it('uses the floating terminal default when main returns an empty cwd', async () => {
    getFloatingTerminalCwd.mockResolvedValueOnce('')
    await openLocalTerminalForRemoteWorkspace('devbox::/home/ubuntu/co/mono')
    expect(getFloatingTerminalCwd).toHaveBeenCalledWith({ path: '/Users/me/co/mono/projects/ray' })
    expect(mocks.createFloatingTab).toHaveBeenCalledWith(
      mocks.store.state,
      undefined,
      undefined,
      undefined
    )
  })

  it('reveals the floating workspace before creating its terminal', async () => {
    await openLocalTerminalForRemoteWorkspace('devbox::/home/ubuntu/co/mono')
    expect(mocks.reveal).toHaveBeenCalledTimes(1)
    expect(mocks.createFloatingTab).toHaveBeenCalledTimes(1)
    expect(mocks.reveal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createFloatingTab.mock.invocationCallOrder[0]
    )
  })

  it('propagates cwd resolution failure without revealing or creating a terminal', async () => {
    const error = new Error('Local checkout cannot be resolved')
    getFloatingTerminalCwd.mockRejectedValueOnce(error)
    await expect(openLocalTerminalForRemoteWorkspace('devbox::/home/ubuntu/co/mono')).rejects.toBe(
      error
    )
    expect(mocks.reveal).not.toHaveBeenCalled()
    expect(mocks.createFloatingTab).not.toHaveBeenCalled()
  })

  it("falls back to the floating terminal's own folder without a local checkout", async () => {
    mocks.store.state = devboxState({ setups: [] })

    await openLocalTerminalForRemoteWorkspace('devbox::/home/ubuntu/co/mono')

    expect(getFloatingTerminalCwd).not.toHaveBeenCalled()
    expect(mocks.createFloatingTab).toHaveBeenCalledWith(
      mocks.store.state,
      undefined,
      undefined,
      undefined
    )
  })
})
