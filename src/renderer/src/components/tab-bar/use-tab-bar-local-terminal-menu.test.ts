import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubHeadlessReact } from './tab-bar-windows-shell-launch-render-stubs'
import {
  appStoreSnapshot,
  resetAppStoreSnapshot,
  useAppStoreExport
} from './tab-bar-windows-shell-launch-test-harness'
import { buildTabCreateMenuOptions } from './tab-create-menu-options'
import type { TabBarCreateMenuController } from './use-tab-bar-create-menu-controller'
import { useTabBarLocalTerminalMenu } from './use-tab-bar-local-terminal-menu'

const mocks = vi.hoisted(() => ({ openLocalTerminal: vi.fn(), toastError: vi.fn() }))
vi.mock('react', async () => await stubHeadlessReact())
vi.mock('../../store', () => ({ useAppStore: useAppStoreExport }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/lib/local-terminal-for-remote-workspace', () => ({
  openLocalTerminalForRemoteWorkspace: mocks.openLocalTerminal
}))

function controller(
  options = buildTabCreateMenuOptions({
    terminalOnly: false,
    hasNewBrowser: true,
    hasNewMarkdown: true,
    hasOpenMarkdown: true,
    hasSimulator: true,
    simulatorIsGoTo: false
  })
): TabBarCreateMenuController {
  return {
    createMenuOptions: options,
    newTabMenuOpen: false,
    setNewTabMenuOpen: vi.fn(),
    setCreateMenuQuery: vi.fn(),
    windowsShellEntries: undefined,
    handleSelectCreateMenuOption: vi.fn(),
    launchAgentFromNewTabEntry: vi.fn(),
    runPendingNewTabMenuFocusAfterClose: vi.fn(),
    clearPendingNewTabMenuFocusOnUnmount: vi.fn(),
    queueNewActiveTerminalFocusAfterNewTabMenuClose: vi.fn(),
    queueTerminalTabFocusAfterNewTabMenuClose: vi.fn(),
    queueFocusAfterNewTabMenuClose: vi.fn(),
    showStaticCreateMenuItems: true
  }
}

function RenderMenu(base: TabBarCreateMenuController, terminalOnly = false) {
  return useTabBarLocalTerminalMenu(base, { worktreeId: 'repo::remote', terminalOnly })
}

describe('useTabBarLocalTerminalMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openLocalTerminal.mockResolvedValue(undefined)
    resetAppStoreSnapshot()
    vi.stubGlobal('window', {})
    appStoreSnapshot.repos = [{ id: 'repo', connectionId: 'ssh-1' }]
    appStoreSnapshot.worktreesByRepo = {
      repo: [{ id: 'repo::remote', repoId: 'repo' }]
    }
  })

  afterEach(() => vi.unstubAllGlobals())

  it('returns the base controller by identity for a local workspace', () => {
    appStoreSnapshot.repos = [{ id: 'repo', connectionId: null }]
    const base = controller()
    expect(RenderMenu(base)).toBe(base)
  })

  it.each([false, true])('inserts after the last terminal option (shell menu: %s)', (shellMenu) => {
    const options = buildTabCreateMenuOptions({
      terminalOnly: false,
      hasNewBrowser: true,
      hasNewMarkdown: true,
      hasOpenMarkdown: true,
      hasSimulator: true,
      simulatorIsGoTo: false,
      windowsShellEntries: shellMenu
        ? [
            { label: 'PowerShell', shell: 'powershell.exe' },
            { label: 'Command Prompt', shell: 'cmd.exe' }
          ]
        : undefined
    })
    const base = controller(options)
    const result = RenderMenu(base)
    const lastTerminalIndex = options.findLastIndex(
      (option) => option.kind === 'new-terminal' || option.kind === 'new-terminal-shell'
    )
    expect(result.createMenuOptions.map((option) => option.id)).toEqual([
      ...options.slice(0, lastTerminalIndex + 1).map((option) => option.id),
      'new-local-terminal',
      ...options.slice(lastTerminalIndex + 1).map((option) => option.id)
    ])
    expect(base.createMenuOptions).toBe(options)
    expect(options.some((option) => option.kind === 'new-local-terminal')).toBe(false)
    expect(result.openLocalTerminal).toEqual(expect.any(Function))
    result.openLocalTerminal?.()
    expect(mocks.openLocalTerminal).toHaveBeenCalledExactlyOnceWith('repo::remote')
  })

  it('keeps terminal-only options while exposing the local terminal callback', () => {
    const options = buildTabCreateMenuOptions({
      terminalOnly: true,
      hasNewBrowser: false,
      hasNewMarkdown: false,
      hasOpenMarkdown: false,
      hasSimulator: false,
      simulatorIsGoTo: false
    })
    const result = RenderMenu(controller(options), true)
    expect(result.createMenuOptions).toBe(options)
    expect(options).toEqual([])
    result.openLocalTerminal?.()
    expect(mocks.openLocalTerminal).toHaveBeenCalledExactlyOnceWith('repo::remote')
  })

  it('routes local terminal selection separately and forwards every other menu option', () => {
    const base = controller()
    const result = RenderMenu(base)
    const local = result.createMenuOptions.find((option) => option.kind === 'new-local-terminal')
    expect(local).toBeDefined()
    if (!local) {
      throw new Error('Missing local terminal option')
    }
    result.handleSelectCreateMenuOption(local)
    expect(mocks.openLocalTerminal).toHaveBeenCalledExactlyOnceWith('repo::remote')
    expect(base.handleSelectCreateMenuOption).not.toHaveBeenCalled()
    const shellAndSimulatorOptions = buildTabCreateMenuOptions({
      terminalOnly: false,
      hasNewBrowser: false,
      hasNewMarkdown: false,
      hasOpenMarkdown: false,
      hasSimulator: true,
      simulatorIsGoTo: true,
      windowsShellEntries: [{ label: 'Command Prompt', shell: 'cmd.exe' }]
    })
    const otherOptions = [...base.createMenuOptions, ...shellAndSimulatorOptions]
    for (const option of otherOptions) {
      result.handleSelectCreateMenuOption(option)
    }
    expect(vi.mocked(base.handleSelectCreateMenuOption).mock.calls).toEqual(
      otherOptions.map((option) => [option])
    )
    expect(mocks.openLocalTerminal).toHaveBeenCalledTimes(1)
  })

  it('returns the base unchanged for an SSH workspace in the web client', () => {
    vi.stubGlobal('window', { __ORCA_WEB_CLIENT__: true })
    const base = controller()
    expect(RenderMenu(base)).toBe(base)
    expect(mocks.openLocalTerminal).not.toHaveBeenCalled()
  })

  it.each([
    new Error('Checkout is unavailable'),
    new Error(
      "Error invoking remote method 'app:getFloatingTerminalCwd': Error: Checkout is unavailable"
    )
  ])('shows the IPC error detail when opening fails: %s', async (error) => {
    mocks.openLocalTerminal.mockRejectedValueOnce(error)
    RenderMenu(controller()).openLocalTerminal?.()
    await vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('Could not open a local terminal', {
        description: 'Checkout is unavailable'
      })
    })
  })
})
