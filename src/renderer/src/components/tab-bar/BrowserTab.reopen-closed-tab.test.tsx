import type * as ReactModule from 'react'
import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { BrowserTab as BrowserTabState } from '../../../../shared/browser-workspace-types'

// Why: ReopenClosedTabMenuItem.test.tsx covers the item itself; this only checks its placement.
vi.mock('./ReopenClosedTabMenuItem', () => ({
  ReopenClosedTabMenuItem: function ReopenClosedTabMenuItem() {
    return null
  }
}))

const storeState = vi.hoisted(() => ({
  browserPagesByWorkspace: {},
  browserAudiblePageIds: {},
  browserAudioMutedTabIds: {},
  setBrowserTabAudioMuted: () => {}
}))

// Why: the shallow harness has no React dispatcher, so hooks read plain values directly.
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState }
  )
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof ReactModule>('react')
  return {
    ...actual,
    useEffect: () => {},
    useRef: <T,>(initial: T) => ({ current: initial }),
    useCallback: <T,>(fn: T) => fn,
    useSyncExternalStore: <T,>(_subscribe: unknown, getSnapshot: () => T) => getSnapshot(),
    useState: <T,>(initial: T) => [initial, () => {}] as const
  }
})

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('./use-tab-strip-slot-props', () => ({
  useTabStripSlotProps: () => ({ className: '', 'data-tab-strip-slot': '' })
}))

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: { onPointerDown: vi.fn() },
    setNodeRef: vi.fn()
  })
}))

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: function ContextMenu(props: { children?: unknown }) {
    return { type: 'ContextMenu', props }
  },
  ContextMenuContent: function ContextMenuContent(props: { children?: unknown }) {
    return { type: 'ContextMenuContent', props }
  },
  ContextMenuItem: function ContextMenuItem(props: { children?: unknown }) {
    return { type: 'ContextMenuItem', props }
  },
  ContextMenuSeparator: function ContextMenuSeparator() {
    return { type: 'ContextMenuSeparator', props: {} }
  },
  ContextMenuShortcut: function ContextMenuShortcut(props: { children?: unknown }) {
    return { type: 'ContextMenuShortcut', props }
  },
  ContextMenuTrigger: function ContextMenuTrigger(props: { children?: unknown }) {
    return { type: 'ContextMenuTrigger', props }
  }
}))

vi.mock('./TabHoverCard', () => ({
  TabHoverCard: function TabHoverCard(props: { children?: unknown }) {
    return props.children
  }
}))

vi.mock('../browser-pane/describe-page/live-browser-url-registry', () => ({
  getLiveBrowserUrl: () => null
}))

function baseBrowserTab(overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id: 'browser-1',
    worktreeId: 'wt-1',
    label: 'Browser 1',
    sessionProfileId: null,
    activePageId: 'page-1',
    pageIds: ['page-1'],
    url: 'https://example.com/',
    title: 'Example',
    loading: false,
    faviconUrl: null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    createdAt: 0,
    ...overrides
  }
}

async function renderBrowserTab(tab: BrowserTabState): Promise<unknown> {
  const module = await import('./BrowserTab')
  return module.default({
    tab,
    isActive: true,
    isPinned: false,
    hasTabsToRight: false,
    hasTabsToLeft: false,
    tabCount: 1,
    onActivate: () => {},
    onClose: () => {},
    onCloseOthers: () => {},
    onCloseToRight: () => {},
    onCloseToLeft: () => {},
    onDuplicate: () => {},
    onTogglePin: () => {},
    dragData: {
      kind: 'tab',
      worktreeId: tab.worktreeId,
      groupId: 'group-1',
      unifiedTabId: tab.id,
      visibleTabId: tab.id,
      tabType: 'browser',
      label: tab.title
    },
    dropIndicator: undefined
  })
}

type ElementLike = { type: unknown; props: { children?: unknown } & Record<string, unknown> }

function findElement(node: unknown, type: unknown): ElementLike | undefined {
  if (Array.isArray(node)) {
    return node.map((child) => findElement(child, type)).find(Boolean)
  }
  if (!isValidElement<{ children?: unknown }>(node)) {
    return undefined
  }
  if (node.type === type) {
    return { type: node.type, props: node.props }
  }
  return findElement(node.props.children, type)
}

describe('BrowserTab Reopen Closed Tab', { timeout: 30_000 }, () => {
  it('ends the context menu with Reopen Closed Tab for the browser worktree', async () => {
    const { ReopenClosedTabMenuItem } = await import('./ReopenClosedTabMenuItem')
    const { ContextMenuContent, ContextMenuSeparator } =
      await import('@/components/ui/context-menu')
    const tree = await renderBrowserTab(baseBrowserTab({ worktreeId: 'browser-wt' }))
    const content = findElement(tree, ContextMenuContent)
    const children = content?.props.children
    if (!Array.isArray(children)) {
      throw new Error('Expected browser tab menu content children')
    }

    const last = children.at(-1)
    const beforeLast = children.at(-2)
    if (!isValidElement<{ worktreeId?: string; menuKind?: string }>(last)) {
      throw new Error('Expected Reopen Closed Tab as the last menu item')
    }
    expect(last.type).toBe(ReopenClosedTabMenuItem)
    expect(last.props.worktreeId).toBe('browser-wt')
    expect(last.props.menuKind).toBe('context')
    expect(isValidElement(beforeLast) && beforeLast.type).toBe(ContextMenuSeparator)
  })
})
