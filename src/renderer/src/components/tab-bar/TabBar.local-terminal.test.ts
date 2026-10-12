import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expandNode, findDropdownMenuItemByText } from './tab-bar-dropdown-menu-item-probe'
import {
  stubBrowserTab,
  stubDropdownMenu,
  stubEditorFileTab,
  stubEditorLabels,
  stubFocusTerminalTabSurface,
  stubHeadlessReact,
  stubQuickLaunchButton,
  stubShallowSelector,
  stubShellIcons,
  stubSortableContext,
  stubSortableTab,
  stubStatusDisplay,
  stubTabInsertion,
  stubTabStripDragScroll,
  stubTooltip
} from './tab-bar-windows-shell-launch-render-stubs'
import {
  appStoreSnapshot,
  resetAppStoreSnapshot,
  useAppStoreExport
} from './tab-bar-windows-shell-launch-test-harness'

vi.mock('react', async () => await stubHeadlessReact())
vi.mock('zustand/react/shallow', () => stubShallowSelector())
vi.mock('lucide-react', async () => (await import('./lucide-icon-stub-fixture')).stubEveryIcon())
vi.mock('@dnd-kit/sortable', () => stubSortableContext())
vi.mock('./tab-strip-drag-scroll', () => stubTabStripDragScroll())
vi.mock('../../store', () => ({ useAppStore: useAppStoreExport }))
vi.mock('../right-sidebar/status-display', () => stubStatusDisplay())
vi.mock('../tab-group/tab-insertion', () => stubTabInsertion())
vi.mock('@/components/editor/editor-labels', () => stubEditorLabels())
vi.mock('./SortableTab', () => stubSortableTab())
vi.mock('./EditorFileTab', () => stubEditorFileTab())
vi.mock('./BrowserTab', () => stubBrowserTab())
vi.mock('./QuickLaunchButton', () => stubQuickLaunchButton())
vi.mock('./shell-icons', () => stubShellIcons())
vi.mock('@/lib/focus-terminal-tab-surface', () => stubFocusTerminalTabSurface())
vi.mock('@/components/ui/dropdown-menu', () => stubDropdownMenu())
vi.mock('@/components/ui/tooltip', () => stubTooltip())
vi.mock('@/lib/local-terminal-for-remote-workspace', () => ({
  openLocalTerminalForRemoteWorkspace: openLocalTerminal
}))

const { openLocalTerminal } = vi.hoisted(() => ({
  openLocalTerminal: vi.fn(async (_worktreeId: string) => {})
}))

function renderComponent(candidate: unknown, props: Record<string, unknown>): unknown {
  if (typeof candidate === 'function') {
    return candidate(props)
  }
  // Why: React.memo wraps the component; the headless stub keeps the inner render on `type`.
  if (candidate && typeof candidate === 'object' && 'type' in candidate) {
    const inner = candidate.type
    if (typeof inner === 'function') {
      return inner(props)
    }
  }
  throw new Error('TabBar is not renderable')
}

async function renderTabBar(worktreeId: string) {
  const { default: TabBar } = await import('./TabBar')
  return expandNode(
    renderComponent(TabBar, {
      tabs: [],
      activeTabId: null,
      worktreeId,
      expandedPaneByTabId: {},
      onActivate: () => {},
      onClose: () => {},
      onCloseOthers: () => {},
      onCloseToRight: () => {},
      onCloseToLeft: () => {},
      onNewTerminalTab: () => {},
      onNewBrowserTab: () => {},
      onSetCustomTitle: () => {},
      onSetTabColor: () => {},
      onTogglePaneExpand: () => {}
    })
  )
}

describe('TabBar local terminal entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    resetAppStoreSnapshot()
    vi.stubGlobal('navigator', { userAgent: 'Macintosh' })
    vi.stubGlobal('window', { api: {} })
    appStoreSnapshot.repos = [
      { id: 'repo-ssh', connectionId: 'ssh-1' },
      { id: 'repo-local', connectionId: null }
    ]
    appStoreSnapshot.sshConnectionStates = new Map([['ssh-1', { remotePlatform: 'linux' }]])
    appStoreSnapshot.worktreesByRepo = {
      'repo-ssh': [{ id: 'wt-ssh', repoId: 'repo-ssh' }],
      'repo-local': [{ id: 'wt-local', repoId: 'repo-local' }]
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('offers a terminal on this computer from an SSH workspace', async () => {
    const item = findDropdownMenuItemByText(await renderTabBar('wt-ssh'), 'New Local Terminal')
    expect(item).not.toBeNull()

    const onSelect = item?.props.onSelect
    expect(typeof onSelect).toBe('function')
    if (typeof onSelect === 'function') {
      onSelect()
    }
    expect(openLocalTerminal).toHaveBeenCalledWith('wt-ssh')
  })

  it('leaves the entry out where terminals already run locally', async () => {
    const tree = await renderTabBar('wt-local')
    expect(findDropdownMenuItemByText(tree, 'New Local Terminal')).toBeNull()
    expect(findDropdownMenuItemByText(tree, 'New Terminal')).not.toBeNull()
  })
})
