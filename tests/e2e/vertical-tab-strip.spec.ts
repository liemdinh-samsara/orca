import { existsSync, readFileSync } from 'node:fs'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

async function createBrowserSplitWithTabs(
  page: Page,
  count: number
): Promise<{ worktreeId: string; groupId: string; tabIds: string[] }> {
  return page.evaluate((tabCount) => {
    const state = window.__store!.getState()
    const worktreeId = state.activeWorktreeId!
    const rootGroupId = state.ensureWorktreeRootGroup(worktreeId)
    const groupId = state.createEmptySplitGroup(worktreeId, rootGroupId, 'right')
    if (!groupId) {
      throw new Error('Browser split unavailable')
    }
    for (let index = 0; index < tabCount; index++) {
      state.createBrowserTab(worktreeId, 'about:blank', {
        activate: true,
        focusAddressBar: false,
        targetGroupId: groupId
      })
    }
    state.focusGroup(worktreeId, groupId)
    const group = window
      .__store!.getState()
      .groupsByWorktree[worktreeId].find((candidate) => candidate.id === groupId)!
    return { worktreeId, groupId, tabIds: [...group.tabOrder] }
  }, count)
}

async function readGroup(
  page: Page,
  worktreeId: string,
  groupId: string
): Promise<{ orientation: string | null; tabOrder: string[]; activeTabId: string | null }> {
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

test('shows a pane tabs as a vertical list that activates and reorders', async ({
  orcaPage
}, testInfo) => {
  test.setTimeout(120_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const { worktreeId, groupId, tabIds } = await createBrowserSplitWithTabs(orcaPage, 3)
  const strip = orcaPage.locator(`[data-tab-group-strip-id="${groupId}"]`)

  await testInfo.attach('horizontal-tabs', {
    body: await strip.screenshot(),
    contentType: 'image/png'
  })
  await strip.getByRole('button', { name: 'Show tabs on the side' }).click()
  await expect
    .poll(async () => (await readGroup(orcaPage, worktreeId, groupId)).orientation)
    .toBe('vertical')

  const rows = orcaPage.locator('.vertical-tab-strip [data-tab-id]')
  await expect(rows).toHaveCount(3)
  await expect(orcaPage.getByRole('button', { name: /Show tabs on/ })).toHaveCount(1)
  const unfocusedStrip = orcaPage.locator(
    `[data-tab-group-strip-id]:not([data-tab-group-strip-id="${groupId}"])`
  )
  await expect(unfocusedStrip).toHaveCount(1)
  await expect(unfocusedStrip.getByRole('button', { name: /Show tabs on/ })).toHaveCount(0)
  await expect(unfocusedStrip.getByRole('button', { name: 'Pane Actions' })).toHaveCount(0)

  const boxes = await Promise.all([0, 1, 2].map((index) => rows.nth(index).boundingBox()))
  const [first, second, third] = boxes.map((box) => box!)
  // Stacked rows share a column and grow downward.
  expect(second.x).toBeCloseTo(first.x, 0)
  expect(third.x).toBeCloseTo(first.x, 0)
  expect(second.y).toBeGreaterThan(first.y)
  expect(third.y).toBeGreaterThan(second.y)
  // The pane body starts to the right of the list, so the browser is not covered.
  const body = await orcaPage.locator(`[data-tab-group-body-id="${groupId}"]`).boundingBox()
  expect(body!.x).toBeGreaterThanOrEqual(first.x + first.width - 1)

  for (const box of [first, second, third]) {
    expect(box.height).toBeCloseTo(32, 0)
  }
  await testInfo.attach('vertical-tabs', {
    body: await orcaPage.locator('.vertical-tab-strip').screenshot(),
    contentType: 'image/png'
  })
  const dropEdges = await rows.first().evaluate((row) => {
    const before = getComputedStyle(row, '::before')
    const after = getComputedStyle(row, '::after')
    return {
      before: { top: before.top, height: before.height },
      after: { bottom: after.bottom, height: after.height }
    }
  })
  expect(dropEdges).toEqual({
    before: { top: '0px', height: '2px' },
    after: { bottom: '0px', height: '2px' }
  })
  const activeIndicator = orcaPage.locator('.vertical-tab-strip .tab-active-indicator').first()
  const marker = await activeIndicator.boundingBox()
  expect(marker).not.toBeNull()
  expect(marker!.x).toBeCloseTo(first.x, 0)
  expect(marker!.width).toBeCloseTo(2, 0)

  await rows.nth(0).click()
  await expect
    .poll(async () => (await readGroup(orcaPage, worktreeId, groupId)).activeTabId)
    .toBe(tabIds[0])

  // Drag the last row onto the top half of the first row: it moves to the front.
  await orcaPage.mouse.move(third.x + 40, third.y + third.height / 2)
  await orcaPage.mouse.down()
  await orcaPage.mouse.move(third.x + 40, third.y - 10, { steps: 5 })
  await orcaPage.mouse.move(first.x + 40, first.y + 4, { steps: 10 })
  await orcaPage.mouse.up()
  await expect
    .poll(async () => (await readGroup(orcaPage, worktreeId, groupId)).tabOrder)
    .toEqual([tabIds[2], tabIds[0], tabIds[1]])
  // Reordering inside the list must not have split the pane.
  expect(
    await orcaPage.evaluate(
      (worktree) => window.__store!.getState().groupsByWorktree[worktree].length,
      worktreeId
    )
  ).toBe(2)

  // Why: dnd-kit swallows clicks for 50ms after a drop; a person never clicks that fast.
  await orcaPage.waitForTimeout(100)
  await strip.getByRole('button', { name: 'Show tabs on top' }).click()
  await expect
    .poll(async () => (await readGroup(orcaPage, worktreeId, groupId)).orientation)
    .toBe('horizontal')
  await expect(rows).toHaveCount(0)
})

test('keeps the vertical strip orientation across an app restart', async (// oxlint-disable-next-line no-empty-pattern -- This test owns both launches through the restart session.
{}, testInfo) => {
  test.setTimeout(180_000)
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')
  const session = createRestartSession(testInfo, { ORCA_BACKGROUND_LAUNCH: '1' })
  let app: ElectronApplication | null = null
  try {
    const first = await session.launch()
    app = first.app
    await attachRepoAndOpenTerminal(first.page, repoPath)
    await waitForSessionReady(first.page)
    const { worktreeId, groupId } = await createBrowserSplitWithTabs(first.page, 2)
    await first.page
      .locator(`[data-tab-group-strip-id="${groupId}"]`)
      .getByRole('button', { name: 'Show tabs on the side' })
      .click()
    await expect
      .poll(async () => (await readGroup(first.page, worktreeId, groupId)).orientation)
      .toBe('vertical')
    await session.close(app)
    app = null

    const second = await session.launch()
    app = second.app
    await waitForSessionReady(second.page)
    await expect
      .poll(() =>
        second.page.evaluate(
          ({ worktreeId, groupId }) =>
            window.__store
              ?.getState()
              .groupsByWorktree[worktreeId]?.find((group) => group.id === groupId)
              ?.tabStripOrientation,
          { worktreeId, groupId }
        )
      )
      .toBe('vertical')
    await second.page.evaluate(
      ({ worktreeId, groupId }) => {
        window.__store!.getState().setActiveWorktree(worktreeId)
        window.__store!.getState().focusGroup(worktreeId, groupId)
      },
      { worktreeId, groupId }
    )
    await expect(second.page.locator('.vertical-tab-strip [data-tab-id]')).toHaveCount(2)
    await expect(
      second.page
        .locator(`[data-tab-group-strip-id="${groupId}"]`)
        .getByRole('button', { name: 'Show tabs on top' })
    ).toBeVisible()
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
  }
})
