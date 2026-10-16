import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('reopens a closed file from another editor tab context menu', async ({
  orcaPage,
  testRepoPath
}) => {
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  const files = [
    { filePath: join(testRepoPath, 'src', 'index.ts'), relativePath: 'src/index.ts' },
    {
      filePath: join(testRepoPath, 'src', 'diff-note-layout.ts'),
      relativePath: 'src/diff-note-layout.ts'
    }
  ]
  await orcaPage.evaluate(
    ({ worktreeId, files }) => {
      const state = window.__store!.getState()
      for (const file of files) {
        state.openFile(
          { ...file, worktreeId, language: 'typescript', mode: 'edit' },
          { preview: false }
        )
      }
    },
    { worktreeId, files }
  )

  const remainingTab = orcaPage.locator('[data-tab-id]').filter({ hasText: 'index.ts' })
  const closedTab = orcaPage.locator('[data-tab-id]').filter({ hasText: 'diff-note-layout.ts' })
  await expect(remainingTab).toBeVisible()
  await expect(closedTab).toBeVisible()
  await closedTab.hover()
  await closedTab.getByRole('button', { name: 'Close tab', exact: true }).click()
  await expect(closedTab).toHaveCount(0)

  await remainingTab.click({ button: 'right' })
  const reopen = orcaPage.getByRole('menuitem', { name: /Reopen Closed Tab/ })
  await expect(reopen).toBeEnabled()
  await reopen.click()

  await expect(closedTab).toBeVisible()
  await expect(remainingTab).toBeVisible()
  await expect(orcaPage.locator('.editor-header-path').first()).toContainText('diff-note-layout.ts')
})
