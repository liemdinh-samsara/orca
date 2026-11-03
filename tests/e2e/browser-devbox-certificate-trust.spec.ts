/**
 * Samsara devboxes serve dev servers on their own hostnames with self-signed localhost
 * certificates; the warning must offer "Proceed Anyway" there, not only on localhost.
 */

import type { Page } from '@stablyai/playwright-test'

import { expect, test } from './helpers/orca-app'
import {
  ensureTerminalVisible,
  getActiveWorktreeId,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { startLocalHttpsServer } from './helpers/local-https-test-server'

const DEVBOX_HOST = 'orca-e2e.3.us-west-2.devbox.internal.samsara.com'

test.use({ orcaAppExtraArgs: [`--host-resolver-rules=MAP ${DEVBOX_HOST} 127.0.0.1`] })

async function readGuestValue(page: Page, browserTabId: string, expression: string) {
  return page.evaluate(
    async ({ targetBrowserTabId, targetExpression }) => {
      const webview = document.querySelector<Electron.WebviewTag>(
        `[data-browser-overlay-tab-id="${targetBrowserTabId}"] webview`
      )
      try {
        return webview ? await webview.executeJavaScript(targetExpression) : null
      } catch {
        return null
      }
    },
    { targetBrowserTabId: browserTabId, targetExpression: expression }
  )
}

test('proceeds past a self-signed certificate on a devbox host', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  const server = await startLocalHttpsServer({ hostname: DEVBOX_HOST })
  try {
    const worktreeId = (await getActiveWorktreeId(orcaPage))!
    const browserTabId = await orcaPage.evaluate(
      ({ targetWorktreeId, targetUrl }) =>
        window
          .__store!.getState()
          .createBrowserTab(targetWorktreeId, targetUrl, { title: 'Devbox', activate: true }).id,
      { targetWorktreeId: worktreeId, targetUrl: server.secureUrl }
    )
    const slot = orcaPage.locator(`[data-browser-overlay-tab-id="${browserTabId}"]`)

    await expect(slot.getByRole('heading', { name: "Connection isn't secure" })).toBeVisible()
    await expect(slot.getByText(/doesn't trust the authority/)).toContainText(DEVBOX_HOST)
    await slot.getByRole('button', { name: 'Proceed Anyway (Unsafe)' }).click()

    await expect
      .poll(
        () => readGuestValue(orcaPage, browserTabId, 'document.querySelector("h1")?.textContent'),
        {
          timeout: 10_000
        }
      )
      .toBe('Local HTTPS request 1')
    await expect
      .poll(() => readGuestValue(orcaPage, browserTabId, 'window.__localTlsState ?? null'))
      .toEqual({ asset: true, webSocket: true })
    await expect(slot.getByRole('heading', { name: "Connection isn't secure" })).toHaveCount(0)
  } finally {
    await server.close()
  }
})
