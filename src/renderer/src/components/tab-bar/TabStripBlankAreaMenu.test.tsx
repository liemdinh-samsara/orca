/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TabStripBlankAreaMenu } from './TabStripBlankAreaMenu'

const storeMock = vi.hoisted(() => {
  const state: Record<string, unknown> = {}
  return { reopenClosedTab: vi.fn(() => true), state }
})

vi.mock('@/hooks/useShortcutLabel', () => ({
  useOptionalShortcutLabel: () => '⇧⌘T'
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? children : null,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => (
    <div role="menu">{children}</div>
  ),
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
  DropdownMenuShortcut: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  DropdownMenuTrigger: () => null
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

function renderStrip(): void {
  act(() => {
    root.render(
      <TabStripBlankAreaMenu worktreeId="wt-1" className="strip">
        <div data-testid="tab" onContextMenuCapture={(event) => event.preventDefault()}>
          Tab
        </div>
        <div data-testid="blank" />
      </TabStripBlankAreaMenu>
    )
  })
}

function rightClick(testId: string): void {
  act(() => {
    container
      .querySelector(`[data-testid="${testId}"]`)!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  })
}

function reopenItem(): HTMLButtonElement | null {
  return container.querySelector('[role="menuitem"]')
}

beforeEach(() => {
  storeMock.reopenClosedTab.mockClear()
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

describe('TabStripBlankAreaMenu', () => {
  it('opens Reopen Closed Tab on blank space and reopens in the strip worktree', () => {
    renderStrip()
    expect(reopenItem()).toBeNull()

    rightClick('blank')
    expect(reopenItem()?.textContent).toBe('Reopen Closed Tab⇧⌘T')
    expect(reopenItem()?.disabled).toBe(false)

    act(() => reopenItem()!.click())
    expect(storeMock.reopenClosedTab).toHaveBeenCalledWith('wt-1')
  })

  it('leaves a right-click on a tab to the tab menu', () => {
    renderStrip()
    rightClick('tab')
    expect(reopenItem()).toBeNull()
  })

  it('disables the item when nothing closed can be reopened', () => {
    storeMock.state = {
      ...storeMock.state,
      recentlyClosedBrowserTabsByWorktree: { 'wt-1': [] }
    }
    renderStrip()
    rightClick('blank')
    expect(reopenItem()?.disabled).toBe(true)
  })
})
