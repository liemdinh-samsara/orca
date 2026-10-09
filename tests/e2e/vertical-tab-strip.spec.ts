import type { Page } from '@stablyai/playwright-test'
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

test('shows a pane tabs as a vertical list that activates and reorders', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const { worktreeId, groupId, tabIds } = await createBrowserSplitWithTabs(orcaPage, 3)
  const strip = orcaPage.locator(`[data-tab-group-strip-id="${groupId}"]`)

  await strip.getByRole('button', { name: 'Show tabs on the side' }).click()
  await expect
    .poll(async () => (await readGroup(orcaPage, worktreeId, groupId)).orientation)
    .toBe('vertical')

  const rows = orcaPage.locator('.vertical-tab-strip [data-tab-id]')
  await expect(rows).toHaveCount(3)
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
