import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import type { WorktreeSetupLaunch } from '../../../shared/worktree/launch-types'
import type { WorktreeActivationStore } from '@/lib/worktree-activation-store-contract'

const { appState } = vi.hoisted(() => {
  const appState: { settings: { setupScriptLaunchMode?: string } | null; repos: Repo[] } = {
    settings: null,
    repos: []
  }
  return { appState }
})

vi.mock('@/store', () => ({
  useAppStore: { getState: () => appState }
}))

import { queueSetupAndIssueCommands } from './worktree-setup-issue-command-queue'

const INSTANCE_UUID = '123e4567-e89b-12d3-a456-426614174000'
const WORKTREE_ID = `repo-1::/projects/mono::workspace:${INSTANCE_UUID}`

const setup: WorktreeSetupLaunch = {
  runnerScriptPath: '/tmp/setup.sh',
  envVars: { ORCA_WORKTREE_PATH: '/projects/mono' }
}

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/projects/mono',
    displayName: 'mono',
    badgeColor: '#999999',
    addedAt: 1,
    ...overrides
  }
}

function makeStore() {
  return {
    createTab: vi.fn(() => ({ id: 'setup-tab' })),
    setActiveTab: vi.fn(),
    setTabCustomTitle: vi.fn(),
    queueTabStartupCommand: vi.fn(),
    queueTabSetupSplit: vi.fn(),
    queueTabIssueCommandSplit: vi.fn()
  }
}

function asActivationStore(store: ReturnType<typeof makeStore>): WorktreeActivationStore {
  // The queue only calls the six spied methods; the rest satisfy the contract as inert fillers.
  return Object.assign(
    {
      tabsByWorktree: {},
      defaultTerminalTabsAppliedByWorktreeId: {},
      markDefaultTerminalTabsApplied: vi.fn(),
      setTabColor: vi.fn(),
      reconcileWorktreeTabModel: vi.fn(() => ({ renderableTabCount: 0 })),
      queueTabInitialCwd: vi.fn()
    },
    store
  )
}

beforeEach(() => {
  appState.settings = null
  appState.repos = []
})

describe('queueSetupAndIssueCommands setup cwd', () => {
  it('opens the Setup tab at the workspace root when the repo has a start folder', () => {
    appState.repos = [makeRepo({ workspaceStartPath: 'services/api' })]
    const store = makeStore()

    queueSetupAndIssueCommands(
      asActivationStore(store),
      WORKTREE_ID,
      'terminal-tab',
      setup,
      undefined,
      undefined,
      undefined
    )

    expect(store.createTab).toHaveBeenCalledTimes(1)
    expect(store.createTab).toHaveBeenCalledWith(WORKTREE_ID, undefined, undefined, {
      recordInteraction: false,
      startupCwd: '/projects/mono'
    })
    expect(store.setTabCustomTitle).toHaveBeenCalledWith('setup-tab', 'Setup', {
      recordInteraction: false
    })
    expect(store.queueTabStartupCommand).toHaveBeenCalledWith(
      'setup-tab',
      expect.objectContaining({ env: setup.envVars })
    )
  })

  it('adds no startupCwd override when the repo has no start folder', () => {
    appState.repos = [makeRepo()]
    const store = makeStore()

    queueSetupAndIssueCommands(
      asActivationStore(store),
      WORKTREE_ID,
      'terminal-tab',
      setup,
      undefined,
      undefined,
      undefined
    )

    expect(store.createTab).toHaveBeenCalledTimes(1)
    expect(store.createTab).toHaveBeenCalledWith(
      WORKTREE_ID,
      undefined,
      undefined,
      expect.not.objectContaining({ startupCwd: expect.anything() })
    )
  })

  it.each(['split-horizontal', 'split-vertical'] as const)(
    'queues a %s setup split and creates no tab',
    (mode) => {
      appState.settings = { setupScriptLaunchMode: mode }
      appState.repos = [makeRepo({ workspaceStartPath: 'services/api' })]
      const store = makeStore()

      queueSetupAndIssueCommands(
        asActivationStore(store),
        WORKTREE_ID,
        'terminal-tab',
        setup,
        undefined,
        undefined,
        undefined
      )

      expect(store.createTab).not.toHaveBeenCalled()
      expect(store.queueTabStartupCommand).not.toHaveBeenCalled()
      expect(store.queueTabSetupSplit).toHaveBeenCalledWith(
        'terminal-tab',
        expect.objectContaining({
          direction: mode === 'split-horizontal' ? 'horizontal' : 'vertical',
          env: setup.envVars
        })
      )
    }
  )
})
