import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from '@stablyai/playwright-test'
import { removeWorktreeViaStore } from './helpers/dead-terminal'
import { expect, test } from './helpers/orca-app'
import { openSidebarWorkspaceComposer } from './helpers/sidebar-project-dialog'
import { getActiveWorktreeId, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { createTerminalTabFromMenu } from './helpers/terminal-tab-menu'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { waitForPtyShellEcho } from './terminal-pty-readiness'

function listGitWorktreePaths(repoPath: string): string[] {
  return execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoPath,
    encoding: 'utf8'
  })
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
}

async function updateActiveRepo(
  page: Page,
  repoId: string,
  updates: { inPlaceWorkspaces?: boolean; workspaceStartPath?: string }
): Promise<void> {
  const updated = await page.evaluate(
    async ({ id, patch }) => (await window.__store?.getState().updateRepo(id, patch)) ?? false,
    { id: repoId, patch: updates }
  )
  expect(updated).toBe(true)
}

test('creates a workspace on the project checkout and starts terminals in the start folder', async ({
  orcaPage,
  testRepoPath
}) => {
  test.setTimeout(180_000)
  await waitForSessionReady(orcaPage)
  const rootWorktreeId = await waitForActiveWorktree(orcaPage)
  const repoId = rootWorktreeId.split('::')[0]
  const startFolder = `in-place-start-${Date.now()}`
  mkdirSync(join(testRepoPath, startFolder), { recursive: true })
  const worktreesBefore = listGitWorktreePaths(testRepoPath)
  let inPlaceWorktreeId: string | null = null

  try {
    await updateActiveRepo(orcaPage, repoId, {
      inPlaceWorkspaces: true,
      workspaceStartPath: startFolder
    })

    const name = `in-place-${Date.now()}`
    await openSidebarWorkspaceComposer(orcaPage)
    const dialog = orcaPage.getByRole('dialog', { name: /Create Workspace/i })
    await expect(dialog).toBeVisible()
    await dialog.getByPlaceholder(/Workspace name|Type a name/i).fill(name)
    await dialog.getByRole('button', { name: /Create Workspace/i }).click()
    await expect(dialog).toBeHidden({ timeout: 20_000 })

    await expect
      .poll(() => getActiveWorktreeId(orcaPage), { timeout: 30_000 })
      .toContain('::workspace:')
    const createdId = await getActiveWorktreeId(orcaPage)
    if (!createdId) {
      throw new Error('in-place workspace did not become active')
    }
    inPlaceWorktreeId = createdId
    await expect(
      orcaPage.locator(`[role="option"][data-worktree-id="${createdId}"]`)
    ).toContainText(name)
    // The root checkout stays listed next to the new entry, and git gained no worktree.
    await expect(
      orcaPage.locator(`[role="option"][data-worktree-id="${rootWorktreeId}"]`)
    ).toBeVisible()
    expect(listGitWorktreePaths(testRepoPath)).toEqual(worktreesBefore)

    await createTerminalTabFromMenu(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)
    const ptyId = await waitForActivePanePtyId(orcaPage)
    await waitForPtyShellEcho(orcaPage, ptyId, 15_000)
    await execInTerminal(orcaPage, ptyId, 'echo "START-$(basename "$PWD")"')
    await waitForTerminalOutput(orcaPage, `START-${startFolder}`)

    await removeWorktreeViaStore(orcaPage, createdId)
    inPlaceWorktreeId = null
    await expect(
      orcaPage.locator(`[role="option"][data-worktree-id="${rootWorktreeId}"]`)
    ).toBeVisible()
    // Forgetting the entry must leave the shared checkout and git's worktree list untouched.
    expect(existsSync(join(testRepoPath, startFolder))).toBe(true)
    expect(listGitWorktreePaths(testRepoPath)).toEqual(worktreesBefore)
  } finally {
    if (inPlaceWorktreeId) {
      await removeWorktreeViaStore(orcaPage, inPlaceWorktreeId).catch(() => undefined)
    }
    await updateActiveRepo(orcaPage, repoId, {
      inPlaceWorkspaces: false,
      workspaceStartPath: undefined
    }).catch(() => undefined)
    rmSync(join(testRepoPath, startFolder), { recursive: true, force: true })
  }
})

