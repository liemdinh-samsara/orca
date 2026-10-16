import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  resolveGuestSideButtonDirection,
  setupGuestSideButtonNavigation
} from './browser-guest-side-button-navigation'

type SetupArgs = Parameters<typeof setupGuestSideButtonNavigation>[0]
type Listener = Parameters<SetupArgs['guest']['on']>[1]
type Send = (channel: string, ...args: unknown[]) => void
type Renderer = { send: Mock<Send> }

function rendererMock(): Renderer {
  return { send: vi.fn<Send>() }
}

function setup(
  renderer: Renderer | null = rendererMock(),
  resolveRenderer: SetupArgs['resolveRenderer'] = () => renderer
) {
  const listeners: Listener[] = []
  const guest = {
    on: vi.fn((_event: 'before-mouse-event', listener: Listener) => listeners.push(listener)),
    off: vi.fn()
  }
  const cleanup = setupGuestSideButtonNavigation({
    browserTabId: 'page-1',
    guest,
    resolveRenderer
  })
  const press = (type: string, button: string): ReturnType<typeof vi.fn> => {
    const preventDefault = vi.fn()
    for (const listener of listeners) {
      listener({ preventDefault }, { type, button })
    }
    return preventDefault
  }
  return { guest, cleanup, press, listeners }
}

describe('resolveGuestSideButtonDirection', () => {
  it('maps side-button presses and releases to a history direction', () => {
    expect(resolveGuestSideButtonDirection({ type: 'mouseUp', button: 'back' })).toBe('back')
    expect(resolveGuestSideButtonDirection({ type: 'mouseDown', button: 'forward' })).toBe(
      'forward'
    )
  })

  it('ignores the main buttons and non-click mouse events', () => {
    expect(resolveGuestSideButtonDirection({ type: 'mouseUp', button: 'left' })).toBeNull()
    expect(resolveGuestSideButtonDirection({ type: 'mouseUp', button: 'middle' })).toBeNull()
    expect(resolveGuestSideButtonDirection({ type: 'mouseMove', button: 'back' })).toBeNull()
    expect(resolveGuestSideButtonDirection({ type: 'mouseUp' })).toBeNull()
  })
})

describe('setupGuestSideButtonNavigation', () => {
  it('navigates the page once, on release, through the history command', () => {
    const renderer = rendererMock()
    const { press } = setup(renderer)

    expect(press('mouseDown', 'back')).toHaveBeenCalledTimes(1)
    expect(renderer.send).not.toHaveBeenCalled()
    expect(press('mouseUp', 'back')).toHaveBeenCalledTimes(1)
    expect(renderer.send).toHaveBeenCalledWith('ui:browserHistoryNavigate', {
      browserPageId: 'page-1',
      direction: 'back'
    })

    press('mouseUp', 'forward')
    expect(renderer.send).toHaveBeenLastCalledWith('ui:browserHistoryNavigate', {
      browserPageId: 'page-1',
      direction: 'forward'
    })
    expect(renderer.send).toHaveBeenCalledTimes(2)
  })

  it('leaves ordinary clicks to the page', () => {
    const renderer = rendererMock()
    const { press } = setup(renderer)

    expect(press('mouseDown', 'left')).not.toHaveBeenCalled()
    expect(press('mouseUp', 'left')).not.toHaveBeenCalled()
    expect(renderer.send).not.toHaveBeenCalled()
  })

  it('still swallows the click when the renderer is gone', () => {
    const { press } = setup(null)

    expect(press('mouseUp', 'back')).toHaveBeenCalledTimes(1)
  })

  it('removes its listener on cleanup', () => {
    const { guest, cleanup, listeners } = setup()

    cleanup()

    expect(guest.off).toHaveBeenCalledWith('before-mouse-event', listeners[0])
  })

  it('resolves the current renderer on every side-button release', () => {
    const firstRenderer = rendererMock()
    const secondRenderer = rendererMock()
    const resolveRenderer = vi
      .fn<SetupArgs['resolveRenderer']>()
      .mockReturnValueOnce(firstRenderer)
      .mockReturnValue(secondRenderer)
    const { press } = setup(null, resolveRenderer)

    expect(resolveRenderer).not.toHaveBeenCalled()
    press('mouseUp', 'back')
    expect(firstRenderer.send).toHaveBeenCalledExactlyOnceWith('ui:browserHistoryNavigate', {
      browserPageId: 'page-1',
      direction: 'back'
    })
    expect(secondRenderer.send).not.toHaveBeenCalled()

    press('mouseUp', 'forward')
    expect(resolveRenderer).toHaveBeenCalledTimes(2)
    expect(resolveRenderer).toHaveBeenNthCalledWith(1, 'page-1')
    expect(resolveRenderer).toHaveBeenNthCalledWith(2, 'page-1')
    expect(firstRenderer.send).toHaveBeenCalledTimes(1)
    expect(secondRenderer.send).toHaveBeenCalledExactlyOnceWith('ui:browserHistoryNavigate', {
      browserPageId: 'page-1',
      direction: 'forward'
    })
  })

  it('does not throw during cleanup when a destroyed guest rejects listener removal', () => {
    const { guest, cleanup, listeners } = setup()
    guest.off.mockImplementation(() => {
      throw new Error('destroyed')
    })

    expect(cleanup).not.toThrow()
    expect(guest.off).toHaveBeenCalledExactlyOnceWith('before-mouse-event', listeners[0])
  })
})
