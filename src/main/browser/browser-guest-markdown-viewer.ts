import { GUEST_SCRIPT_GLOBAL_NAME } from '../../shared/guest-script-bundle'
import { translateMain } from '../i18n/main-i18n'
import { isMarkdownDocumentUrl } from './markdown-viewer/markdown-document-path'
import type { MarkdownViewerLabels } from './markdown-viewer/markdown-viewer-mount'

export const BROWSER_MARKDOWN_VIEWER_WORLD_ID = 1209

type MarkdownViewerGuest = {
  getURL: () => string
  isDestroyed: () => boolean
  on: (event: 'dom-ready', listener: () => void) => unknown
  off: (event: 'dom-ready', listener: () => void) => unknown
  executeJavaScriptInIsolatedWorld: (
    worldId: number,
    scripts: { code: string }[],
    userGesture?: boolean
  ) => Promise<unknown>
}

// Why lazy: the bundled renderer is large and only markdown pages ever need it.
async function loadMarkdownViewerScript(): Promise<string> {
  const bundle = await import('./markdown-viewer/markdown-viewer-guest-entry.ts?guest-script')
  return bundle.default
}

function markdownViewerLabels(): MarkdownViewerLabels {
  return {
    showSource: translateMain('auto.main.browser.markdownViewer.showSource', 'Show source'),
    showRendered: translateMain('auto.main.browser.markdownViewer.showRendered', 'Show rendered')
  }
}

/**
 * Renders a markdown file a browser tab shows as plain text, the way a Chrome markdown-viewer
 * extension does: in the page itself, so history, find, zoom and links keep working.
 */
export function installGuestMarkdownViewer(
  guest: MarkdownViewerGuest,
  loadScript: () => Promise<string> = loadMarkdownViewerScript
): () => void {
  const handleDomReady = (): void => {
    if (guest.isDestroyed() || !isMarkdownDocumentUrl(guest.getURL())) {
      return
    }
    void loadScript()
      .then((script) => {
        if (guest.isDestroyed()) {
          return undefined
        }
        // Why an isolated world: the page can't tamper with the renderer, and the guest re-checks
        // that the document is still a markdown text view, so a navigation in between is harmless.
        const mountCall = `${GUEST_SCRIPT_GLOBAL_NAME}.mount(${JSON.stringify(markdownViewerLabels())})`
        return guest.executeJavaScriptInIsolatedWorld(
          BROWSER_MARKDOWN_VIEWER_WORLD_ID,
          [{ code: script }, { code: mountCall }],
          false
        )
      })
      .catch(() => {})
  }
  guest.on('dom-ready', handleDomReady)
  return () => {
    try {
      guest.off('dom-ready', handleDomReady)
    } catch {
      // Why: best-effort — guest may already be destroyed during teardown.
    }
  }
}
