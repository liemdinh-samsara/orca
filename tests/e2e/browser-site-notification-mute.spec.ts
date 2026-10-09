import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const SLACK_URL = 'https://app.slack.com/client'
const CONTROL_URL = 'https://notify.example.test/'

async function readNotificationPermission(
  page: Page,
  worktreeId: string,
  url: string
): Promise<{ current: string; requested: string }> {
  const tabId = await page.evaluate(
    ({ worktreeId, url }) =>
      window.__store?.getState().createBrowserTab(worktreeId, url, { activate: true })?.id ?? null,
    { worktreeId, url }
  )
  if (!tabId) {
    throw new Error(`browser tab not created for ${url}`)
  }
  const webview = page.locator(`[data-browser-overlay-tab-id="${tabId}"] webview`)
  const run = (script: string): Promise<unknown> =>
    webview.evaluate<unknown, string, Electron.WebviewTag>(
      (node, code) => node.executeJavaScript(code),
      script
    )
  await expect.poll(() => run('location.href').catch(() => null), { timeout: 30_000 }).toBe(url)
  const current = String(await run('Notification.permission'))
  const requested = String(await run('Notification.requestPermission()'))
  return { current, requested }
}

test('withholds notification permission from Slack pages only', async ({
  orcaPage,
  electronApp
}) => {
  // Why: serve both hosts locally so the check sees real https origins without network access.
  await electronApp.evaluate(({ session }) => {
    session.fromPartition('persist:orca-browser').protocol.handle(
      'https',
      () =>
        new Response('<!doctype html><title>Notify probe</title><body>probe</body>', {
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
    )
  })
  try {
    await waitForSessionReady(orcaPage)
    await ensureTerminalVisible(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)

    expect(await readNotificationPermission(orcaPage, worktreeId, SLACK_URL)).toEqual({
      current: 'denied',
      requested: 'denied'
    })
    expect(await readNotificationPermission(orcaPage, worktreeId, CONTROL_URL)).toEqual({
      current: 'granted',
      requested: 'granted'
    })
  } finally {
    await electronApp.evaluate(({ session }) => {
      session.fromPartition('persist:orca-browser').protocol.unhandle('https')
    })
  }
})
