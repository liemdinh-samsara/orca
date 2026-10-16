// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabStripOrientationToggle } from './TabStripOrientationToggle'

const mocks = vi.hoisted(() => ({ setTabGroupStripOrientation: vi.fn() }))
vi.mock('../../store', () => ({
  useAppStore: (selector: (state: typeof mocks) => unknown) => selector(mocks)
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TabStripOrientationToggle', () => {
  it.each([
    { isVertical: false, label: 'Show tabs on the side', next: 'vertical' },
    { isVertical: true, label: 'Show tabs on top', next: 'horizontal' }
  ])('shows $label and sets $next', ({ isVertical, label, next }) => {
    const view = render(
      <TabStripOrientationToggle
        worktreeId="wt-1"
        groupId="group-1"
        isVertical={isVertical}
        className=""
      />
    )
    const button = view.getByRole('button', { name: label })
    expect(button.getAttribute('aria-pressed')).toBe(String(isVertical))
    fireEvent.click(button)
    expect(mocks.setTabGroupStripOrientation).toHaveBeenCalledExactlyOnceWith(
      'wt-1',
      'group-1',
      next
    )
  })

  it('stops clicks from bubbling to the pane', () => {
    const bubble = vi.fn()
    const view = render(
      <div onClick={bubble}>
        <TabStripOrientationToggle
          worktreeId="wt-1"
          groupId="group-1"
          isVertical={false}
          className=""
        />
      </div>
    )
    fireEvent.click(view.getByRole('button'))
    expect(mocks.setTabGroupStripOrientation).toHaveBeenCalledOnce()
    expect(bubble).not.toHaveBeenCalled()
  })
})
