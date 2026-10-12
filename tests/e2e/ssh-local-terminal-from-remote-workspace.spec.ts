import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import {
  cleanupDockerSshRelayTarget,
  execDockerSshRelayTargetCommand,
  shellQuote,
  startDockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import { connectDockerSshRelayTarget } from './helpers/docker-ssh-relay-connection'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'
// Why: mirrors FLOATING_TERMINAL_WORKTREE_ID; specs avoid importing renderer/shared modules.
const FLOATING_WORKTREE_ID = 'global-floating-terminal'
// Why one origin: both checkouts must land in one project for the local one to be found.
const ORIGIN = 'https://github.com/orca-e2e/local-terminal-from-ssh.git'
const SUFFIX = 'co/mono_projects'
const START = 'projects/ray'

function seedCheckout(root: string): void {
  mkdirSync(path.join(root, START), { recursive: true })
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  }
  git('init', '-q', '-b', 'main')
  writeFileSync(path.join(root, START, 'README.md'), 'local\n')
  git('add', '-A')
  git('-c', 'user.email=e2e@test.local', '-c', 'user.name=e2e', 'commit', '-qm', 'init')
  git('remote', 'add', 'origin', ORIGIN)
}

async function readTabPtyId(page: Page, worktreeId: string, tabId: string): Promise<string | null> {
  return page.evaluate(
    ({ worktreeId, tabId }) =>
      window.__store!.getState().tabsByWorktree[worktreeId]?.find((tab) => tab.id === tabId)
        ?.ptyId ?? null,
    { worktreeId, tabId }
  )
}

async function readTabText(page: Page, tabId: string): Promise<string> {
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

test.use({ seedTestRepo: false })

test.describe('Local terminal from an SSH workspace', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker-backed SSH tests.')
  test.skip(process.platform === 'win32', 'Docker SSH tests use POSIX ssh tooling.')

  test('opens a shell on this computer in the local checkout of the project', async ({
    orcaPage,
    electronApp
  }, testInfo) => {
    test.setTimeout(300_000)
    const target = startDockerSshRelayTarget(testInfo)
    const home = await electronApp.evaluate(({ app }) => app.getPath('home'))
    const localRoot = path.join(home, SUFFIX)
    try {
      seedCheckout(localRoot)
      execDockerSshRelayTargetCommand(
        target,
        [
          `mkdir -p ~/${SUFFIX}/${START}`,
          `cd ~/${SUFFIX}`,
          'git init -q -b main',
          `printf 'devbox\\n' > ${START}/README.md`,
          'git add -A && git -c user.email=e2e@test.local -c user.name=e2e commit -qm init',
          `git remote add origin ${shellQuote(ORIGIN)}`
        ].join(' && ')
      )
      await waitForSessionReady(orcaPage)
      await orcaPage.evaluate(
        async (repoPath) => {
          const result = await window.api.repos.add({ path: repoPath })
          if ('error' in result) {
            throw new Error(result.error)
          }
          await window.__store?.getState().fetchRepos()
        },
        path.join(localRoot, START)
      )
      const remote = await connectDockerSshRelayTarget(orcaPage, target, {
        remotePath: `/root/${SUFFIX}`
      })
      const sshTabCount = await orcaPage.evaluate(
        (worktreeId) => window.__store!.getState().tabsByWorktree[worktreeId]?.length ?? 0,
        remote.worktreeId
      )

      await orcaPage.getByRole('button', { name: 'New tab' }).first().click()
      await orcaPage.getByRole('menuitem', { name: 'New Local Terminal' }).click()

      let floatingTabId: string | null = null
      await expect
        .poll(
          async () => {
            floatingTabId = await orcaPage.evaluate(
              (id) => window.__store!.getState().tabsByWorktree[id]?.at(-1)?.id ?? null,
              FLOATING_WORKTREE_ID
            )
            return floatingTabId
              ? readTabPtyId(orcaPage, FLOATING_WORKTREE_ID, floatingTabId)
              : null
          },
          { timeout: 30_000, message: 'the local terminal never started' }
        )
        .not.toBeNull()
      const localStart = realpathSync(path.join(localRoot, START))
      const tab = await orcaPage.evaluate(
        ({ worktreeId, tabId }) =>
          window
            .__store!.getState()
            .tabsByWorktree[worktreeId]?.find((entry) => entry.id === tabId),
        { worktreeId: FLOATING_WORKTREE_ID, tabId: floatingTabId! }
      )
      expect(tab?.startupCwd).toBe(localStart)
      await expect(
        orcaPage.locator('[data-floating-terminal-panel][aria-hidden="false"]')
      ).toHaveCount(1)

      const ptyId = (await readTabPtyId(orcaPage, FLOATING_WORKTREE_ID, floatingTabId!))!
      await orcaPage.evaluate(
        (ptyId) => window.api.pty.write(ptyId, 'echo "cwd=$(pwd -P)"\r', 'driving'),
        ptyId
      )
      await expect
        .poll(() => readTabText(orcaPage, floatingTabId!), { timeout: 30_000 })
        .toContain(`cwd=${localStart}`)

      // The SSH workspace stays where it was: still active, no tab added to it.
      expect(
        await orcaPage.evaluate((worktreeId) => {
          const state = window.__store!.getState()
          return {
            active: state.activeWorktreeId === worktreeId,
            tabs: state.tabsByWorktree[worktreeId]?.length ?? 0
          }
        }, remote.worktreeId)
      ).toEqual({ active: true, tabs: sshTabCount })
    } finally {
      cleanupDockerSshRelayTarget(target)
      rmSync(localRoot, { recursive: true, force: true })
    }
  })
})
