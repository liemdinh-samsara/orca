import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type PaneSnapshot = {
  groupIds: string[]
  layout: unknown
  browserGroupIds: string[]
  orientationByGroup: Record<string, string | null>
}

async function readPanes(page: Page, worktreeId: string): Promise<PaneSnapshot> {
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

async function openNewBrowserTab(page: Page, groupId: string): Promise<void> {
  // Same action the tab strip "+" menu, Cmd+J and the menu shortcut run.
  await page.evaluate(
    (group) => window.__store!.getState().openNewBrowserTabInActiveWorkspace(group),
    groupId
  )
}

test('opens new browser tabs in a right-hand pane with vertical tabs', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  const terminalGroupId = await orcaPage.evaluate(
    (worktree) => window.__store!.getState().ensureWorktreeRootGroup(worktree),
    worktreeId
  )

  await openNewBrowserTab(orcaPage, terminalGroupId)
  await expect.poll(async () => (await readPanes(orcaPage, worktreeId)).groupIds).toHaveLength(2)
  const first = await readPanes(orcaPage, worktreeId)
  const sidePaneId = first.groupIds.find((id) => id !== terminalGroupId)!
  expect(first.layout).toMatchObject({
    type: 'split',
    direction: 'horizontal',
    first: { type: 'leaf', groupId: terminalGroupId },
    second: { type: 'leaf', groupId: sidePaneId }
  })
  expect(first.browserGroupIds).toEqual([sidePaneId])
  expect(first.orientationByGroup).toEqual({ [terminalGroupId]: null, [sidePaneId]: 'vertical' })
  await expect(orcaPage.locator('.vertical-tab-strip [data-tab-id]')).toHaveCount(1)

  // A second tab from the terminal pane reuses the side pane instead of splitting again.
  await openNewBrowserTab(orcaPage, terminalGroupId)
  await expect
    .poll(async () => (await readPanes(orcaPage, worktreeId)).browserGroupIds)
    .toEqual([sidePaneId, sidePaneId])

  // Opening from the side pane itself stays there.
  await openNewBrowserTab(orcaPage, sidePaneId)
  await expect
    .poll(async () => (await readPanes(orcaPage, worktreeId)).browserGroupIds)
    .toEqual([sidePaneId, sidePaneId, sidePaneId])
  expect((await readPanes(orcaPage, worktreeId)).groupIds).toHaveLength(2)
  await expect(orcaPage.locator('.vertical-tab-strip [data-tab-id]')).toHaveCount(3)
})
