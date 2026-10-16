import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  BROWSER_MARKDOWN_VIEWER_WORLD_ID,
  installGuestMarkdownViewer
} from './browser-guest-markdown-viewer'

type Execute = (
  worldId: number,
  scripts: { code: string }[],
  userGesture?: boolean
) => Promise<unknown>

function createGuest(url: string): {
  guest: Parameters<typeof installGuestMarkdownViewer>[0]
  execute: Mock<Execute>
  fireDomReady: () => void
  setDestroyed: (value: boolean) => void
  setUrl: (value: string) => void
  off: Mock
} {
  const listeners: (() => void)[] = []
  let destroyed = false
  let currentUrl = url
  const execute = vi.fn<Execute>().mockResolvedValue('rendered')
  const off = vi.fn()
  return {
    guest: {
      getURL: () => currentUrl,
      isDestroyed: () => destroyed,
      on: (_event, listener) => listeners.push(listener),
      off,
      executeJavaScriptInIsolatedWorld: execute
    },
    execute,
    fireDomReady: () => listeners.forEach((listener) => listener()),
    setDestroyed: (value) => {
      destroyed = value
    },
    setUrl: (value) => {
      currentUrl = value
    },
    off
  }
}

const loadScript = (): Promise<string> => Promise.resolve('var OrcaGuestScript = {}')
const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('installGuestMarkdownViewer', () => {
  it('injects the renderer and mounts it with labels when a markdown file loads', async () => {
    const { guest, execute, fireDomReady } = createGuest('file:///notes/README.md')
    installGuestMarkdownViewer(guest, loadScript)

    fireDomReady()
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(execute).toHaveBeenCalledWith(
      BROWSER_MARKDOWN_VIEWER_WORLD_ID,
      [
        { code: 'var OrcaGuestScript = {}' },
        {
          code: 'OrcaGuestScript.mount({"showSource":"Show source","showRendered":"Show rendered"})'
        }
      ],
      false
    )
  })

  it('never loads the renderer for other pages', async () => {
    const { guest, execute, fireDomReady } = createGuest('https://example.com/docs')
    const load = vi.fn(loadScript)
    installGuestMarkdownViewer(guest, load)

    fireDomReady()
    await Promise.resolve()
    expect(load).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('skips a guest destroyed while the renderer was loading', async () => {
    const { guest, execute, fireDomReady, setDestroyed } = createGuest('https://x.dev/a.md')
    let finishLoading: (script: string) => void = () => {}
    installGuestMarkdownViewer(
      guest,
      () => new Promise<string>((resolve) => (finishLoading = resolve))
    )

    fireDomReady()
    setDestroyed(true)
    finishLoading('script')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(execute).not.toHaveBeenCalled()
  })

  it('swallows a failed injection and removes its listener on cleanup', async () => {
    const { guest, execute, fireDomReady, off } = createGuest('https://x.dev/a.md')
    execute.mockRejectedValue(new Error('navigated away'))
    const dispose = installGuestMarkdownViewer(guest, loadScript)

    fireDomReady()
    await vi.waitFor(() => expect(execute).toHaveBeenCalled())
    dispose()
    expect(off).toHaveBeenCalledWith('dom-ready', expect.any(Function))
  })

  it('does nothing when the guest is already destroyed at dom-ready', async () => {
    const { guest, execute, fireDomReady, setDestroyed } = createGuest('https://x.dev/a.md')
    const load = vi.fn(loadScript)
    installGuestMarkdownViewer(guest, load)

    setDestroyed(true)
    fireDomReady()
    await flushPromises()
    expect(load).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('re-checks the address on every dom-ready, so a later non-markdown page gets nothing', async () => {
    const { guest, execute, fireDomReady, setUrl } = createGuest('https://x.dev/a.md')
    const load = vi.fn(loadScript)
    installGuestMarkdownViewer(guest, load)

    fireDomReady()
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))

    setUrl('https://x.dev/app')
    fireDomReady()
    await flushPromises()
    expect(load).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)

    setUrl('https://x.dev/b.md')
    fireDomReady()
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('swallows a renderer that fails to load without injecting anything', async () => {
    const { guest, execute, fireDomReady } = createGuest('https://x.dev/a.md')
    const load = vi.fn(() => Promise.reject(new Error('chunk missing')))
    installGuestMarkdownViewer(guest, load)

    // An unhandled rejection here fails the whole vitest run, so reaching the asserts proves it.
    fireDomReady()
    await flushPromises()
    expect(load).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not throw from cleanup when the guest is already gone', () => {
    const { guest, off } = createGuest('https://x.dev/a.md')
    off.mockImplementation(() => {
      throw new Error('Object has been destroyed')
    })
    const dispose = installGuestMarkdownViewer(guest, loadScript)

    expect(() => dispose()).not.toThrow()
    expect(off).toHaveBeenCalledWith('dom-ready', expect.any(Function))
  })
})
