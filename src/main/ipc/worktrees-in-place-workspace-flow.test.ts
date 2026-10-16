import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type * as WorktreeLogic from './worktree-logic'
import { handlers, mainWindow, setupWorktreeHandlers, store } from './worktrees-test-harness'
import { makeWorktreeMeta } from './worktrees-test-fixtures'
import {
  addWorktreeMock,
  listWorktreesMock,
  removeWorktreeMock
} from './worktrees-test-module-mocks'
import * as nestedRemoval from './worktrees/removal/nested-worktree-removal'

vi.mock('electron', async () =>
  (await import('./worktrees-test-module-mocks')).electronModuleMock()
)
vi.mock('../git/worktree', async () =>
  (await import('./worktrees-test-module-mocks')).gitWorktreeModuleMock()
)
vi.mock('../git/runner', async () =>
  (await import('./worktrees-test-module-mocks')).gitRunnerModuleMock()
)
vi.mock('../git/repo', async () =>
  (await import('./worktrees-test-module-mocks')).gitRepoModuleMock()
)
vi.mock('../git/git-username', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveLocalGitUsername: (await import('./worktrees-test-module-mocks'))
    .resolveLocalGitUsernameMock
}))
vi.mock('../github/client', async () =>
  (await import('./worktrees-test-module-mocks')).githubClientModuleMock()
)
vi.mock('../source-control/hosted-review', async () =>
  (await import('./worktrees-test-module-mocks')).hostedReviewModuleMock()
)
vi.mock('../providers/ssh-git-dispatch', async () =>
  (await import('./worktrees-test-module-mocks')).sshGitDispatchModuleMock()
)
vi.mock('../providers/ssh-filesystem-dispatch', async () =>
  (await import('./worktrees-test-module-mocks')).sshFilesystemDispatchModuleMock()
)
vi.mock('./worktree-symlinks', async () =>
  (await import('./worktrees-test-module-mocks')).worktreeSymlinksModuleMock()
)
vi.mock('./ssh', async () => (await import('./worktrees-test-module-mocks')).sshModuleMock())
vi.mock('../ssh/ssh-target-registry', async () =>
  (await import('./worktrees-test-module-mocks')).sshTargetRegistryModuleMock()
)
vi.mock('../hooks', async () => (await import('./worktrees-test-module-mocks')).hooksModuleMock())
vi.mock('../setup-runner-script-text', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).setupRunnerScriptTextModuleMock(
    await importOriginal<Record<string, unknown>>()
  )
)
vi.mock('../worktree-runner-script', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).worktreeRunnerScriptModuleMock(
    await importOriginal<Record<string, unknown>>()
  )
)
vi.mock('../effective-hook-config', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).effectiveHookConfigModuleMock(
    await importOriginal<Record<string, unknown>>()
  )
)
vi.mock('../setup-hook-env-vars', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).setupHookEnvVarsModuleMock(
    await importOriginal<Record<string, unknown>>()
  )
)
vi.mock('./worktree-logic', async (importOriginal) => {
  const actual = await importOriginal<typeof WorktreeLogic>()
  return {
    ...(await import('./worktrees-test-module-mocks')).worktreeLogicModuleMock(actual),
    computeWorkspaceRootAsync: vi.fn(actual.computeWorkspaceRootAsync)
  }
})
vi.mock('../terminal-history-deletion', async () =>
  (await import('./worktrees-test-module-mocks')).terminalHistoryDeletionModuleMock()
)
vi.mock('../ports/advertised-url-watcher', async () =>
  (await import('./worktrees-test-module-mocks')).advertisedUrlWatcherModuleMock()
)
vi.mock('../workspace-cleanup-scan-snapshot', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceCleanupScanSnapshotModuleMock()
)
vi.mock('../workspace-space-analysis-snapshot', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceSpaceAnalysisSnapshotModuleMock()
)
vi.mock('../workspace-cleanup-removal-snapshot-prune', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceCleanupRemovalSnapshotPruneModuleMock()
)
vi.mock('../runtime/worktree-teardown', async () =>
  (await import('./worktrees-test-module-mocks')).worktreeTeardownModuleMock()
)
vi.mock('./pty', async () => (await import('./worktrees-test-module-mocks')).ptyModuleMock())

const repo: Repo = {
  id: 'repo-git',
  path: '/workspace/mono',
  displayName: 'mono',
  badgeColor: 'blue',
  addedAt: 0,
  kind: 'git'
}
const instanceId = `${repo.id}::${repo.path}::workspace:11111111-2222-3333-4444-555555555555`

beforeEach(() => {
  setupWorktreeHandlers()
  store.getRepo.mockReturnValue(repo)
  store.getRepos.mockReturnValue([repo])
})

