import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { quotePosixShell } from '../../src/shared/shell-argument-quoting'
import {
  launchManagedWorkspace,
  skipUnlessManagedDockerHost,
  withManagedHost
} from './helpers/orcad-managed-workspace'

skipUnlessManagedDockerHost()

// Why: mirrors FLOATING_TERMINAL_WORKTREE_ID; specs avoid importing renderer/shared modules.
const FLOATING_WORKTREE_ID = 'global-floating-terminal'
// Why one origin: both checkouts must land in one project for the local one to be found.
const ORIGIN = 'https://github.com/orca-e2e/local-terminal-from-ssh.git'
const START = 'projects/ray'

function seedLocalCheckout(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'orca-local-terminal-'))
  mkdirSync(path.join(root, START), { recursive: true })
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  }
  git('init', '-q', '-b', 'main')
  writeFileSync(path.join(root, START, 'README.md'), 'local\n')
  git('add', '-A')
  git('-c', 'user.email=e2e@test.local', '-c', 'user.name=e2e', 'commit', '-qm', 'init')
  git('remote', 'add', 'origin', ORIGIN)
  return root
}

function readTabPtyId(page: Page, worktreeId: string, tabId: string): Promise<string | null> {
  return page.evaluate(
    ({ worktreeId, tabId }) =>
      window.__store!.getState().tabsByWorktree[worktreeId]?.find((tab) => tab.id === tabId)
        ?.ptyId ?? null,
    { worktreeId, tabId }
  )
}

function readTabText(page: Page, tabId: string): Promise<string> {
  return page.evaluate(
    (tabId) =>
      window.__paneManagers
        ?.get(tabId)
        ?.getPanes()
        .map((pane) => pane.serializeAddon?.serialize?.({ scrollback: 200 }) ?? '')
        .join('\n') ?? '',
    tabId
  )
}

// Why both: the menu item opens in this computer's checkout only once its project setup is ready.
function localCheckoutJoined(page: Page, worktreeId: string): Promise<boolean> {
  return page.evaluate((worktreeId) => {
    const state = window.__store!.getState()
    const projectId = Object.values(state.worktreesByRepo)
      .flat()
      .find((worktree) => worktree.id === worktreeId)?.projectId
    return Boolean(
      projectId &&
      state.projectHostSetups.some(
        (setup) =>
          setup.projectId === projectId && setup.hostId === 'local' && setup.setupState === 'ready'
      )
    )
  }, worktreeId)
}

test('opens a shell on this computer from a devbox workspace on its managed server', async (// oxlint-disable-next-line no-empty-pattern -- Owns app launch.
{}, testInfo) => {
  test.setTimeout(6 * 60_000)
  const localRoot = seedLocalCheckout()
  try {
    await withManagedHost(testInfo, async (fixture) => {
      fixture.host.exec!(
        `cd ${quotePosixShell(fixture.host.remoteRepoPath)} && git remote add origin ${quotePosixShell(ORIGIN)}`
      )
      let localRepoId = ''
      const workspace = await launchManagedWorkspace(fixture, {
        beforeSeed: async (page) => {
          localRepoId = await page.evaluate(
            async (repoPath) => {
              const result = await window.api.repos.add({ path: repoPath })
              if ('error' in result) {
                throw new Error(result.error)
              }
              return result.repo.id
            },
            path.join(localRoot, START)
          )
        }
      })
      const page = workspace.page
      const remoteId = workspace.seeded.worktreeId
      expect(localRepoId).not.toBe('')
      await expect
        .poll(() => localCheckoutJoined(page, remoteId), {
          timeout: 90_000,
          message: 'the devbox and local checkouts never joined one project'
        })
        .toBe(true)
      const remoteTabCount = await page.evaluate(
        (worktreeId) => window.__store!.getState().tabsByWorktree[worktreeId]?.length ?? 0,
        remoteId
      )

      await page.getByRole('button', { name: 'New tab' }).first().click()
      await page.getByRole('menuitem', { name: 'New Local Terminal' }).click()

      let floatingTabId: string | null = null
      await expect
        .poll(
          async () => {
            floatingTabId = await page.evaluate(
              (id) => window.__store!.getState().tabsByWorktree[id]?.at(-1)?.id ?? null,
              FLOATING_WORKTREE_ID
            )
            return floatingTabId ? readTabPtyId(page, FLOATING_WORKTREE_ID, floatingTabId) : null
          },
          { timeout: 30_000, message: 'the local terminal never started' }
        )
        .not.toBeNull()
      const localStart = realpathSync(path.join(localRoot, START))
      const tab = await page.evaluate(
        ({ worktreeId, tabId }) =>
          window
            .__store!.getState()
            .tabsByWorktree[worktreeId]?.find((entry) => entry.id === tabId),
        { worktreeId: FLOATING_WORKTREE_ID, tabId: floatingTabId! }
      )
      expect(tab?.startupCwd).toBe(localStart)
      await expect(page.locator('[data-floating-terminal-panel][aria-hidden="false"]')).toHaveCount(
        1
      )
      await page.screenshot({ path: testInfo.outputPath('local-terminal-from-devbox.png') })

      const ptyId = (await readTabPtyId(page, FLOATING_WORKTREE_ID, floatingTabId!))!
      await page.evaluate(
        (ptyId) => window.api.pty.write(ptyId, 'echo "cwd=$(pwd -P)"\r', 'driving'),
        ptyId
      )
      await expect
        .poll(() => readTabText(page, floatingTabId!), { timeout: 30_000 })
        .toContain(`cwd=${localStart}`)

      // The devbox workspace stays where it was: still active, no tab added to it.
      expect(
        await page.evaluate((worktreeId) => {
          const state = window.__store!.getState()
          return {
            active: state.activeWorktreeId === worktreeId,
            tabs: state.tabsByWorktree[worktreeId]?.length ?? 0
          }
        }, remoteId)
      ).toEqual({ active: true, tabs: remoteTabCount })
    })
  } finally {
    rmSync(localRoot, { recursive: true, force: true })
  }
})
