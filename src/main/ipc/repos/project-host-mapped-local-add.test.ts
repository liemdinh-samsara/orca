import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GitRunner from '../../git/runner'
import type * as RepoModule from '../../git/repo'

const { reposMocks, moduleMocks } = await vi.hoisted(async () => {
  const moduleMocks = await import('../repos-remote-test-harness')
  return { reposMocks: moduleMocks.createReposIpcMocks(), moduleMocks }
})

vi.mock('electron', () => ({
  ...moduleMocks.electronModuleMock(reposMocks),
  ipcRenderer: { invoke: vi.fn() }
}))
vi.mock('../../git/repo', async (importOriginal) =>
  moduleMocks.gitRepoModuleMock(await importOriginal<typeof RepoModule>())
)
vi.mock('../../git/runner', async (importOriginal) =>
  moduleMocks.gitRunnerModuleMock(reposMocks, await importOriginal<typeof GitRunner>())
)
vi.mock('../../git/worktree', () => moduleMocks.gitWorktreeModuleMock(reposMocks))
vi.mock('../registered-worktree-roots-cache', () =>
  moduleMocks.registeredWorktreeRootsCacheModuleMock(reposMocks)
)
vi.mock('../../worktree-root-preparation', () =>
  moduleMocks.worktreeRootPreparationModuleMock(reposMocks)
)
vi.mock('../../providers/ssh-git-dispatch', () => moduleMocks.sshGitDispatchModuleMock(reposMocks))
vi.mock('../../providers/ssh-filesystem-dispatch', () =>
  moduleMocks.sshFilesystemDispatchModuleMock(reposMocks)
)
vi.mock('../ssh', () => moduleMocks.sshModuleMock(reposMocks))
vi.mock('../../ssh/ssh-target-registry', () => moduleMocks.sshModuleMock(reposMocks))

const { setupProjectAtMappedPath, emitRepoAdded } = vi.hoisted(() => ({
  setupProjectAtMappedPath: vi.fn(),
  emitRepoAdded: vi.fn()
}))
vi.mock('./project-host-mapped-setup', () => ({ setupProjectAtMappedPath }))
vi.mock('./repo-added-telemetry', () => ({ emitRepoAdded }))
vi.mock('../folder-repo-git-upgrade-wake', () => ({ wakeFolderRepoGitUpgradeWatch: vi.fn() }))
vi.mock('../worktree-base-directory-watcher', () => ({
  scheduleCurrentWorktreeBaseDirectoryWatcherSync: vi.fn()
}))

import { ipcMain, ipcRenderer } from 'electron'
import { registerRepoHandlers } from '../repos'
import { projectsApi } from '../../../preload/api/projects-bridge'
import { createRepoHandlerHarness, resetLocalRepoMocks } from '../repos-remote-test-harness'

const channel = 'projectHostSetups:setupMappedFolder'
const args = { projectId: 'project-1', hostId: 'ssh:devbox' as const }
const result = {
  project: { id: args.projectId, displayName: 'Project' },
  setup: { id: 'setup-1', projectId: args.projectId, hostId: args.hostId },
  repo: { id: 'repo-1', path: '/home/dev/project', connectionId: 'devbox' }
}
const { handlers, mockWindow, captureHandlers } = createRepoHandlerHarness()

beforeEach(() => {
  resetLocalRepoMocks(reposMocks)
  setupProjectAtMappedPath.mockReset()
  emitRepoAdded.mockReset()
  mockWindow.webContents.send.mockReset()
  vi.mocked(ipcMain.removeHandler).mockClear()
  vi.mocked(ipcRenderer.invoke).mockReset()
  captureHandlers(reposMocks.handleMock)
  Reflect.apply(registerRepoHandlers, undefined, [mockWindow, reposMocks.mockStore, {}])
})

describe('mapped project folder IPC', () => {
  it('removes and registers the channel again when the app window changes', () => {
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(channel)
    expect(reposMocks.handleMock).toHaveBeenCalledWith(channel, expect.any(Function))
    const original = handlers.get(channel)

    Reflect.apply(registerRepoHandlers, undefined, [mockWindow, reposMocks.mockStore, {}])

    expect(
      vi.mocked(ipcMain.removeHandler).mock.calls.filter(([name]) => name === channel)
    ).toHaveLength(2)
    expect(handlers.get(channel)).not.toBe(original)
  })

  it.each([
    { projectId: '', hostId: args.hostId },
    { projectId: args.projectId, hostId: '' }
  ])('rejects invalid mapped setup arguments %j before setup', async (invalidArgs) => {
    await expect(handlers.get(channel)!(null, invalidArgs)).rejects.toThrow(
      'project_host_setup_mapped_invalid_args'
    )
    expect(setupProjectAtMappedPath).not.toHaveBeenCalled()
    expect(reposMocks.invalidateAuthorizedRootsCacheMock).not.toHaveBeenCalled()
    expect(mockWindow.webContents.send).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'finishes a ready setup with alreadyExisted=%s',
    async (alreadyExisted) => {
      setupProjectAtMappedPath.mockResolvedValue({ status: 'ready', result, alreadyExisted })

      await expect(handlers.get(channel)!(null, args)).resolves.toEqual({ status: 'ready', result })

      expect(setupProjectAtMappedPath).toHaveBeenCalledExactlyOnceWith(reposMocks.mockStore, args)
      expect(reposMocks.invalidateAuthorizedRootsCacheMock).toHaveBeenCalledTimes(1)
      expect(mockWindow.webContents.send).toHaveBeenCalledExactlyOnceWith('repos:changed')
      expect(emitRepoAdded).toHaveBeenCalledExactlyOnceWith('folder_picker', alreadyExisted)
      if (alreadyExisted) {
        expect(reposMocks.prepareLocalWorktreeRootForRepoMock).toHaveBeenCalledExactlyOnceWith(
          reposMocks.mockStore,
          result.repo
        )
      } else {
        expect(reposMocks.prepareLocalWorktreeRootForRepoMock).not.toHaveBeenCalled()
      }
    }
  )

  it('passes the suggested missing folder through without announcing a catalog change', async () => {
    const outcome = {
      status: 'unavailable',
      reason: 'not-found',
      suggestedPath: '/home/dev/project'
    }
    setupProjectAtMappedPath.mockResolvedValue(outcome)

    await expect(handlers.get(channel)!(null, args)).resolves.toBe(outcome)

    expect(reposMocks.invalidateAuthorizedRootsCacheMock).not.toHaveBeenCalled()
    expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    expect(emitRepoAdded).not.toHaveBeenCalled()
    expect(reposMocks.prepareLocalWorktreeRootForRepoMock).not.toHaveBeenCalled()
  })

  it('exposes the same arguments and outcome through the preload bridge', async () => {
    const outcome = { status: 'unavailable', reason: 'not-connected' }
    vi.mocked(ipcRenderer.invoke).mockResolvedValue(outcome)

    await expect(projectsApi.setupMappedFolder(args)).resolves.toBe(outcome)

    expect(ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(channel, args)
  })
})
