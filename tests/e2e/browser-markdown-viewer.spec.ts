/**
 * A markdown file a browser tab would show as plain text renders as a page instead, like a
 * Chrome markdown-viewer extension, with its source a click away.
 */

import { createServer, type Server } from 'node:http'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { guestUrl, waitForGuestUrl } from './helpers/browser-split-guest-probes'

const README = `# Sample Project

See the [guide](./guide.md).

| Feature | Status |
| --- | --- |
| Tables | Done |

\`\`\`ts
const answer = 42
\`\`\`

<img src="missing.png" onerror="document.title = 'pwned'">
<a href="javascript:document.title='pwned'">bad link</a>
<script>document.title = 'pwned'</script>
`

const PAGES: Record<string, string> = {
  '/docs/README.md': README,
  '/docs/guide.md': '# Guide\n\nThe second page.\n',
  '/docs/notes.txt': '# Not markdown\n'
}

async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const body = PAGES[request.url ?? '']
    response.writeHead(body === undefined ? 404 : 200, {
      'Content-Type': 'text/plain; charset=utf-8'
    })
    response.end(body ?? 'not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Markdown probe server did not bind a TCP port')
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  }
}

async function evaluateInGuest<T>(page: Page, tabId: string, code: string): Promise<T> {
  return page.evaluate(
    ({ selector, script }) => {
      const webview = document.querySelector<Electron.WebviewTag>(selector)
      if (!webview) {
        throw new Error('Browser guest unavailable')
      }
      return webview.executeJavaScript(script, true)
    },
    { selector: `[data-browser-overlay-tab-id="${tabId}"] webview`, script: code }
  )
}

function markdownView(page: Page, tabId: string): Promise<string | null> {
  return evaluateInGuest(page, tabId, 'document.documentElement.dataset.orcaMarkdownView ?? null')
}

test('renders markdown files in a browser tab', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  const server = await startServer()
  try {
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    const openTab = async (url: string): Promise<string> => {
      const tabId = await orcaPage.evaluate(
        ({ targetWorktreeId, targetUrl }) =>
          window.__store
            ?.getState()
            .createBrowserTab(targetWorktreeId, targetUrl, { title: 'Doc', activate: true })?.id ??
          null,
        { targetWorktreeId: worktreeId, targetUrl: url }
      )
      if (!tabId) {
        throw new Error('Failed to create the browser tab')
      }
      await waitForGuestUrl(orcaPage, tabId, url)
      return tabId
    }

    const tabId = await openTab(`${server.url}/docs/README.md`)
    await expect.poll(() => markdownView(orcaPage, tabId), { timeout: 15_000 }).toBe('rendered')
    expect(
      await evaluateInGuest(
        orcaPage,
        tabId,
        `({
          heading: document.querySelector('.orca-markdown-body h1')?.id,
          cells: document.querySelectorAll('.orca-markdown-body td').length,
          highlighted: document.querySelectorAll('.orca-markdown-body .hljs-number').length,
          handlers: document.querySelectorAll('.orca-markdown-body [onerror]').length,
          scriptLinks: document.querySelectorAll('.orca-markdown-body a[href^="javascript"]').length,
          scripts: document.querySelectorAll('.orca-markdown-body script').length,
          title: document.title
        })`
      )
    ).toEqual({
      heading: 'sample-project',
      cells: 2,
      highlighted: 1,
      handlers: 0,
      scriptLinks: 0,
      scripts: 0,
      title: expect.not.stringContaining('pwned')
    })

    await evaluateInGuest(
      orcaPage,
      tabId,
      `document.querySelector('.orca-markdown-toggle').click()`
    )
    await expect.poll(() => markdownView(orcaPage, tabId)).toBe('source')
    expect(
      await evaluateInGuest(
        orcaPage,
        tabId,
        `getComputedStyle(document.querySelector('body > pre')).display`
      )
    ).toBe('block')
    await evaluateInGuest(
      orcaPage,
      tabId,
      `document.querySelector('.orca-markdown-toggle').click()`
    )
    await expect.poll(() => markdownView(orcaPage, tabId)).toBe('rendered')

    // Links between markdown files stay in the tab and render too.
    await evaluateInGuest(
      orcaPage,
      tabId,
      `document.querySelector('.orca-markdown-body a').click()`
    )
    await expect.poll(() => guestUrl(orcaPage, tabId)).toBe(`${server.url}/docs/guide.md`)
    await expect.poll(() => markdownView(orcaPage, tabId), { timeout: 15_000 }).toBe('rendered')

    const textTabId = await openTab(`${server.url}/docs/notes.txt`)
    await orcaPage.waitForTimeout(1_000)
    expect(await markdownView(orcaPage, textTabId)).toBeNull()
  } finally {
    await server.close()
  }
})
