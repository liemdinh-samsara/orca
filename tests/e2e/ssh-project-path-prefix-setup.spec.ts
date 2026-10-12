import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
// Why one origin: both checkouts must land in one project for the devbox to count as its host.
const ORIGIN = 'https://github.com/orca-e2e/path-prefix-setup.git'
const SUFFIX = 'co/mono_projects'
const START = 'projects/ray'

function seedCheckout(root: string): void {
  mkdirSync(path.join(root, START), { recursive: true })
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  }
  git('init', '-q', '-b', 'main')
  writeFileSync(path.join(root, START, 'README.md'), 'mac\n')
  git('add', '-A')
  git('-c', 'user.email=e2e@test.local', '-c', 'user.name=e2e', 'commit', '-qm', 'init')
  git('remote', 'add', 'origin', ORIGIN)
}

async function openSetLocation(page: Page, hostLabel: string): Promise<void> {
  await page.evaluate(() => window.__store!.getState().openModal('new-workspace-composer', {}))
  await page.getByRole('button', { name: 'Browse run targets' }).first().click()
  await page.getByRole('button', { name: `Set project location on ${hostLabel}` }).click()
}

async function readDevboxSetup(
  page: Page,
  hostId: string
): Promise<{ repoId: string; path: string; startPath: string | null } | null> {
  return page.evaluate((hostId) => {
    const state = window.__store!.getState()
    const setup = state.projectHostSetups.find(
      (entry) => entry.projectId === 'github:orca-e2e/path-prefix-setup' && entry.hostId === hostId
    )
    const repo = state.repos.find((entry) => entry.id === setup?.repoId)
    return setup && repo
      ? { repoId: repo.id, path: repo.path, startPath: repo.workspaceStartPath ?? null }
      : null
  }, hostId)
}

test.use({ seedTestRepo: false })

test.describe('SSH project path prefix setup', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker-backed SSH tests.')
  test.skip(process.platform === 'win32', 'Docker SSH tests use POSIX ssh tooling.')

  test('sets a devbox up at the Mac path under its home and creates a sub workspace there', async ({
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
        'mkdir -p /tmp/unrelated && git -C /tmp/unrelated init -q -b main'
      )
      await waitForSessionReady(orcaPage)
      const localRepoId = await orcaPage.evaluate(
        async (repoPath) => {
          const result = await window.api.repos.add({ path: repoPath })
          if ('error' in result) {
            throw new Error(result.error)
          }
          await window.__store?.getState().fetchRepos()
          return result.repo.id
        },
        path.join(localRoot, START)
      )
      const remote = await connectDockerSshRelayTarget(orcaPage, target, {
        remotePath: '/tmp/unrelated',
        seedInitialTab: false
      })
      const hostId = `ssh:${remote.targetId}`
      const hostLabel = await orcaPage.evaluate(
        (targetId) => window.__store!.getState().sshTargetLabels.get(targetId) ?? targetId,
        remote.targetId
      )
      await expect
        .poll(
          () =>
            orcaPage.evaluate(async (repoId) => {
              const store = window.__store!
              await store.getState().fetchWorktrees(repoId)
              const main = (store.getState().worktreesByRepo[repoId] ?? []).find(
                (worktree) => worktree.isMainWorktree
              )
              if (main) {
                store.getState().setActiveWorktree(main.id)
              }
              return Boolean(main)
            }, localRepoId),
          { timeout: 60_000 }
        )
        .toBe(true)

      // Nothing at the mapped path yet: the dialog opens with that path filled in.
      await openSetLocation(orcaPage, hostLabel)
      const dialog = orcaPage.getByTestId('set-project-location-dialog')
      await expect(dialog.getByRole('textbox')).toHaveValue(`/root/${SUFFIX}/${START}`, {
        timeout: 30_000
      })
      await orcaPage.keyboard.press('Escape')
      await orcaPage.keyboard.press('Escape')
      await expect(dialog).toBeHidden()

      // With the checkout in place, one click sets the devbox up like the Mac.
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
      await openSetLocation(orcaPage, hostLabel)
      await expect
        .poll(() => readDevboxSetup(orcaPage, hostId), { timeout: 30_000 })
        .toEqual(expect.objectContaining({ path: `/root/${SUFFIX}`, startPath: START }))
      await expect(dialog).toBeHidden()

      const devbox = (await readDevboxSetup(orcaPage, hostId))!
      await orcaPage.getByRole('button', { name: /^Create workspace/ }).click()
      await expect
        .poll(
          () =>
            orcaPage.evaluate(
              (repoId) =>
                (window.__store!.getState().worktreesByRepo[repoId] ?? [])
                  .filter((worktree) => !worktree.isMainWorktree)
                  .map((worktree) => worktree.path),
              devbox.repoId
            ),
          { timeout: 60_000, message: 'no sub workspace was created on the devbox' }
        )
        .toEqual([`/root/${SUFFIX}`])
    } finally {
      cleanupDockerSshRelayTarget(target)
      rmSync(localRoot, { recursive: true, force: true })
    }
  })
})
