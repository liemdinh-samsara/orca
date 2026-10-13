/**
 * Mouse side buttons (back/forward) over a browser page walk that page's history, as in Chrome.
 * A webview guest receives the clicks but never navigates on them by itself.
 */

import { createServer, type Server } from 'node:http'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { guestUrl, navigateGuest, waitForGuestUrl } from './helpers/browser-split-guest-probes'

async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const name = request.url === '/b' ? 'B' : 'A'
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>Page ${name}</title><body style="height:100vh">${name}`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Side-button probe server did not bind a TCP port')
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  }
}

// Why CDP: Playwright's mouse API only knows left/middle/right.
async function clickSideButton(
  page: Page,
  browserTabId: string,
  button: 'back' | 'forward'
): Promise<void> {
  const box = await page
    .locator(`[data-browser-overlay-tab-id="${browserTabId}"] webview`)
    .boundingBox()
  if (!box) {
    throw new Error('The browser page has no visible webview')
  }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const buttons = button === 'back' ? 8 : 16
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      buttons,
      clickCount: 1
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      buttons: 0,
      clickCount: 1
    })
  } finally {
    await cdp.detach()
  }
}

test('mouse side buttons go back and forward in a browser tab', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  const server = await startServer()
  try {
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    const pageA = `${server.url}/a`
    const pageB = `${server.url}/b`
    const tabId = await orcaPage.evaluate(
      ({ targetWorktreeId, url }) =>
        window.__store
          ?.getState()
          .createBrowserTab(targetWorktreeId, url, { title: 'Page A', activate: true })?.id ?? null,
      { targetWorktreeId: worktreeId, url: pageA }
    )
    if (!tabId) {
      throw new Error('Failed to create the browser tab')
    }
    await waitForGuestUrl(orcaPage, tabId, pageA)
    await navigateGuest(orcaPage, tabId, pageB)

    await clickSideButton(orcaPage, tabId, 'back')
    await expect.poll(() => guestUrl(orcaPage, tabId), { timeout: 10_000 }).toBe(pageA)

    await clickSideButton(orcaPage, tabId, 'forward')
    await expect.poll(() => guestUrl(orcaPage, tabId), { timeout: 10_000 }).toBe(pageB)
  } finally {
    await server.close()
  }
})