async function openComposerDialog(page: Page): Promise<Locator> {
  await openSidebarWorkspaceComposer(page)
  const dialog = page.getByRole('dialog', { name: /Create Workspace/i })
  await expect(dialog).toBeVisible()
  return dialog
}

async function closeComposerDialog(page: Page, dialog: Locator): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

test('composer hides the git-only fields for an in-place project', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  await waitForSessionReady(orcaPage)
  const rootWorktreeId = await waitForActiveWorktree(orcaPage)
  const repoId = rootWorktreeId.split('::')[0]

  try {
    // Control: the fixture project is a plain git project, so the git-only fields exist.
    await updateActiveRepo(orcaPage, repoId, { inPlaceWorkspaces: false })
    const gitDialog = await openComposerDialog(orcaPage)
    await expect(gitDialog.getByText(/Create From/i).first()).toBeAttached()
    await expect(gitDialog.getByLabel('Branch from', { exact: true })).toBeAttached()
    await expect(gitDialog.getByText('Branch name', { exact: true })).toBeAttached()
    await expect(gitDialog.getByText('Parent worktree', { exact: true })).toBeAttached()
    await expect(gitDialog.getByText('Only available for local Git projects.')).toHaveCount(0)
    await closeComposerDialog(orcaPage, gitDialog)

    await updateActiveRepo(orcaPage, repoId, { inPlaceWorkspaces: true })
    const inPlaceDialog = await openComposerDialog(orcaPage)
    await expect(inPlaceDialog.getByText(/Workspace name/i).first()).toBeAttached()
    await expect(inPlaceDialog.getByText(/Create From/i)).toHaveCount(0)
    await expect(inPlaceDialog.getByLabel('Branch from', { exact: true })).toHaveCount(0)
    await expect(inPlaceDialog.getByText('Branch name', { exact: true })).toHaveCount(0)
    await expect(inPlaceDialog.getByText('Parent worktree', { exact: true })).toHaveCount(0)
    // Sparse checkout stays listed but is disabled, like a folder project.
    await expect(inPlaceDialog.getByText('Only available for local Git projects.')).toBeAttached()
    await closeComposerDialog(orcaPage, inPlaceDialog)
  } finally {
    await updateActiveRepo(orcaPage, repoId, { inPlaceWorkspaces: false }).catch(() => undefined)
  }
})

test('project settings show the in-place switch and start folder', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  await waitForSessionReady(orcaPage)
  const rootWorktreeId = await waitForActiveWorktree(orcaPage)
  const repoId = rootWorktreeId.split('::')[0]
  const startFolder = 'services/api'

  try {
    await updateActiveRepo(orcaPage, repoId, {
      inPlaceWorkspaces: true,
      workspaceStartPath: startFolder
    })
    await orcaPage.evaluate((targetRepoId) => {
      const state = window.__store?.getState()
      state?.setSettingsSearchQuery('')
      state?.openSettingsTarget({ pane: 'repo', repoId: targetRepoId })
      state?.openSettingsPage()
    }, repoId)

    const repoSettings = orcaPage.locator(`[data-settings-section="repo-${repoId}"]`)
    await expect(repoSettings).toBeVisible({ timeout: 10_000 })
    const inPlaceSwitch = repoSettings.getByRole('switch', {
      name: 'Create workspaces without git worktrees'
    })
    await expect(inPlaceSwitch).toBeChecked()
    await expect(repoSettings.getByPlaceholder('Project root')).toHaveValue(startFolder)

    await inPlaceSwitch.click()
    await expect(inPlaceSwitch).not.toBeChecked()
    await expect
      .poll(() =>
        orcaPage.evaluate(
          (targetRepoId) =>
            window.__store?.getState().repos.find((repo) => repo.id === targetRepoId)
              ?.inPlaceWorkspaces,
          repoId
        )
      )
      .toBe(false)
  } finally {
    await updateActiveRepo(orcaPage, repoId, {
      inPlaceWorkspaces: false,
      workspaceStartPath: undefined
    }).catch(() => undefined)
    await orcaPage
      .evaluate(() => window.__store?.getState().setActiveView('terminal'))
      .catch(() => undefined)
  }
})
