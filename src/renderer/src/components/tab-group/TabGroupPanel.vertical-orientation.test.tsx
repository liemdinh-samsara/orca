// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TabBarProps } from '../tab-bar/tab-bar-props'
import TabGroupPanel from './TabGroupPanel'

const mocks = vi.hoisted(() => {
  const state = {
    sidebarOpen: true,
    rightSidebarOpen: true,
    groupsByWorktree: {
      'wt-1': [
        {
          id: 'group-1',
          worktreeId: 'wt-1',
          activeTabId: null,
          tabOrder: [],
          tabStripOrientation: 'vertical'
        }
      ]
    },
    setTabGroupStripOrientation: vi.fn()
  }
  const useAppStore = (selector: (current: typeof state) => unknown) => selector(state)
  useAppStore.getState = () => state
  return { useAppStore, closeGroup: vi.fn() }
})
vi.mock('../../store', () => ({ useAppStore: mocks.useAppStore }))
vi.mock('../tab-bar/TabBar', () => ({
  default: ({ orientation }: TabBarProps) => (
    <div data-testid="tab-bar" data-orientation={orientation} />
  )
}))
vi.mock('../tab-bar/TabBarQuickCommandsButton', () => ({ TabBarQuickCommandsButton: () => null }))
vi.mock('@/lib/pane-manager/client-hosted-browser-row-state', () => ({
  useClientHostedBrowserRows: () => []
}))
vi.mock('./useTabGroupWorkspaceModel', () => ({
  useTabGroupWorkspaceModel: () => ({
    activeTab: null,
    agentSessionItems: [],
    browserItems: [],
    editorItems: [],
    terminalTabs: [],
    groupTabs: [],
    tabBarOrder: [],
    expandedPaneByTabId: {},
    commands: { focusGroup: vi.fn(), closeGroup: mocks.closeGroup }
  })
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null
}))

function panel({
  isFocused = true,
  hasSplitGroups = true,
  tabStrip = 'attached'
}: {
  isFocused?: boolean
  hasSplitGroups?: boolean
  tabStrip?: 'attached' | 'external'
} = {}) {
  return (
    <TabGroupPanel
      groupId="group-1"
      worktreeId="wt-1"
      isVisible
      isFocused={isFocused}
      hasSplitGroups={hasSplitGroups}
      tabStrip={tabStrip}
      touchesLeftEdge
      touchesRightEdge
      reserveClosedExplorerToggleSpace={false}
      reserveCollapsedSidebarHeaderSpace={false}
    />
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TabGroupPanel strip controls', () => {
  it('renders the orientation toggle only for the focused group', () => {
    const view = render(panel())
    expect(view.getByRole('button', { name: 'Show tabs on top' })).toBeTruthy()
    view.rerender(panel({ isFocused: false }))
    expect(view.queryByRole('button', { name: /Show tabs/ })).toBeNull()
  })

  it('uses vertical layout only for an attached strip', () => {
    const view = render(panel())
    expect(view.getByTestId('tab-bar').getAttribute('data-orientation')).toBe('vertical')
    expect(
      view.container.querySelector('[data-tab-group-body-id]')?.classList.contains('ml-52')
    ).toBe(true)
    view.rerender(panel({ tabStrip: 'external' }))
    expect(view.queryByTestId('tab-bar')).toBeNull()
    expect(view.queryByRole('button', { name: /Show tabs/ })).toBeNull()
    expect(
      view.container.querySelector('[data-tab-group-body-id]')?.classList.contains('ml-52')
    ).toBe(false)
  })

  it('shows Pane Actions only for a focused split group and wires closeGroup', async () => {
    const view = render(panel({ hasSplitGroups: false }))
    expect(view.queryByRole('button', { name: 'Pane Actions' })).toBeNull()
    view.rerender(panel({ isFocused: false }))
    expect(view.queryByRole('button', { name: 'Pane Actions' })).toBeNull()
    view.rerender(panel())
    const trigger = view.getByRole('button', { name: 'Pane Actions' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    fireEvent.click(trigger)
    fireEvent.click(await view.findByRole('menuitem', { name: 'Close split pane' }))
    expect(mocks.closeGroup).toHaveBeenCalledOnce()
  })
})
