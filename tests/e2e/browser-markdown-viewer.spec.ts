/**
 * A markdown file a browser tab would show as plain text renders as a page instead, like a
 * Chrome markdown-viewer extension, with its source a click away.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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

<style>body { display: none }</style>

<form><button>Send</button><select></select><textarea></textarea></form>
`

const PAGES: Record<string, string> = {
  '/docs/README.md': README,
  '/docs/guide.md': '# Guide\n\nThe second page.\n',
  '/docs/notes.txt': '# Not markdown\n',
  '/docs/typed.md': '# Typed\n\nServed as markdown.\n'
}
// Why: Chromium reports these as text/markdown rather than text/plain, the other type the viewer accepts.
const MARKDOWN_TYPED_PATHS = new Set(['/docs/typed.md'])

async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const path = request.url ?? ''
    const body = PAGES[path]
    response.writeHead(body === undefined ? 404 : 200, {
      'Content-Type': MARKDOWN_TYPED_PATHS.has(path)
        ? 'text/markdown; charset=utf-8'
        : 'text/plain; charset=utf-8'
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

async function prepareWorktree(page: Page): Promise<string> {
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  return worktreeId
}

async function openTab(page: Page, worktreeId: string, url: string): Promise<string> {
  const tabId = await page.evaluate(
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
  await waitForGuestUrl(page, tabId, url)
  return tabId
}

async function openRenderedReadme(page: Page, serverUrl: string): Promise<{ tabId: string }> {
  const worktreeId = await prepareWorktree(page)
  const tabId = await openTab(page, worktreeId, `${serverUrl}/docs/README.md`)
  await expect.poll(() => markdownView(page, tabId), { timeout: 15_000 }).toBe('rendered')
  return { tabId }
}

test('renders markdown files in a browser tab', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  const server = await startServer()
  try {
    const worktreeId = await prepareWorktree(orcaPage)
    const openTabInWorktree = (url: string): Promise<string> => openTab(orcaPage, worktreeId, url)

    const tabId = await openTabInWorktree(`${server.url}/docs/README.md`)
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

    const textTabId = await openTabInWorktree(`${server.url}/docs/notes.txt`)
    await orcaPage.waitForTimeout(1_000)
    expect(await markdownView(orcaPage, textTabId)).toBeNull()
  } finally {
    await server.close()
  }
})

test('strips forbidden raw html and leaves the page visible', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  const server = await startServer()
  try {
    const { tabId } = await openRenderedReadme(orcaPage, server.url)

    expect(
      await evaluateInGuest(
        orcaPage,
        tabId,
        `({
          heading: document.querySelector('.orca-markdown-body h1')?.id,
          forbidden: document.querySelectorAll(
            '.orca-markdown-body :is(style, form, button, select, textarea)'
          ).length,
          // Why: the viewer's own toggle is the only button a README may leave on the page.
          buttons: document.querySelectorAll('button').length,
          bodyDisplay: getComputedStyle(document.body).display
        })`
      )
    ).toEqual({ heading: 'sample-project', forbidden: 0, buttons: 1, bodyDisplay: 'block' })
  } finally {
    await server.close()
  }
})

test('swaps between the rendered page and the raw source', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  const server = await startServer()
  try {
    const { tabId } = await openRenderedReadme(orcaPage, server.url)
    const displayOf = (selector: string): Promise<string> =>
      evaluateInGuest(
        orcaPage,
        tabId,
        `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).display`
      )
    const toggleLabel = (): Promise<string> =>
      evaluateInGuest(
        orcaPage,
        tabId,
        `document.querySelector('.orca-markdown-toggle').textContent`
      )
    const clickToggle = (): Promise<unknown> =>
      evaluateInGuest(orcaPage, tabId, `document.querySelector('.orca-markdown-toggle').click()`)

    expect(await displayOf('body > pre')).toBe('none')
    expect(await displayOf('.orca-markdown-body')).toBe('block')
    expect(await toggleLabel()).toBe('Show source')

    await clickToggle()
    await expect.poll(() => markdownView(orcaPage, tabId)).toBe('source')
    expect(await displayOf('.orca-markdown-body')).toBe('none')
    expect(await displayOf('body > pre')).toBe('block')
    expect(await toggleLabel()).toBe('Show rendered')

    await clickToggle()
    await expect.poll(() => markdownView(orcaPage, tabId)).toBe('rendered')
    expect(await displayOf('body > pre')).toBe('none')
    expect(await displayOf('.orca-markdown-body')).toBe('block')
    expect(await toggleLabel()).toBe('Show source')
  } finally {
    await server.close()
  }
})

test('renders a markdown file opened from disk', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  const directory = mkdtempSync(join(tmpdir(), 'orca-markdown-file-'))
  try {
    const filePath = join(directory, 'README.md')
    writeFileSync(filePath, '# Local File\n\nOpened from disk.\n')
    const worktreeId = await prepareWorktree(orcaPage)
    const tabId = await openTab(orcaPage, worktreeId, pathToFileURL(filePath).href)

    await expect.poll(() => markdownView(orcaPage, tabId), { timeout: 15_000 }).toBe('rendered')
    expect(
      await evaluateInGuest(orcaPage, tabId, `document.querySelector('.orca-markdown-body h1')?.id`)
    ).toBe('local-file')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('renders a .md page the server sends as text/markdown', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  const server = await startServer()
  try {
    const worktreeId = await prepareWorktree(orcaPage)
    const tabId = await openTab(orcaPage, worktreeId, `${server.url}/docs/typed.md`)

    await expect.poll(() => markdownView(orcaPage, tabId), { timeout: 15_000 }).toBe('rendered')
    expect(
      await evaluateInGuest(
        orcaPage,
        tabId,
        `({
          contentType: document.contentType,
          heading: document.querySelector('.orca-markdown-body h1')?.id
        })`
      )
    ).toEqual({ contentType: 'text/markdown', heading: 'typed' })
  } finally {
    await server.close()
  }
})
