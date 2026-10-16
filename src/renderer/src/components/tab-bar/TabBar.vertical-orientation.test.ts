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
vi.mock('./SortableTab', () => ({
  default: (props: Record<string, unknown>) => ({ type: 'TerminalRow', props })
}))
vi.mock('./EditorFileTab', () => stubEditorFileTab())
vi.mock('./BrowserTab', () => stubBrowserTab())
vi.mock('./QuickLaunchButton', () => stubQuickLaunchButton())
vi.mock('./shell-icons', () => stubShellIcons())
vi.mock('@/lib/focus-terminal-tab-surface', () => stubFocusTerminalTabSurface())
vi.mock('@/components/ui/dropdown-menu', () => stubDropdownMenu())
vi.mock('@/components/ui/tooltip', () => stubTooltip())
// The headless React stub has no dispatcher for useTranslation's language subscription.
vi.mock('react-i18next', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('react-i18next')),
  useTranslation: () => ({})
}))
vi.mock('@/runtime/structured-conversation-name', () => ({
  useStructuredChatTabConversationName: () => null
}))
vi.mock('./ReopenClosedTabMenuItem', () => ({ ReopenClosedTabMenuItem: () => null }))
vi.mock('./ClientHostedBrowserTabRows', () => ({
  default: (props: Record<string, unknown>) => ({ type: 'ClientHostedRows', props })
}))
vi.mock('./tab-strip-overflow-navigation', () => ({
  useTabStripOverflowNavigation: () => ({
    tabStripRef: { current: null },
    tabStripOverflowState: { hasOverflow: true, canScrollStart: true, canScrollEnd: true },
    activeTabDockSide: null,
    scrollTabStrip: vi.fn(),
    subscribeToStripResize: vi.fn()
  })
}))

import type { TabBarProps } from './tab-bar-props'

type Node = { type: unknown; props: Record<string, unknown> }

function isNode(node: unknown): node is Node {
  return typeof node === 'object' && node !== null && 'type' in node && 'props' in node
}

function findNodes(node: unknown, predicate: (node: Node) => boolean): Node[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => findNodes(child, predicate))
  }
  if (!isNode(node)) {
    return []
  }
  return [...(predicate(node) ? [node] : []), ...findNodes(node.props.children, predicate)]
}