describe('in-place git workspace creation', () => {
  it('registers an instance at the project checkout without git worktree add', async () => {
    store.getRepo.mockReturnValue({ ...repo, inPlaceWorkspaces: true })
    store.setWorktreeMeta.mockImplementation((_id, updates) => makeWorktreeMeta(updates))

    const result = await handlers['worktrees:create'](null, { repoId: repo.id, name: 'api' })

    expect(addWorktreeMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      worktree: {
        id: expect.stringMatching(/^repo-git::\/workspace\/mono::workspace:[0-9a-f-]{36}$/),
        repoId: repo.id,
        path: repo.path,
        displayName: 'api'
      }
    })
    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      expect.stringContaining('::workspace:'),
      expect.objectContaining({ displayName: 'api' })
    )
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('worktrees:changed', {
      repoId: repo.id
    })
  })

  it('still adds a git worktree when in-place workspaces are explicitly disabled', async () => {
    store.getRepo.mockReturnValue({ ...repo, inPlaceWorkspaces: false })
    listWorktreesMock.mockResolvedValue([
      { path: '/workspace/api', head: 'abc', branch: 'api', isBare: false, isMainWorktree: false }
    ])
    await handlers['worktrees:create'](null, { repoId: repo.id, name: 'api' })
    expect(addWorktreeMock).toHaveBeenCalledOnce()
    expect(addWorktreeMock.mock.calls[0]?.[0]).toBe(repo.path)
  })
})

describe('in-place git workspace removal', () => {
  it.each([false, undefined])(
    'forgets the instance after the setting becomes %s',
    async (inPlaceWorkspaces) => {
      store.getRepo.mockReturnValue({ ...repo, inPlaceWorkspaces })
      await handlers['worktrees:remove'](null, { worktreeId: instanceId, force: true })
      expect(listWorktreesMock).not.toHaveBeenCalled()
      expect(removeWorktreeMock).not.toHaveBeenCalled()
      expect(store.removeWorktreeMeta).toHaveBeenCalledWith(instanceId, 'local')
      expect(mainWindow.webContents.send).toHaveBeenCalledWith('worktrees:changed', {
        repoId: repo.id
      })
    }
  )

  it('skips approved nested removals beneath the shared checkout', async () => {
    const removeNested = vi.spyOn(nestedRemoval, 'removeApprovedNestedWorktrees')
    try {
      await handlers['worktrees:remove'](null, {
        worktreeId: instanceId,
        force: true,
        approvedNestedWorktrees: [
          {
            path: '/workspace/mono/nested',
            head: 'abc',
            branch: 'refs/heads/nested',
            isBare: false,
            isMainWorktree: false
          }
        ]
      })
      expect(removeNested).not.toHaveBeenCalled()
      expect(listWorktreesMock).not.toHaveBeenCalled()
      expect(removeWorktreeMock).not.toHaveBeenCalled()
      expect(store.removeWorktreeMeta).toHaveBeenCalledWith(instanceId, 'local')
    } finally {
      removeNested.mockRestore()
    }
  })

  it('returns an empty nested removal preview without scanning git', async () => {
    await expect(
      handlers['worktrees:previewNestedRemoval'](null, { worktreeId: instanceId })
    ).resolves.toEqual([])
    expect(listWorktreesMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
  })
})

describe('in-place git workspace IPC listings', () => {
  it.each([null, 'ssh-1'])(
    'includes instance rows in visible and detected listings on host %s',
    async (connectionId) => {
      const owner = { ...repo, connectionId, inPlaceWorkspaces: true }
      store.getRepo.mockReturnValue(owner)
      store.getRepos.mockReturnValue([owner])
      const hostId = connectionId ? ('ssh:ssh-1' as const) : ('local' as const)
      const metadata = {
        [instanceId]: makeWorktreeMeta({ displayName: 'api', instanceId: 'api-instance', hostId })
      }
      store.getAllWorktreeMeta.mockReturnValue(metadata)
      store.getWorktreeMeta.mockImplementation((id) => metadata[id])
      const root = {
        path: repo.path,
        head: 'root-head',
        branch: 'refs/heads/main',
        isBare: false,
        isMainWorktree: true
      }
      listWorktreesMock.mockResolvedValue([root])

      const visible = await handlers['worktrees:list'](null, { repoId: repo.id })
      const detected = await handlers['worktrees:listDetected'](null, { repoId: repo.id })
      if (connectionId) {
        // An unserved SSH host lists from metadata; the instance row keeps the checkout path.
        expect(visible).toEqual([
          expect.objectContaining({ id: instanceId, path: repo.path, displayName: 'api', hostId })
        ])
        expect(detected).toMatchObject({
          authoritative: false,
          source: 'metadata-fallback',
          worktrees: [
            expect.objectContaining({
              id: instanceId,
              path: repo.path,
              isMainWorktree: false,
              displayName: 'api',
              instanceId: 'api-instance',
              hostId
            })
          ]
        })
        expect(listWorktreesMock).not.toHaveBeenCalled()
        return
      }
      expect(visible).toEqual([
        expect.objectContaining({ id: `${repo.id}::${repo.path}` }),
        expect.objectContaining({ id: instanceId, path: repo.path, displayName: 'api', hostId })
      ])
      expect(detected).toMatchObject({
        authoritative: true,
        worktrees: [
          expect.objectContaining({ id: `${repo.id}::${repo.path}` }),
          expect.objectContaining({
            id: instanceId,
            visible: true,
            selectedCheckout: true,
            displayName: 'api',
            instanceId: 'api-instance',
            hostId
          })
        ]
      })
      expect(listWorktreesMock).toHaveBeenCalled()
    }
  )
})
