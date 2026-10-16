// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabGroupPaneActionsMenu } from './TabGroupPaneActionsMenu'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null
}))

afterEach(cleanup)

describe('TabGroupPaneActionsMenu', () => {
  it('opens Pane Actions and closes the split pane once on selection', async () => {
    const onClosePane = vi.fn()
    const bubble = vi.fn()
    const view = render(
      <div onClick={bubble}>
        <TabGroupPaneActionsMenu className="" onClosePane={onClosePane} />
      </div>
    )
    const trigger = view.getByRole('button', { name: 'Pane Actions' })
    expect(view.queryByRole('menuitem', { name: 'Close split pane' })).toBeNull()
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    fireEvent.click(trigger)
    // Why: the trigger lives in the pane header, whose own click handler must not fire.
    expect(bubble).not.toHaveBeenCalled()
    fireEvent.click(await view.findByRole('menuitem', { name: 'Close split pane' }))
    expect(onClosePane).toHaveBeenCalledOnce()
  })
})