function renderComponent(candidate: unknown, props: TabBarProps): unknown {
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

const onNewTerminalTab = vi.fn()
const terminal = {
  id: 'terminal-1',
  ptyId: null,
  worktreeId: 'wt-local',
  title: 'Terminal',
  customTitle: null,
  color: null,
  sortOrder: 0,
  createdAt: 0
}
const browserRow = {
  browserPageId: 'page-1',
  worktreeId: 'wt-local',
  url: 'https://example.com',
  title: 'Client page',
  loading: false,
  browserHostClientId: 'client-1',
  hostDeviceName: 'Laptop',
  hostAbsent: false
}

async function renderTabBar(overrides: Partial<TabBarProps> = {}) {
  const { default: TabBar } = await import('./TabBar')
  return expandNode(
    renderComponent(TabBar, {
      tabs: [terminal],
      activeTabId: terminal.id,
      worktreeId: 'wt-local',
      groupId: 'group-1',
      expandedPaneByTabId: {},
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onCloseOthers: vi.fn(),
      onCloseToRight: vi.fn(),
      onCloseToLeft: vi.fn(),
      onNewTerminalTab,
      onNewBrowserTab: vi.fn(),
      onSetCustomTitle: vi.fn(),
      onSetTabColor: vi.fn(),
      onTogglePaneExpand: vi.fn(),
      ...overrides
    })
  )
}

const hasClass = (name: string) => (node: Node) =>
  typeof node.props.className === 'string' && node.props.className.split(' ').includes(name)
const hasLabel = (label: string) => (node: Node) => node.props['aria-label'] === label

describe('TabBar strip orientation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    resetAppStoreSnapshot()
    vi.stubGlobal('navigator', { userAgent: 'Macintosh' })
    vi.stubGlobal('window', { api: {} })
    appStoreSnapshot.repos = [{ id: 'repo-local', connectionId: null }]
    appStoreSnapshot.worktreesByRepo = { 'repo-local': [{ id: 'wt-local', repoId: 'repo-local' }] }
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each(['vertical', 'horizontal'] as const)(
    'uses the shared create menu in %s orientation',
    async (orientation) => {
      const tree = await renderTabBar({ orientation })
      const buttons = findNodes(tree, hasLabel('New tab'))
      expect(buttons).toHaveLength(1)
      if (orientation === 'vertical') {
        expect(buttons[0].props.className).toContain('w-full')
        expect(buttons[0].props.children).toContain('New tab')
      }
      const menu = findNodes(
        tree,
        (node) =>
          node.type === 'DropdownMenu' &&
          findNodes(node.props.children, hasLabel('New tab')).length > 0
      )
      expect(menu).toHaveLength(1)
      const item = findDropdownMenuItemByText(menu[0], 'New Terminal')
      expect(item).not.toBeNull()
      const select = item?.props.onSelect
      if (typeof select !== 'function') {
        throw new Error('Missing create action')
      }
      select()
      expect(onNewTerminalTab).toHaveBeenCalledOnce()
    }
  )

  it('wraps rows in a vertical list and omits horizontal overflow controls even when overflowing', async () => {
    const tree = await renderTabBar({ orientation: 'vertical' })
    const strips = findNodes(tree, hasClass('vertical-tab-strip'))
    expect(strips).toHaveLength(1)
    expect(findNodes(strips[0], (node) => node.type === 'TerminalRow')).toHaveLength(1)
    expect(findNodes(tree, hasClass('terminal-tab-strip'))).toHaveLength(0)
    expect(findNodes(tree, hasLabel('Scroll tabs left'))).toHaveLength(0)
    expect(findNodes(tree, hasLabel('Scroll tabs right'))).toHaveLength(0)
  })

  it('defaults to a horizontal strip with overflow controls', async () => {
    const tree = await renderTabBar()
    expect(findNodes(tree, hasClass('terminal-tab-strip'))).toHaveLength(1)
    expect(findNodes(tree, hasClass('vertical-tab-strip'))).toHaveLength(0)
    expect(findNodes(tree, hasLabel('Scroll tabs left'))).toHaveLength(1)
    expect(findNodes(tree, hasLabel('Scroll tabs right'))).toHaveLength(1)
  })

  it('appends client-hosted browser rows inside the vertical list after real tabs', async () => {
    const tree = await renderTabBar({
      orientation: 'vertical',
      clientHostedBrowserRows: [browserRow]
    })
    const strip = findNodes(tree, hasClass('vertical-tab-strip'))[0]
    const rows = findNodes(
      strip,
      (node) => node.type === 'TerminalRow' || node.type === 'ClientHostedRows'
    )
    expect(rows.map((row) => row.type)).toEqual(['TerminalRow', 'ClientHostedRows'])
    expect(rows[1].props).toMatchObject({
      rows: [browserRow],
      worktreeId: 'wt-local',
      groupId: 'group-1',
      includeTopTabBorder: false
    })
  })

  it.each([undefined, 'horizontal', 'vertical'] as const)(
    'forwards %s orientation to row drag data only when vertical',
    async (orientation) => {
      const tree = await renderTabBar({ orientation })
      const rows = findNodes(tree, (node) => node.type === 'TerminalRow')
      expect(rows).toHaveLength(1)
      expect(rows[0].props.dragData).toMatchObject({
        kind: 'tab',
        worktreeId: 'wt-local',
        groupId: 'group-1',
        visibleTabId: terminal.id
      })
      if (orientation === 'vertical') {
        expect(rows[0].props.dragData).toHaveProperty('stripOrientation', 'vertical')
      } else {
        expect(rows[0].props.dragData).not.toHaveProperty('stripOrientation')
      }
    }
  )
})
