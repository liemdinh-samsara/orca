// Proof spec template. Copy to tests/e2e/zz-proof-<slug>.spec.ts, keep it untracked, and run it
// through scripts/capture-before-after.sh. The same file runs against the BEFORE and AFTER builds,
// so only use store actions and UI that exist in both; assert nothing, just record what happened.
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const outDir = process.env.PROOF_DIR ?? tmpdir()
const label = process.env.PROOF_LABEL ?? 'shot'

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(outDir, `${label}-${name}.png`) })
}

function record(name: string, value: unknown): void {
  writeFileSync(path.join(outDir, `${label}-${name}.json`), JSON.stringify(value, null, 2))
}

test('proof screenshots', async ({ orcaPage }) => {
  test.setTimeout(180_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)

  // --- Scenario: replace with the user-visible flow the change affects. -------------------
  // Drive it the way a person would (the same store action a button calls, or the UI itself).
  // Example from the "browser tabs open in a right pane" change:
  //
  //   const groupId = await orcaPage.evaluate(
  //     (w) => window.__store!.getState().ensureWorktreeRootGroup(w), worktreeId)
  //   await orcaPage.evaluate(
  //     (g) => window.__store!.getState().openNewBrowserTabInActiveWorkspace(g), groupId)
  //
  // Settings pages: state.openSettingsTarget({ pane: 'repo', repoId }); state.openSettingsPage()
  // ---------------------------------------------------------------------------------------

  // Record the state the screenshot is meant to show, so the report can quote numbers too.
  record(
    'state',
    await orcaPage.evaluate((w) => {
      const state = window.__store!.getState()
      return {
        groups: (state.groupsByWorktree[w] ?? []).map((group) => ({
          id: group.id,
          tabs: group.tabOrder.length
        }))
      }
    }, worktreeId)
  )
  await shot(orcaPage, 'main')
})
