import { resolveRendererWebContents } from './browser-guest-renderer-target'
import { setupGuestContextMenu } from './browser-guest-context-menu'
import { setupGrabShortcutForwarding } from './browser-guest-grab-shortcuts'
import { setupGuestMouseWheelZoomForwarding } from './browser-guest-wheel-zoom'
import { setupGuestShortcutForwarding } from './browser-guest-shortcut-forwarding'
import { setupGuestSideButtonNavigation } from './browser-guest-side-button-navigation'
import { BrowserManagerGrab } from './browser-manager-grab'

export abstract class BrowserManagerBindings extends BrowserManagerGrab {
  protected setupContextMenu(browserTabId: string, guest: Electron.WebContents): void {
    this.contextMenuCleanupByTabId.set(
      browserTabId,
      setupGuestContextMenu({
        browserTabId,
        guest,
        resolveRenderer: (tabId) => this.resolveRendererForBrowserTab(tabId)
      })
    )
  }

  // Why: forward grab's Cmd/Ctrl+C from a focused guest only when no edit field/selection is active, so native copy still works.
  protected setupGrabShortcut(browserTabId: string, guest: Electron.WebContents): void {
    const previousCleanup = this.grabShortcutCleanupByTabId.get(browserTabId)
    if (previousCleanup) {
      previousCleanup()
      this.grabShortcutCleanupByTabId.delete(browserTabId)
    }

    this.grabShortcutCleanupByTabId.set(
      browserTabId,
      setupGrabShortcutForwarding({
        browserTabId,
        guest,
        resolveRenderer: (tabId) =>
          resolveRendererWebContents(this.rendererWebContentsIdByTabId, tabId),
        hasActiveGrabOp: (tabId) => this.hasActiveGrabOp(tabId),
        getKeybindings: () => this.settingsResolver?.().keybindings
      })
    )
  }

  // Why: a focused webview guest is a separate process, so its key events never reach the renderer; intercept and forward app shortcuts.
  protected setupShortcutForwarding(browserTabId: string, guest: Electron.WebContents): void {
    const previousCleanup = this.shortcutForwardingCleanupByTabId.get(browserTabId)
    if (previousCleanup) {
      previousCleanup()
      this.shortcutForwardingCleanupByTabId.delete(browserTabId)
    }

    const resolveRenderer = (tabId: string): Electron.WebContents | null =>
      resolveRendererWebContents(this.rendererWebContentsIdByTabId, tabId)
    const removeShortcutForwarding = setupGuestShortcutForwarding({
      browserTabId,
      guest,
      resolveRenderer,
      shouldForwardDictationShortcut: () => this.shouldForwardDictationShortcut?.() ?? false,
      isMobileEmulatorEnabled: () => this.settingsResolver?.().mobileEmulatorEnabled !== false,
      getKeybindings: () => this.settingsResolver?.().keybindings,
      resolveWorktreeId: (tabId) => this.worktreeIdByTabId.get(tabId) ?? null,
      resolveWorkspaceId: (tabId) => this.workspaceIdByPageId.get(tabId) ?? null
    })
    // Why: mouse side buttons are the pointer form of the browser.back/forward chords forwarded above.
    const removeSideButtonNavigation = setupGuestSideButtonNavigation({
      browserTabId,
      guest,
      resolveRenderer
    })
    this.shortcutForwardingCleanupByTabId.set(browserTabId, () => {
      removeShortcutForwarding()
      removeSideButtonNavigation()
    })
  }

  protected setupMouseWheelZoomForwarding(browserTabId: string, guest: Electron.WebContents): void {
    const previousCleanup = this.mouseWheelZoomCleanupByTabId.get(browserTabId)
    if (previousCleanup) {
      previousCleanup()
      this.mouseWheelZoomCleanupByTabId.delete(browserTabId)
    }

    this.mouseWheelZoomCleanupByTabId.set(
      browserTabId,
      setupGuestMouseWheelZoomForwarding({
        browserTabId,
        guest,
        resolveRenderer: (tabId) =>
          resolveRendererWebContents(this.rendererWebContentsIdByTabId, tabId),
        isViewportPresetActive: () => {
          const state = this.viewportPresetByTabId.get(browserTabId)
          return state?.guestWebContentsId === guest.id && state.requested !== null
        },
        canViewportScroll: (mouse) => this.canViewportScroll(browserTabId, mouse),
        onViewportWheelConsumed: (deltaX, deltaY) =>
          this.recordViewportScrollDelta(browserTabId, deltaX, deltaY)
      })
    )
  }
}
