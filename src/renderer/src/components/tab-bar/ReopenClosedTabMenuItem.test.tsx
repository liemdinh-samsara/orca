/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOptionalShortcutLabel } from '@/hooks/useShortcutLabel'
import { showClientCreationActionError } from '@/lib/client-creation-action-error'
import english from '@/i18n/locales/en.json'
import { ReopenClosedTabMenuItem } from './ReopenClosedTabMenuItem'

const storeMock = vi.hoisted(() => {
  const state: Record<string, unknown> = {}
  return { reopenClosedTab: vi.fn(() => true), state }
})

vi.mock('@/hooks/useShortcutLabel', () => ({
  useOptionalShortcutLabel: vi.fn<() => string | null>()
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect
  }: {
    children?: ReactNode
    disabled?: boolean
    onSelect?: () => void
  }) => (
    <button type="button" role="menuitem" disabled={disabled} onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuShortcut: ({ children }: { children?: ReactNode }) => (
    <span data-testid="shortcut">{children}</span>
  )
}))

vi.mock('lucide-react', () => ({ RotateCcw: () => null }))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/lib/client-creation-action-error', () => ({
  showClientCreationActionError: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(storeMock.state),
    { getState: () => ({ ...storeMock.state, reopenClosedTab: storeMock.reopenClosedTab }) }
  )
}))

let container: HTMLDivElement
let root: Root

function renderItem(): HTMLButtonElement {
  act(() => root.render(<ReopenClosedTabMenuItem worktreeId="wt-1" />))
  const item = container.querySelector<HTMLButtonElement>('[role="menuitem"]')
  if (!item) {
    throw new Error('Missing reopen menu item')
  }
  return item
}

beforeEach(() => {
  storeMock.reopenClosedTab.mockReset().mockReturnValue(true)
  vi.mocked(showClientCreationActionError).mockClear()
  vi.mocked(useOptionalShortcutLabel).mockReset().mockReturnValue('⇧⌘T')
  storeMock.state = {
    recentlyClosedTabKindsByWorktree: { 'wt-1': ['browser'] },
    recentlyClosedBrowserTabsByWorktree: { 'wt-1': [{ workspace: {}, pages: [] }] },
    recentlyClosedEditorTabsByWorktree: {},
    recentlyClosedTerminalTabsByWorktree: {}
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ReopenClosedTabMenuItem', () => {
  it('is disabled when no snapshot can be reopened', () => {
    storeMock.state.recentlyClosedBrowserTabsByWorktree = { 'wt-1': [] }

    const item = renderItem()
    expect(item.disabled).toBe(true)
    act(() => item.click())
    expect(storeMock.reopenClosedTab).not.toHaveBeenCalled()
  })

  it('is enabled when the worktree has a snapshot', () => {
    expect(renderItem().disabled).toBe(false)
  })

  it('reopens in the item worktree on select', () => {
    const item = renderItem()

    act(() => item.click())

    expect(storeMock.reopenClosedTab).toHaveBeenCalledExactlyOnceWith('wt-1')
    expect(showClientCreationActionError).not.toHaveBeenCalled()
  })

  it('surfaces a reopen error without rethrowing', () => {
    const error = new Error('boom')
    storeMock.reopenClosedTab.mockImplementation(() => {
      throw error
    })
    const item = renderItem()

    expect(() => act(() => item.click())).not.toThrow()

    expect(storeMock.reopenClosedTab).toHaveBeenCalledWith('wt-1')
    expect(vi.mocked(showClientCreationActionError)).toHaveBeenCalledExactlyOnceWith(error)
  })

  it('renders the shortcut hint for tab.reopenClosed when bound', () => {
    renderItem()

    expect(useOptionalShortcutLabel).toHaveBeenCalledWith('tab.reopenClosed')
    expect(container.querySelector('[data-testid="shortcut"]')?.textContent).toBe('⇧⌘T')
  })

  it('omits the shortcut hint when unbound', () => {
    vi.mocked(useOptionalShortcutLabel).mockReturnValue(null)

    expect(renderItem().textContent).toBe('Reopen Closed Tab')
    expect(container.querySelector('[data-testid="shortcut"]')).toBeNull()
  })

  it('has the Reopen Closed Tab label in the English locale', () => {
    expect(english.components.tab.bar.ReopenClosedTabMenuItem.label).toBe('Reopen Closed Tab')
  })
})
