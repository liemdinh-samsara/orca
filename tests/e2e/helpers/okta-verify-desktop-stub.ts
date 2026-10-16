import { createServer, type Server } from 'node:http'
import type { Page } from '@stablyai/playwright-test'
import { OKTA_VERIFY_LOOPBACK_PORTS } from '../../../src/main/browser/browser-route-session-policy'

/** Stands in for Okta Verify on a free one of its loopback ports, on the desktop itself. */
export async function startDesktopAuthenticatorStub(): Promise<{ server: Server; port: number }> {
  // Why reversed: 8769 is the real Okta Verify's default port on a developer's machine.
  for (const port of OKTA_VERIFY_LOOPBACK_PORTS.toReversed()) {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'access-control-allow-origin': '*', 'cache-control': 'no-store' })
      response.end('desktop-authenticator')
    })
    const bound = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => resolve(true))
    })
    if (bound) {
      return { server, port }
    }
  }
  throw new Error('every Okta Verify loopback port is taken on this desktop')
}

/** Fetches from inside one tab's guest: the body, `opaque` for no-cors, or the failure. */
export async function fetchFromTab(
  page: Page,
  tabId: string,
  url: string,
  mode: 'cors' | 'no-cors' = 'cors'
): Promise<string> {
  const script = `fetch(${JSON.stringify(url)}, { mode: ${JSON.stringify(mode)}, cache: 'no-store' })
    .then((r) => (r.type === 'opaque' ? 'opaque' : r.text()), (e) => 'failed: ' + e.message)`
  return page
    .locator(`[data-browser-overlay-tab-id="${tabId}"] webview`)
    .evaluate<string, string, Electron.WebviewTag>(
      (node, code) => node.executeJavaScript(code),
      script
    )
}
