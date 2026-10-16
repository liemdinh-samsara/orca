import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const PROBE_URL = 'https://okta-fastpass.example.test/'
const PERMISSION_NAMES = ['local-network-access', 'loopback-network', 'local-network'] as const

// Why: Chromium only exposes some of these names; an unsupported one throws instead of resolving.
const QUERY_SCRIPT = `Promise.all(${JSON.stringify(PERMISSION_NAMES)}.map((name) =>
  navigator.permissions.query({ name }).then(
    (status) => [name, status.state],
    () => [name, 'unsupported']
  )
)).then((entries) => JSON.stringify(Object.fromEntries(entries)))`

test('grants local network access permissions to https pages in a browser tab', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  // Why: serve the probe origin locally so the check sees a real https page without network access.
  await electronApp.evaluate(({ session }) => {
    session.fromPartition('persist:orca-browser').protocol.handle(
      'https',
      () =>
        new Response('<!doctype html><title>LNA probe</title><body>probe</body>', {
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
    )
  })
  try {
    await waitForSessionReady(orcaPage)
    await ensureTerminalVisible(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)

    const tabId = await orcaPage.evaluate(
      ({ worktreeId, url }) =>
        window.__store?.getState().createBrowserTab(worktreeId, url, { activate: true })?.id ??
        null,
      { worktreeId, url: PROBE_URL }
    )
    if (!tabId) {
      throw new Error(`browser tab not created for ${PROBE_URL}`)
    }
    const webview = orcaPage.locator(`[data-browser-overlay-tab-id="${tabId}"] webview`)
    const run = (script: string): Promise<unknown> =>
      webview.evaluate<unknown, string, Electron.WebviewTag>(
        (node, code) => node.executeJavaScript(code),
        script
      )
    await expect
      .poll(() => run('location.href').catch(() => null), { timeout: 30_000 })
      .toBe(PROBE_URL)

    const states: Record<string, string> = JSON.parse(String(await run(QUERY_SCRIPT)))
    await testInfo.attach('local-network-permission-states', {
      body: JSON.stringify(states, null, 2),
      contentType: 'application/json'
    })

    // Informational probe: only names the bundled Chromium resolves are asserted.
    for (const [name, state] of Object.entries(states)) {
      if (state !== 'unsupported') {
        expect(state, `${name} permission state`).toBe('granted')
      }
    }
  } finally {
    await electronApp.evaluate(({ session }) => {
      session.fromPartition('persist:orca-browser').protocol.unhandle('https')
    })
  }
})
