export type SideButtonDirection = 'back' | 'forward'

// Why structural: Electron's typings list only left/middle/right, but it reports 'back'/'forward' too.
type GuestMouseInput = { type: string; button?: string }
type GuestMouseListener = (event: { preventDefault: () => void }, mouse: GuestMouseInput) => void
type GuestMouseSource = {
  on: (event: 'before-mouse-event', listener: GuestMouseListener) => unknown
  off: (event: 'before-mouse-event', listener: GuestMouseListener) => unknown
}
type HistoryNavigateRenderer = { send: (channel: string, ...args: unknown[]) => void }

export function resolveGuestSideButtonDirection(
  mouse: GuestMouseInput
): SideButtonDirection | null {
  if (mouse.type !== 'mouseDown' && mouse.type !== 'mouseUp') {
    return null
  }
  return mouse.button === 'back' || mouse.button === 'forward' ? mouse.button : null
}

// Why: a webview guest receives side-button clicks but never navigates on them, unlike a top-level window.
export function setupGuestSideButtonNavigation(args: {
  browserTabId: string
  guest: GuestMouseSource
  resolveRenderer: (browserTabId: string) => HistoryNavigateRenderer | null
}): () => void {
  const { browserTabId, guest, resolveRenderer } = args
  const handler: GuestMouseListener = (event, mouse) => {
    const direction = resolveGuestSideButtonDirection(mouse)
    if (!direction) {
      return
    }
    // Why: consume press and release so a guest that starts handling them itself can't navigate twice.
    event.preventDefault()
    if (mouse.type === 'mouseUp') {
      resolveRenderer(browserTabId)?.send('ui:browserHistoryNavigate', {
        browserPageId: browserTabId,
        direction
      })
    }
  }

  guest.on('before-mouse-event', handler)
  return () => {
    try {
      guest.off('before-mouse-event', handler)
    } catch {
      // Why: best-effort — guest may already be destroyed during teardown.
    }
  }
}
