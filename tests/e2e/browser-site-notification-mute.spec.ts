import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const SLACK_URL = 'https://app.slack.com/client'
const ENTERPRISE_SLACK_URL = 'https://acme.enterprise.slack.com/'
const CONTROL_URL = 'https://notify.example.test/'
// Why: a suffix-only match would mute a look-alike host that merely starts with slack.com.
const LOOKALIKE_URL = 'https://slack.com.evil.test/'

// Why: Orca now asks before a site may notify; muted Slack pages must be denied without that prompt.
async function readNotificationPermission(
  page: Page,
  worktreeId: string,
  url: string,
  answer?: 'Allow'
): Promise<{ requested: string; after: string }> {
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
  const allowButton = page.getByRole('button', { name: 'Allow', exact: true })
  const requested = run('Notification.requestPermission()').then(String)
  await (answer ? allowButton.click() : expect(allowButton).toHaveCount(0))
  // Why: the next site's prompt must not open under this one's closing overlay.
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0)
  return { requested: await requested, after: String(await run('Notification.permission')) }
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
      requested: 'denied',
      after: 'denied'
    })
    expect(await readNotificationPermission(orcaPage, worktreeId, ENTERPRISE_SLACK_URL)).toEqual({
      requested: 'denied',
      after: 'denied'
    })
    expect(await readNotificationPermission(orcaPage, worktreeId, CONTROL_URL, 'Allow')).toEqual({
      requested: 'granted',
      after: 'granted'
    })
    expect(await readNotificationPermission(orcaPage, worktreeId, LOOKALIKE_URL, 'Allow')).toEqual({
      requested: 'granted',
      after: 'granted'
    })
  } finally {
    await electronApp.evaluate(({ session }) => {
      session.fromPartition('persist:orca-browser').protocol.unhandle('https')
    })
  }
})
