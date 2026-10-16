import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Repo } from '../../shared/repo-types'
import { OrcaRuntimeService } from './orca-runtime'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: {
    on: vi.fn(),
    removeListener: vi.fn()
  },
  app: { getPath: vi.fn(() => '/tmp') }
}))

function stubLaunchScope(
  runtime: OrcaRuntimeService,
  path = '/repo/app',
  repo: Repo | null = null
): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this stub exposes the runtime protected launch-scope method with its actual return shape.
  const internals = runtime as unknown as {
    resolveTerminalWorkspaceLaunchScope: (selector: string) => Promise<{
      id: string
      path: string
      connectionId: string | null
      repo: Repo | null
      folderWorkspace: null
    }>
  }
  vi.spyOn(internals, 'resolveTerminalWorkspaceLaunchScope').mockResolvedValue({
    id: 'wt-1',
    path,
    connectionId: null,
    repo,
    folderWorkspace: null
  })
}

describe('OrcaRuntimeService terminal startup cwd', () => {
  it('spawns terminals inside the requested worktree subdirectory', async () => {
    const runtime = new OrcaRuntimeService()
    stubLaunchScope(runtime)
    const spawn = vi.fn().mockResolvedValue({ id: 'pty-1' })
    runtime.setPtyController({
      spawn,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })

    await runtime.createTerminal('id:wt-1', { cwd: '/repo/app/packages/web' })

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo/app/packages/web',
        worktreeId: 'wt-1'
      })
    )
  })

  it('spawns terminals at a requested cwd outside the selected worktree (#7685)', async () => {
    const runtime = new OrcaRuntimeService()
    stubLaunchScope(runtime)
    const spawn = vi.fn().mockResolvedValue({ id: 'pty-1' })
    runtime.setPtyController({
      spawn,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })

    await runtime.createTerminal('id:wt-1', { cwd: '/repo/app-other' })

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo/app-other',
        worktreeId: 'wt-1'
      })
    )
  })

  it('reveals main-spawned terminals with their nested startup cwd', async () => {
    const runtime = new OrcaRuntimeService()
    stubLaunchScope(runtime)
    const spawn = vi.fn().mockResolvedValue({ id: 'pty-1' })
    const revealTerminalSession = vi.fn().mockResolvedValue({ tabId: 'tab-1' })
    runtime.setPtyController({
      spawn,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })
    runtime.setNotifier({
      worktreesChanged: vi.fn(),
      reposChanged: vi.fn(),
      activateWorktree: vi.fn(),
      createTerminal: vi.fn(),
      revealTerminalSession,
      splitTerminal: vi.fn(),
      renameTerminal: vi.fn(),
      focusTerminal: vi.fn(),
      closeTerminal: vi.fn(),
      sleepWorktree: vi.fn(),
      terminalFitOverrideChanged: vi.fn(),
      terminalDriverChanged: vi.fn()
    })

    await runtime.createTerminal('id:wt-1', { cwd: '/repo/app/packages/web' })

    expect(revealTerminalSession).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ cwd: '/repo/app/packages/web' })
    )
  })

  it('materializes restored headless mobile tabs in the persisted startup cwd', async () => {
    const store = {
      // wt-1 is a worktree id, not a registered repo, so getRepo returns undefined.
      getRepo: () => undefined,
      getWorkspaceSession: () => ({
        activeRepoId: null,
        activeWorktreeId: 'wt-1',
        activeTabId: 'tab-1',
        tabsByWorktree: {
          'wt-1': [
            {
              id: 'tab-1',
              ptyId: null,
              worktreeId: 'wt-1',
              title: 'Terminal 1',
              defaultTitle: 'Terminal 1',
              startupCwd: '/repo/app/packages/web',
              customTitle: null,
              color: null,
              sortOrder: 0,
              createdAt: 0
            }
          ]
        },
        terminalLayoutsByTabId: {}
      })
    }
    const runtime = new OrcaRuntimeService(store as never)
    stubLaunchScope(runtime)
    const spawn = vi.fn().mockResolvedValue({ id: 'pty-1' })
    runtime.setPtyController({
      spawn,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })

    const listed = await runtime.listMobileSessionTabs('id:wt-1')
    const tab = listed.tabs.find((candidate) => candidate.type === 'terminal')
    expect(tab).toMatchObject({ startupCwd: '/repo/app/packages/web' })

    await runtime.activateMobileSessionTab('id:wt-1', tab!.id)

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo/app/packages/web',
        worktreeId: 'wt-1'
      })
    )
  })
})

describe('project start folder terminal startup', () => {
  const directories: string[] = []
  afterEach(() => {
    for (const path of directories.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  })

  it.each([
    { exists: true, requested: undefined, expected: 'start' },
    { exists: false, requested: undefined, expected: 'root' },
    { exists: true, requested: 'explicit', expected: 'explicit' }
  ])(
    'uses $expected cwd (start folder exists=$exists)',
    async ({ exists, requested, expected }) => {
      const path = mkdtempSync(join(tmpdir(), 'orca-start-cwd-'))
      directories.push(path)
      const startPath = join(path, 'packages', 'web')
      if (exists) {
        mkdirSync(startPath, { recursive: true })
      }
      const repo: Repo = {
        id: 'repo-1',
        path,
        displayName: 'app',
        badgeColor: 'blue',
        addedAt: 0,
        kind: 'git',
        workspaceStartPath: 'packages/web'
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this spawn uses only optional project resolution and settings on the store.
      const runtime = new OrcaRuntimeService({
        getProjects: () => [],
        getSettings: () => ({})
      } as never)
      stubLaunchScope(runtime, path, repo)
      const spawn = vi.fn().mockResolvedValue({ id: 'pty-1' })
      runtime.setPtyController({
        spawn,
        write: () => true,
        kill: () => true,
        getForegroundProcess: async () => null
      })
      const requestedCwd = requested ? join(path, requested) : undefined

      await runtime.createTerminal('id:wt-1', requestedCwd ? { cwd: requestedCwd } : {})

      expect(spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expected === 'start' ? startPath : expected === 'root' ? path : requestedCwd,
          worktreeId: 'wt-1'
        })
      )
    }
  )
})
