import type * as WorktreeScanCacheModule from '../git/worktree-scan-cache'
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
import { hostWorktreeTarget } from '../../shared/worktree/host-qualified-identity'

vi.mock('../git/worktree-scan-cache', async (importOriginal) => {
  return {
    ...(await importOriginal<typeof WorktreeScanCacheModule>()),
    listWorktrees: (await import('./worktrees-test-module-mocks')).listWorktreesMock,
    listWorktreesSharedStrictAllowingTrueEmpty: (await import('./worktrees-test-module-mocks'))
      .listWorktreesMock,
    listWorktreesSharedStrict: (await import('./worktrees-test-module-mocks')).listWorktreesMock
  }
})

vi.mock('electron', async () =>
  (await import('./worktrees-test-module-mocks')).electronModuleMock()
)
vi.mock('../../shared/git-worktree-porcelain-parser', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  parseWorktreeList: (await import('./worktrees-test-module-mocks')).parseWorktreeListMock
}))

vi.mock('../git/worktrees/removal/worktree-removal-preflight', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertWorktreeCleanForRemoval: (await import('./worktrees-test-module-mocks'))
    .assertWorktreeCleanForRemovalMock
}))

vi.mock('../git/worktrees/creation/worktree-add', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  addWorktree: (await import('./worktrees-test-module-mocks')).addWorktreeMock
}))

vi.mock('../git/worktrees/creation/worktree-sparse-add', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  addSparseWorktree: (await import('./worktrees-test-module-mocks')).addSparseWorktreeMock
}))

vi.mock('../git/worktrees/removal/worktree-removal', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  removeWorktree: (await import('./worktrees-test-module-mocks')).removeWorktreeMock
}))

vi.mock('../git/worktrees/removal/worktree-branch-removal', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  forceDeleteLocalBranch: (await import('./worktrees-test-module-mocks')).forceDeleteLocalBranchMock
}))
vi.mock('../git/worktrees/catalog/worktree-listing', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listWorktreesStrict: (await import('./worktrees-test-module-mocks')).listWorktreesMock,
  describeCreatedWorktree: (await import('./worktrees-test-module-mocks'))
    .describeCreatedWorktreeMock
}))
const { getWorktreeRunnerMocks } = vi.hoisted(() => {
  function createWorktreeRunnerMocks() {
    return (async () => (await import('./worktrees-test-module-mocks')).gitRunnerModuleMock())()
  }
  let runner: ReturnType<typeof createWorktreeRunnerMocks> | undefined
  return { getWorktreeRunnerMocks: () => (runner ??= createWorktreeRunnerMocks()) }
})

vi.mock('../git/command-runner/git-exec-file', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  gitExecFileAsync: (await getWorktreeRunnerMocks()).gitExecFileAsync
}))

vi.mock('../git/command-runner/git-exec-file-sync', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  gitExecFileSync: (await getWorktreeRunnerMocks()).gitExecFileSync
}))
vi.mock('../git/repo', async () =>
  (await import('./worktrees-test-module-mocks')).gitRepoModuleMock()
)
vi.mock('../git/repo-default-base-ref', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getBaseRefDefault: (await import('./worktrees-test-module-mocks')).getBaseRefDefaultMock
}))
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
vi.mock('./worktree-symlinks', async () =>
  (await import('./worktrees-test-module-mocks')).worktreeSymlinksModuleMock()
)

vi.mock('../git/worktrees/content-paths/worktree-symlink-detection', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findExistingWorktreeSymlinkPaths: (await import('./worktrees-test-module-mocks'))
    .findExistingWorktreeSymlinkPathsMock
}))
vi.mock('../workspace-hooks/hooks', async () =>
  (await import('./worktrees-test-module-mocks')).hooksModuleMock()
)
vi.mock('../workspace-hooks/setup-runner-script-text', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).setupRunnerScriptTextModuleMock(
    await importOriginal<Record<string, unknown>>()
  )
)
vi.mock('../workspace-hooks/worktree-runner-script', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).worktreeRunnerScriptModuleMock(
    await importOriginal<Record<string, unknown>>()
  )
)
vi.mock('../workspace-hooks/effective-hook-config', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).effectiveHookConfigModuleMock(
    await importOriginal<Record<string, unknown>>()
  )
)
vi.mock('../workspace-hooks/setup-hook-env-vars', async (importOriginal) =>
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
vi.mock('../pty/history/terminal-history-deletion', async () =>
  (await import('./worktrees-test-module-mocks')).terminalHistoryDeletionModuleMock()
)
vi.mock('../ports/advertised-url-watcher', async () =>
  (await import('./worktrees-test-module-mocks')).advertisedUrlWatcherModuleMock()
)
vi.mock('../workspaces/cleanup/workspace-cleanup-scan-snapshot', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceCleanupScanSnapshotModuleMock()
)
vi.mock('../workspaces/space-analysis/workspace-space-analysis-snapshot', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceSpaceAnalysisSnapshotModuleMock()
)
vi.mock('../workspaces/cleanup/workspace-cleanup-removal-snapshot-prune', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceCleanupRemovalSnapshotPruneModuleMock()
)
vi.mock('../runtime/worktree-teardown', async () =>
  (await import('./worktrees-test-module-mocks')).worktreeTeardownModuleMock()
)
vi.mock('./pty/provider/registry', async () =>
  (await import('./worktrees-test-module-mocks')).ptyRegistryModuleMock()
)
vi.mock('./pty/provider/state-cleanup', async () =>
  (await import('./worktrees-test-module-mocks')).ptyStateCleanupModuleMock()
)

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
      expect.objectContaining({ id: expect.stringContaining('::workspace:') }),
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
      expect(store.removeWorktreeMeta).toHaveBeenCalledWith(
        hostWorktreeTarget({ id: instanceId, hostId: 'local' })
      )
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
      expect(store.removeWorktreeMeta).toHaveBeenCalledWith(
        hostWorktreeTarget({ id: instanceId, hostId: 'local' })
      )
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
  // Upstream retired the legacy worktrees:list IPC (#32942); the detected listing is the sidebar's source.
  it.each([null, 'ssh-1'])(
    'includes instance rows in the detected listing on host %s',
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

      const detected = await handlers['worktrees:listDetected'](null, { repoId: repo.id })
      if (connectionId) {
        // An unserved SSH host lists from metadata; the instance row keeps the checkout path.
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
