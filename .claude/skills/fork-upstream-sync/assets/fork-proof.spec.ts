// Desktop proof spec for the weekly upstream sync: one test per desktop fork feature, each driven
// the way a person would, with named screenshots of the moment it works and the state that proves it.
// Copy to tests/e2e/zz-proof-fork-sync.spec.ts (keep it untracked) and run the same file against
// the BEFORE and AFTER builds with PROOF_DIR and PROOF_LABEL set, so a reviewer compares pairs.
// Output: <label>-<feature>-<moment>.png, plus <label>-<feature>-<moment>.json for the state shown.
// Nothing asserts a build-specific outcome; the expect.poll calls only wait for the UI to settle.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type RequestListener, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Locator, Page } from '@stablyai/playwright-test'
import type { ProviderRateLimits } from '../../src/shared/rate-limit-types'
import { guestUrl, navigateGuest, waitForGuestUrl } from './helpers/browser-split-guest-probes'
import { removeWorktreeViaStore } from './helpers/dead-terminal'
import { expect, test } from './helpers/orca-app'
import { openSidebarWorkspaceComposer } from './helpers/sidebar-project-dialog'
import {
  ensureTerminalVisible,
  getActiveWorktreeId,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  execInTerminal,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { createTerminalTabFromMenu } from './helpers/terminal-tab-menu'
import { waitForPtyShellEcho } from './terminal-pty-readiness'

const outDir = process.env.PROOF_DIR ?? tmpdir()
const label = process.env.PROOF_LABEL ?? 'shot'

function record(name: string, value: unknown): void {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(path.join(outDir, `${label}-${name}.json`), JSON.stringify(value, null, 2))
}

/** Records the state the screenshot shows (when given), then takes the screenshot. */
async function capture(page: Page, name: string, state?: unknown): Promise<void> {
  if (state !== undefined) {
    record(name, state)
  }
  await page.waitForTimeout(1500)
  mkdirSync(outDir, { recursive: true })
  await page.screenshot({ path: path.join(outDir, `${label}-${name}.png`) })
}

// --- Shared fixtures ----------------------------------------------------------------------

type ProbeServer = { origin: string; close: () => Promise<void> }

async function startProbeServer(handler: RequestListener): Promise<ProbeServer> {
  const server: Server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Proof probe server did not bind a TCP port')
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

const TITLED_PAGES: Record<string, string> = {
  '/docs': 'Team Docs',
  '/dashboard': 'Build Dashboard',
  '/review': 'Code Review'
}
const PAGE_TITLES = Object.values(TITLED_PAGES)

const serveTitledPages: RequestListener = (request, response) => {
  const title = TITLED_PAGES[request.url ?? ''] ?? 'Not found'
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(
    `<!doctype html><title>${title}</title><body style="font:48px sans-serif;padding:40px"><h1>${title}</h1>`
  )
}

async function startProofSession(page: Page): Promise<string> {
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  return worktreeId
}

function ensureRootGroup(page: Page, worktreeId: string): Promise<string> {
  return page.evaluate(
    (worktree) => window.__store!.getState().ensureWorktreeRootGroup(worktree),
    worktreeId
  )
}

type BrowserTabRequest = {
  worktreeId: string
  url: string
  title: string
  placement?: 'side-pane'
  targetGroupId?: string
}

async function openBrowserTab(page: Page, request: BrowserTabRequest): Promise<string> {
  const tabId = await page.evaluate(
    ({ worktreeId, url, title, placement, targetGroupId }) =>
      window.__store
        ?.getState()
        .createBrowserTab(worktreeId, url, { title, activate: true, placement, targetGroupId })
        ?.id ?? null,
    request
  )
  if (!tabId) {
    throw new Error(`Failed to create the browser tab for ${request.url}`)
  }
  return tabId
}

/** The titled pages as browser tabs, in the side pane of the terminal group (or a given group). */
async function openTitledTabs(
  page: Page,
  server: ProbeServer,
  worktreeId: string,
  target: { placement?: 'side-pane'; targetGroupId: string }
): Promise<void> {
  for (const [route, title] of Object.entries(TITLED_PAGES)) {
    await openBrowserTab(page, { worktreeId, url: `${server.origin}${route}`, title, ...target })
  }
}

async function readPanes(page: Page, worktreeId: string) {
  return page.evaluate((worktree) => {
    const state = window.__store!.getState()
    const groups = state.groupsByWorktree[worktree] ?? []
    return {
      groupIds: groups.map((group) => group.id),
      layout: state.layoutByWorktree[worktree] ?? null,
      browserGroupIds: (state.unifiedTabsByWorktree[worktree] ?? [])
        .filter((tab) => tab.contentType === 'browser')
        .map((tab) => tab.groupId),
      orientationByGroup: Object.fromEntries(
        groups.map((group) => [group.id, group.tabStripOrientation ?? null])
      )
    }
  }, worktreeId)
}

async function readGroup(page: Page, worktreeId: string, groupId: string) {
  return page.evaluate(
    ({ worktree, group }) => {
      const found = window
        .__store!.getState()
        .groupsByWorktree[worktree].find((candidate) => candidate.id === group)!
      return {
        orientation: found.tabStripOrientation ?? null,
        tabOrder: [...found.tabOrder],
        activeTabId: found.activeTabId
      }
    },
    { worktree: worktreeId, group: groupId }
  )
}

const stripRows = (page: Page): Locator => page.locator('.vertical-tab-strip [data-tab-id]')
const stripTab = (page: Page, title: string): Locator => stripRows(page).filter({ hasText: title })
const stripLabels = (page: Page): Promise<string[]> => stripRows(page).allInnerTexts()

// --- Per-feature tests --------------------------------------------------------------------

test.describe('fork proof', () => {
  test.afterEach(async ({ orcaPage }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) {
      return
    }
    record(`${testInfo.title}-error`, { status: testInfo.status, message: testInfo.error?.message })
    await capture(orcaPage, `${testInfo.title}-failed`).catch(() => undefined)
  })

  test('in-place-workspaces', async ({ orcaPage, testRepoPath }) => {
    test.setTimeout(240_000)
    const listWorktrees = (): string[] =>
      execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: testRepoPath,
        encoding: 'utf8'
      })
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
    const updateRepo = (
      id: string,
      patch: { inPlaceWorkspaces: boolean; workspaceStartPath: string | undefined }
    ): Promise<unknown> =>
      orcaPage.evaluate(
        ({ repoId, updates }) => window.__store!.getState().updateRepo(repoId, updates),
        { repoId: id, updates: patch }
      )

    await waitForSessionReady(orcaPage)
    const rootWorktreeId = await waitForActiveWorktree(orcaPage)
    const repoId = rootWorktreeId.split('::')[0]
    const startFolder = 'services/api'
    const servicesDir = path.join(testRepoPath, 'services')
    const servicesExisted = existsSync(servicesDir)
    mkdirSync(path.join(testRepoPath, startFolder), { recursive: true })
    const worktreesBefore = listWorktrees()
    const rootRow = orcaPage.locator(`[role="option"][data-worktree-id="${rootWorktreeId}"]`)
    let workspaceId: string | null = null

    try {
      await updateRepo(repoId, { inPlaceWorkspaces: true, workspaceStartPath: startFolder })

      // Settings: the switch is on and the start folder reads services/api.
      await orcaPage.evaluate((id) => {
        const state = window.__store!.getState()
        state.openSettingsTarget({ pane: 'repo', repoId: id })
        state.openSettingsPage()
      }, repoId)
      const modeLabel = 'Create workspaces without git worktrees'
      await expect(orcaPage.getByText(modeLabel).first()).toBeVisible()
      await orcaPage.getByText(modeLabel).first().scrollIntoViewIfNeeded()
      await capture(orcaPage, 'in-place-workspaces-settings', {
        switchChecked: await orcaPage
          .getByRole('switch', { name: modeLabel })
          .first()
          .getAttribute('aria-checked'),
        startFolderInput: await orcaPage.getByPlaceholder('Project root').first().inputValue()
      })
      await orcaPage.evaluate(() => window.__store!.getState().closeSettingsPage())

      // Composer: a name only, no branch or base fields.
      const name = `in-place-${Date.now()}`
      await openSidebarWorkspaceComposer(orcaPage)
      const dialog = orcaPage.getByRole('dialog', { name: /Create Workspace/i })
      await expect(dialog).toBeVisible()
      await dialog.getByPlaceholder(/Workspace name|Type a name/i).fill(name)
      await capture(orcaPage, 'in-place-workspaces-composer')
      await dialog.getByRole('button', { name: /Create Workspace/i }).click()
      await expect(dialog).toBeHidden({ timeout: 20_000 })
      await expect
        .poll(() => getActiveWorktreeId(orcaPage), { timeout: 30_000 })
        .toContain('::workspace:')
      workspaceId = await getActiveWorktreeId(orcaPage)
      if (!workspaceId) {
        throw new Error('in-place workspace did not become active')
      }
      await expect(
        orcaPage.locator(`[role="option"][data-worktree-id="${workspaceId}"]`)
      ).toContainText(name)

      // Terminal: starts in the start folder, and git gained no worktree.
      await createTerminalTabFromMenu(orcaPage)
      await waitForActiveTerminalManager(orcaPage, 30_000)
      const ptyId = await waitForActivePanePtyId(orcaPage)
      await waitForPtyShellEcho(orcaPage, ptyId, 15_000)
      await execInTerminal(orcaPage, ptyId, "pwd; printf 'PROOF-%s\\n' DONE")
      await waitForTerminalOutput(orcaPage, 'PROOF-DONE')
      await capture(orcaPage, 'in-place-workspaces-terminal', {
        workspaceId,
        rootRowVisible: await rootRow.isVisible(),
        terminalTail: (await getTerminalContent(orcaPage, 1200)).trim(),
        gitWorktreesBefore: worktreesBefore,
        gitWorktreesAfter: listWorktrees()
      })

      // Deleting only forgets the entry: the root row, folder and git worktrees stay.
      await removeWorktreeViaStore(orcaPage, workspaceId)
      workspaceId = null
      record('in-place-workspaces-after-delete', {
        rootRowVisible: await rootRow.isVisible(),
        startFolderOnDisk: existsSync(path.join(testRepoPath, startFolder)),
        gitWorktrees: listWorktrees()
      })
    } finally {
      if (workspaceId) {
        await removeWorktreeViaStore(orcaPage, workspaceId).catch(() => undefined)
      }
      await updateRepo(repoId, { inPlaceWorkspaces: false, workspaceStartPath: undefined }).catch(
        () => undefined
      )
      rmSync(servicesExisted ? path.join(servicesDir, 'api') : servicesDir, {
        recursive: true,
        force: true
      })
    }
  })

  test('vertical-tab-strip', async ({ orcaPage }) => {
    test.setTimeout(120_000)
    const server = await startProbeServer(serveTitledPages)
    try {
      const worktreeId = await startProofSession(orcaPage)
      const rootGroupId = await ensureRootGroup(orcaPage, worktreeId)
      const groupId = await orcaPage.evaluate(
        ({ worktree, rootGroup }) =>
          window.__store!.getState().createEmptySplitGroup(worktree, rootGroup, 'right') ?? null,
        { worktree: worktreeId, rootGroup: rootGroupId }
      )
      if (!groupId) {
        throw new Error('Browser split unavailable')
      }
      await openTitledTabs(orcaPage, server, worktreeId, { targetGroupId: groupId })
      await orcaPage.evaluate(
        ({ worktree, group }) => window.__store!.getState().focusGroup(worktree, group),
        { worktree: worktreeId, group: groupId }
      )
      const initialOrder = (await readGroup(orcaPage, worktreeId, groupId)).tabOrder
      const strip = orcaPage.locator(`[data-tab-group-strip-id="${groupId}"]`)
      await capture(orcaPage, 'vertical-tab-strip-horizontal')

      await strip.getByRole('button', { name: 'Show tabs on the side' }).click()
      await expect
        .poll(async () => (await readGroup(orcaPage, worktreeId, groupId)).orientation)
        .toBe('vertical')
      const rows = stripRows(orcaPage)
      await expect(rows).toHaveCount(3)
      const rowBoxes = await rows.evaluateAll((nodes) =>
        nodes.map((node) => {
          const { x, y, width, height } = node.getBoundingClientRect()
          return { x, y, width, height }
        })
      )
      await capture(orcaPage, 'vertical-tab-strip-vertical', {
        group: await readGroup(orcaPage, worktreeId, groupId),
        rowBoxes,
        paneBodyBox: await orcaPage.locator(`[data-tab-group-body-id="${groupId}"]`).boundingBox()
      })

      // Drag the last row onto the top half of the first: it moves to the front.
      const [first, , third] = rowBoxes
      await orcaPage.mouse.move(third.x + 40, third.y + third.height / 2)
      await orcaPage.mouse.down()
      await orcaPage.mouse.move(third.x + 40, third.y - 10, { steps: 5 })
      await orcaPage.mouse.move(first.x + 40, first.y + 4, { steps: 10 })
      await orcaPage.mouse.up()
      await expect
        .poll(async () => (await readGroup(orcaPage, worktreeId, groupId)).tabOrder)
        .toEqual([initialOrder[2], initialOrder[0], initialOrder[1]])
      await capture(orcaPage, 'vertical-tab-strip-reordered', {
        group: await readGroup(orcaPage, worktreeId, groupId),
        groupCount: (await readPanes(orcaPage, worktreeId)).groupIds.length,
        labels: await stripLabels(orcaPage)
      })

      // Why: dnd-kit swallows clicks for 50ms after a drop; a person never clicks that fast.
      await orcaPage.waitForTimeout(100)
      await strip.getByRole('button', { name: 'Show tabs on top' }).click()
      await expect
        .poll(async () => (await readGroup(orcaPage, worktreeId, groupId)).orientation)
        .toBe('horizontal')
      record('vertical-tab-strip-back-on-top', await readGroup(orcaPage, worktreeId, groupId))
    } finally {
      await server.close()
    }
  })

  test('browser-side-pane', async ({ orcaPage }) => {
    test.setTimeout(120_000)
    const worktreeId = await startProofSession(orcaPage)
    const terminalGroupId = await ensureRootGroup(orcaPage, worktreeId)
    // Same action the tab strip "+" menu, Cmd+J and the menu shortcut run.
    const openNewTab = (groupId: string): Promise<void> =>
      orcaPage.evaluate(
        (group) => window.__store!.getState().openNewBrowserTabInActiveWorkspace(group),
        groupId
      )

    await openNewTab(terminalGroupId)
    await expect.poll(async () => (await readPanes(orcaPage, worktreeId)).groupIds).toHaveLength(2)
    const first = await readPanes(orcaPage, worktreeId)
    const sidePaneId = first.groupIds.find((id) => id !== terminalGroupId)!
    await expect(stripRows(orcaPage)).toHaveCount(1)
    await capture(orcaPage, 'browser-side-pane-first-tab', {
      terminalGroupId,
      sidePaneId,
      panes: first
    })

    // A tab from the terminal pane reuses the side pane; one from the side pane stays there.
    await openNewTab(terminalGroupId)
    await openNewTab(sidePaneId)
    await expect(stripRows(orcaPage)).toHaveCount(3)
    await capture(orcaPage, 'browser-side-pane-three-tabs', {
      sidePaneId,
      panes: await readPanes(orcaPage, worktreeId)
    })
  })

  const SLACK_URL = 'https://app.slack.com/client'
  const CONTROL_URL = 'https://notify.example.test/'

  async function readNotificationPermission(page: Page, worktreeId: string, url: string) {
    const tabId = await openBrowserTab(page, { worktreeId, url, title: 'Notify probe' })
    const webview = page.locator(`[data-browser-overlay-tab-id="${tabId}"] webview`)
    const run = (script: string): Promise<unknown> =>
      webview.evaluate<unknown, string, Electron.WebviewTag>(
        (node, code) => node.executeJavaScript(code),
        script
      )
    await expect.poll(() => run('location.href').catch(() => null), { timeout: 30_000 }).toBe(url)
    return {
      url,
      current: String(await run('Notification.permission')),
      requested: String(await run('Notification.requestPermission()'))
    }
  }

  test('browser-slack-notification-mute', async ({ orcaPage, electronApp }) => {
    test.setTimeout(120_000)
    // Why: serve both origins locally so the check sees real https origins without network access.
    await electronApp.evaluate(({ session }) => {
      session
        .fromPartition('persist:orca-browser')
        .protocol.handle(
          'https',
          (request) =>
            new Response(
              `<!doctype html><title>Notify probe</title><body style="font:36px sans-serif;padding:40px"><h1>Notify probe</h1><p>${request.url}</p>`,
              { headers: { 'content-type': 'text/html; charset=utf-8' } }
            )
        )
    })
    try {
      const worktreeId = await startProofSession(orcaPage)
      const slack = await readNotificationPermission(orcaPage, worktreeId, SLACK_URL)
      await capture(orcaPage, 'browser-slack-notification-mute-slack', slack)
      const control = await readNotificationPermission(orcaPage, worktreeId, CONTROL_URL)
      await capture(orcaPage, 'browser-slack-notification-mute-control', control)
    } finally {
      await electronApp.evaluate(({ session }) => {
        session.fromPartition('persist:orca-browser').protocol.unhandle('https')
      })
    }
  })

  // Why CDP: Playwright's mouse API only knows left/middle/right.
  async function clickSideButton(page: Page, tabId: string, button: 'back' | 'forward') {
    const box = await page.locator(`[data-browser-overlay-tab-id="${tabId}"] webview`).boundingBox()
    if (!box) {
      throw new Error('The browser page has no visible webview')
    }
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const buttons = button === 'back' ? 8 : 16
    const events = [
      { type: 'mouseMoved' as const },
      { type: 'mousePressed' as const, button, buttons, clickCount: 1 },
      { type: 'mouseReleased' as const, button, buttons: 0, clickCount: 1 }
    ]
    const cdp = await page.context().newCDPSession(page)
    try {
      for (const event of events) {
        await cdp.send('Input.dispatchMouseEvent', { ...point, ...event })
      }
    } finally {
      await cdp.detach()
    }
  }

  test('browser-mouse-side-buttons', async ({ orcaPage }) => {
    test.setTimeout(120_000)
    const server = await startProbeServer((request, response) => {
      const name = request.url === '/b' ? 'B' : 'A'
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(
        `<!doctype html><title>Page ${name}</title><body style="height:100vh;font:96px sans-serif;padding:40px">Page ${name}`
      )
    })
    try {
      const worktreeId = await startProofSession(orcaPage)
      const pageA = `${server.origin}/a`
      const pageB = `${server.origin}/b`
      const tabId = await openBrowserTab(orcaPage, { worktreeId, url: pageA, title: 'Page A' })
      await waitForGuestUrl(orcaPage, tabId, pageA)
      await navigateGuest(orcaPage, tabId, pageB)
      await capture(orcaPage, 'browser-mouse-side-buttons-start', {
        guestUrl: await guestUrl(orcaPage, tabId)
      })

      await clickSideButton(orcaPage, tabId, 'back')
      await expect.poll(() => guestUrl(orcaPage, tabId), { timeout: 10_000 }).toBe(pageA)
      await capture(orcaPage, 'browser-mouse-side-buttons-back', {
        guestUrl: await guestUrl(orcaPage, tabId)
      })

      await clickSideButton(orcaPage, tabId, 'forward')
      await expect.poll(() => guestUrl(orcaPage, tabId), { timeout: 10_000 }).toBe(pageB)
      await capture(orcaPage, 'browser-mouse-side-buttons-forward', {
        guestUrl: await guestUrl(orcaPage, tabId)
      })
    } finally {
      await server.close()
    }
  })

  const MARKDOWN_PAGES: Record<string, string> = {
    '/docs/README.md': `# Sample Project

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
`,
    '/docs/guide.md': '# Guide\n\nThe second page.\n'
  }

  const evaluateInGuest = <T>(page: Page, tabId: string, code: string): Promise<T> =>
    page.evaluate(
      ({ selector, script }) => {
        const webview = document.querySelector<Electron.WebviewTag>(selector)
        if (!webview) {
          throw new Error('Browser guest unavailable')
        }
        return webview.executeJavaScript(script, true)
      },
      { selector: `[data-browser-overlay-tab-id="${tabId}"] webview`, script: code }
    )

  const markdownView = (page: Page, tabId: string): Promise<string | null> =>
    evaluateInGuest(page, tabId, 'document.documentElement.dataset.orcaMarkdownView ?? null')

  const clickGuestToggle = (page: Page, tabId: string): Promise<unknown> =>
    evaluateInGuest(page, tabId, `document.querySelector('.orca-markdown-toggle').click()`)

  test('browser-markdown-viewer', async ({ orcaPage }) => {
    test.setTimeout(120_000)
    const server = await startProbeServer((request, response) => {
      const body = MARKDOWN_PAGES[request.url ?? '']
      response.writeHead(body === undefined ? 404 : 200, {
        'Content-Type': 'text/plain; charset=utf-8'
      })
      response.end(body ?? 'not found')
    })
    try {
      const worktreeId = await startProofSession(orcaPage)
      const readmeUrl = `${server.origin}/docs/README.md`
      const tabId = await openBrowserTab(orcaPage, { worktreeId, url: readmeUrl, title: 'Doc' })
      await waitForGuestUrl(orcaPage, tabId, readmeUrl)
      await expect.poll(() => markdownView(orcaPage, tabId), { timeout: 15_000 }).toBe('rendered')
      await capture(
        orcaPage,
        'browser-markdown-viewer-rendered',
        await evaluateInGuest(
          orcaPage,
          tabId,
          `({
            view: document.documentElement.dataset.orcaMarkdownView ?? null,
            heading: document.querySelector('.orca-markdown-body h1')?.id,
            tableCells: document.querySelectorAll('.orca-markdown-body td').length,
            highlightedTokens: document.querySelectorAll('.orca-markdown-body .hljs-number').length,
            inlineHandlers: document.querySelectorAll('.orca-markdown-body [onerror]').length,
            scriptLinks: document.querySelectorAll('.orca-markdown-body a[href^="javascript"]').length,
            scripts: document.querySelectorAll('.orca-markdown-body script').length,
            title: document.title
          })`
        )
      )

      await clickGuestToggle(orcaPage, tabId)
      await expect.poll(() => markdownView(orcaPage, tabId)).toBe('source')
      await capture(orcaPage, 'browser-markdown-viewer-source', {
        view: await markdownView(orcaPage, tabId)
      })

      // Links between markdown files stay in the tab and render too.
      await clickGuestToggle(orcaPage, tabId)
      await expect.poll(() => markdownView(orcaPage, tabId)).toBe('rendered')
      await evaluateInGuest(
        orcaPage,
        tabId,
        `document.querySelector('.orca-markdown-body a').click()`
      )
      await expect.poll(() => guestUrl(orcaPage, tabId)).toBe(`${server.origin}/docs/guide.md`)
      await expect.poll(() => markdownView(orcaPage, tabId), { timeout: 15_000 }).toBe('rendered')
      await capture(orcaPage, 'browser-markdown-viewer-linked-page', {
        guestUrl: await guestUrl(orcaPage, tabId),
        view: await markdownView(orcaPage, tabId)
      })
    } finally {
      await server.close()
    }
  })

  async function closeTab(page: Page, title: string): Promise<void> {
    await stripTab(page, title).hover()
    await stripTab(page, title).locator('button').click()
    await expect(stripTab(page, title)).toHaveCount(0)
  }

  test('reopen-closed-tab', async ({ orcaPage }) => {
    test.setTimeout(120_000)
    const server = await startProbeServer(serveTitledPages)
    try {
      const worktreeId = await startProofSession(orcaPage)
      const terminalGroupId = await ensureRootGroup(orcaPage, worktreeId)
      await openTitledTabs(orcaPage, server, worktreeId, {
        placement: 'side-pane',
        targetGroupId: terminalGroupId
      })
      await expect.poll(() => stripLabels(orcaPage)).toEqual(PAGE_TITLES)
      const reopen = orcaPage.getByRole('menuitem', { name: /Reopen Closed Tab/ })

      // Nothing closed yet: the item is there but disabled.
      await stripTab(orcaPage, 'Team Docs').click({ button: 'right' })
      const disabledWhenNothingClosed = await reopen.isDisabled()
      await orcaPage.keyboard.press('Escape')
      await expect(reopen).toHaveCount(0)

      // Close the middle tab, then reopen it from a remaining tab's menu.
      await closeTab(orcaPage, 'Build Dashboard')
      await stripTab(orcaPage, 'Team Docs').click({ button: 'right' })
      await expect(reopen).toBeEnabled()
      await capture(orcaPage, 'reopen-closed-tab-tab-menu', {
        disabledWhenNothingClosed,
        enabledAfterClose: await reopen.isEnabled(),
        labelsWhileClosed: await stripLabels(orcaPage)
      })
      await reopen.click()
      await expect.poll(() => stripLabels(orcaPage)).toEqual(PAGE_TITLES)

      // Right-click the empty space under the vertical tabs.
      await closeTab(orcaPage, 'Code Review')
      const strip = orcaPage.locator('.vertical-tab-strip')
      const stripBox = await strip.boundingBox()
      await strip.click({ button: 'right', position: { x: 60, y: (stripBox?.height ?? 200) - 40 } })
      await expect(reopen).toBeEnabled()
      await capture(orcaPage, 'reopen-closed-tab-blank-area-menu', {
        menuItemCount: await orcaPage.getByRole('menuitem').count()
      })
      await reopen.click()
      await expect.poll(() => stripLabels(orcaPage)).toEqual(PAGE_TITLES)

      // Closing the pane's last tab removes the pane; reopening from the terminal tab brings it back.
      for (const title of PAGE_TITLES) {
        await closeTab(orcaPage, title)
      }
      await expect(strip).toHaveCount(0)
      await orcaPage.locator('[data-tab-id]').first().click({ button: 'right' })
      await reopen.click()
      await expect(stripTab(orcaPage, 'Code Review')).toHaveCount(1)
      await capture(orcaPage, 'reopen-closed-tab-pane-restored', {
        verticalStripCount: await strip.count(),
        panes: await readPanes(orcaPage, worktreeId)
      })
    } finally {
      await server.close()
    }
  })

  function claudeLimits(extraUsage: ProviderRateLimits['extraUsage']): ProviderRateLimits {
    return {
      provider: 'claude',
      session: null,
      weekly: null,
      extraUsage,
      updatedAt: Date.now(),
      error: null,
      status: 'ok'
    }
  }

  // A Codex Business member: a monthly credit limit (1,583 of 75,000 used) and no 5h/weekly windows.
  function codexBusinessLimits(): ProviderRateLimits {
    return {
      provider: 'codex',
      session: null,
      weekly: null,
      monthly: {
        usedPercent: 2.11,
        windowMinutes: 43_200,
        resetsAt: Date.now() + 16 * 24 * 60 * 60 * 1000,
        resetDescription: null
      },
      planType: 'business',
      updatedAt: Date.now(),
      error: null,
      status: 'ok'
    }
  }

  async function pushRateLimits(
    page: Page,
    patch: { claude?: ProviderRateLimits; codex?: ProviderRateLimits }
  ): Promise<void> {
    await page.evaluate((next) => {
      const state = window.__store!.getState()
      state.setRateLimitsFromPush({ ...state.rateLimits, ...next })
    }, patch)
  }

  const usageChip = (page: Page, provider: 'claude' | 'codex'): Locator =>
    page.locator(`.status-bar-usage-cluster [data-usage-chip="${provider}"]`)

  const chipText = async (page: Page, provider: 'claude' | 'codex'): Promise<string> =>
    (await usageChip(page, provider).innerText()).trim()

  async function openUsagePopover(page: Page): Promise<Locator> {
    await page.getByRole('button', { name: 'Usage', exact: true }).click()
    return page.locator('[role="menu"] [role="menuitem"]')
  }

  test('status-bar-credit-usage', async ({ orcaPage }) => {
    test.setTimeout(120_000)
    const credits = {
      unit: 'currency',
      balance: 980.4,
      currencyCode: 'USD',
      enabled: true,
      disabledReason: null,
      spent: 19.6,
      spendLimit: 1000,
      spentPercent: 1.96,
      resetsAt: null
    } as const
    await startProofSession(orcaPage)
    await pushRateLimits(orcaPage, { claude: claudeLimits(credits) })
    await expect(usageChip(orcaPage, 'claude')).toContainText('$19.60 / $1,000')
    await capture(orcaPage, 'status-bar-credit-usage-chip', {
      chip: await chipText(orcaPage, 'claude')
    })

    const rows = await openUsagePopover(orcaPage)
    await expect(rows.filter({ hasText: 'Claude' })).toContainText('$19.60 / $1,000')
    await capture(orcaPage, 'status-bar-credit-usage-popover', {
      claudeRow: (await rows.filter({ hasText: 'Claude' }).innerText()).trim(),
      noUsageDataCount: await orcaPage.getByText('No usage data').count()
    })
    await orcaPage.keyboard.press('Escape')
  })

  test('codex-business-credits', async ({ orcaPage }) => {
    test.setTimeout(120_000)
    await startProofSession(orcaPage)
    await pushRateLimits(orcaPage, { codex: codexBusinessLimits() })
    await expect(usageChip(orcaPage, 'codex')).toContainText('2%')
    await capture(orcaPage, 'codex-business-credits-chip', {
      chip: await chipText(orcaPage, 'codex'),
      note: 'Renderer-level snapshot in the shape the main process maps from individualLimit; the stub-codex mapping is covered by src/main/rate-limits/codex-fetcher-credit-balance.test.ts.'
    })

    const rows = await openUsagePopover(orcaPage)
    const codexRow = rows.filter({ hasText: 'Codex' })
    await expect(codexRow).toContainText('2%')
    await capture(orcaPage, 'codex-business-credits-popover', {
      codexRow: (await codexRow.innerText()).trim(),
      noUsageDataCount: await orcaPage.getByText('No usage data').count()
    })

    // Hovering the row drills into the provider detail, which has a Monthly section.
    await codexRow.hover()
    const monthlyVisible = await orcaPage
      .getByText('Monthly', { exact: true })
      .first()
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    await capture(orcaPage, 'codex-business-credits-monthly-detail', { monthlyVisible })
    await orcaPage.keyboard.press('Escape')
  })
})

// --- Features that need an SSH host or a real Okta sign-in ---------------------------------

const COVERED_ELSEWHERE = [
  ['ssh-okta-verify-ports', 'tests/e2e/local-ssh-browser-routing.spec.ts'],
  ['ssh-project-mapped-path', 'tests/e2e/ssh-project-path-prefix-setup.spec.ts'],
  ['ssh-local-terminal', 'tests/e2e/ssh-local-terminal-from-remote-workspace.spec.ts'],
  ['cross-host-workspace-nesting', 'tests/e2e/ssh-cross-host-workspace-nesting.spec.ts'],
  [
    'browser-okta-fastpass',
    'src/main/browser/browser-session-registry.persistence.test.ts and browser-route-session-policy.test.ts; a real Okta sign-in cannot load here, so the owner confirms it by hand'
  ]
]

test.describe('fork proof: covered elsewhere', () => {
  for (const [id, coveredBy] of COVERED_ELSEWHERE) {
    test(id, () => {
      record(`${id}-note`, { driven: false, coveredBy })
    })
  }
})
