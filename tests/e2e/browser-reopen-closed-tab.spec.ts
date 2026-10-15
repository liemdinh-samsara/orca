/**
 * Chrome's "Reopen closed tab" from the tab strip: right-click a tab, or the empty space under
 * the vertical tabs, to bring back the tab closed by accident.
 */

import { createServer, type Server } from 'node:http'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const PAGES: Record<string, string> = {
  '/docs': 'Team Docs',
  '/dashboard': 'Build Dashboard',
  '/review': 'Code Review'
}

async function startServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const title = PAGES[request.url ?? ''] ?? 'Not found'
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Reopen probe server did not bind a TCP port')
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function stripTab(page: Page, label: string) {
  return page.locator('.vertical-tab-strip [data-tab-id]').filter({ hasText: label })
}

async function stripLabels(page: Page): Promise<string[]> {
  return page.locator('.vertical-tab-strip [data-tab-id]').allInnerTexts()
}

async function closeTab(page: Page, label: string): Promise<void> {
  await stripTab(page, label).hover()
  await stripTab(page, label).locator('button').click()
  await expect(stripTab(page, label)).toHaveCount(0)
}

async function browserUrls(page: Page, worktreeId: string): Promise<string[]> {
  return page.evaluate(
    (worktree) =>
      (window.__store!.getState().browserTabsByWorktree[worktree] ?? []).map((tab) => tab.url),
    worktreeId
  )
}

test('reopens a closed browser tab from the tab strip context menu', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  const server = await startServer()
  try {
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    const terminalGroupId = await orcaPage.evaluate(
      (worktree) => window.__store!.getState().ensureWorktreeRootGroup(worktree),
      worktreeId
    )
    for (const [route, title] of Object.entries(PAGES)) {
      await orcaPage.evaluate(
        ({ worktree, url, title, group }) => {
          window.__store!.getState().createBrowserTab(worktree, url, {
            title,
            placement: 'side-pane',
            targetGroupId: group
          })
        },
        { worktree: worktreeId, url: `${server.origin}${route}`, title, group: terminalGroupId }
      )
    }
    await expect.poll(() => stripLabels(orcaPage)).toEqual(Object.values(PAGES))

    // Nothing closed yet: the item is there but disabled.
    await stripTab(orcaPage, 'Team Docs').click({ button: 'right' })
    const reopen = orcaPage.getByRole('menuitem', { name: /Reopen Closed Tab/ })
    await expect(reopen).toBeDisabled()
    await orcaPage.keyboard.press('Escape')
    await expect(reopen).toHaveCount(0)

    // Right-click a remaining tab: the closed middle tab returns to its old slot.
    await closeTab(orcaPage, 'Build Dashboard')
    await stripTab(orcaPage, 'Team Docs').click({ button: 'right' })
    await expect(reopen).toBeEnabled()
    await reopen.click()
    await expect.poll(() => stripLabels(orcaPage)).toEqual(Object.values(PAGES))
    expect(await browserUrls(orcaPage, worktreeId)).toContain(`${server.origin}/dashboard`)

    // Right-click the empty space under the vertical tabs.
    await closeTab(orcaPage, 'Code Review')
    const strip = orcaPage.locator('.vertical-tab-strip')
    const box = await strip.boundingBox()
    await strip.click({ button: 'right', position: { x: 60, y: (box?.height ?? 200) - 40 } })
    await expect(orcaPage.getByRole('menuitem')).toHaveCount(1)
    await expect(reopen).toBeEnabled()
    await reopen.click()
    await expect.poll(() => stripLabels(orcaPage)).toEqual(Object.values(PAGES))
    expect(await browserUrls(orcaPage, worktreeId)).toContain(`${server.origin}/review`)

    // Closing the pane's last tab removes the pane; reopening from the terminal tab brings it back.
    for (const label of Object.values(PAGES)) {
      await closeTab(orcaPage, label)
    }
    await expect(orcaPage.locator('.vertical-tab-strip')).toHaveCount(0)
    await orcaPage.locator('[data-tab-id]').first().click({ button: 'right' })
    await reopen.click()
    await expect(stripTab(orcaPage, 'Code Review')).toHaveCount(1)
  } finally {
    await server.close()
  }
})
