import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

async function openSetLocation(page: Page, repoId: string, hostLabel: string): Promise<void> {
  await page.evaluate(
    (initialRepoId) =>
      window.__store!.getState().openModal('new-workspace-composer', { initialRepoId }),
    repoId
  )
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

test('sets a devbox up at the Mac path under its home and creates a sub workspace there', async (// oxlint-disable-next-line no-empty-pattern -- Owns app launch.
{}, testInfo) => {
  test.setTimeout(6 * 60_000)
  let localRoot: string | null = null
  try {
    await withManagedHost(testInfo, async (fixture) => {
      const exec = fixture.host.exec!
      const workspace = await launchManagedWorkspace(fixture)
      const page = workspace.page
      const hostId = `runtime:${workspace.environmentId}`
      const remoteHome = exec('printf %s "$HOME"').trim()
      const home = await workspace.app.evaluate(({ app }) => app.getPath('home'))
      localRoot = path.join(home, SUFFIX)
      seedCheckout(localRoot)
      const localRepoId = await page.evaluate(
        async (repoPath) => {
          const result = await window.api.repos.add({ path: repoPath })
          if ('error' in result) {
            throw new Error(result.error)
          }
          await window
            .__store!.getState()
            .fetchRepos({ runtimeEnvironmentId: null, throwOnError: true })
          return result.repo.id
        },
        path.join(localRoot, START)
      )
      const hostLabel = await page.evaluate(
        (targetId) => window.__store!.getState().sshTargetLabels.get(targetId) ?? targetId,
        workspace.seeded.targetId
      )
      await expect
        .poll(
          () =>
            page.evaluate(async (repoId) => {
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
      await openSetLocation(page, localRepoId, hostLabel)
      const dialog = page.getByTestId('set-project-location-dialog')
      await expect(dialog.getByRole('textbox')).toHaveValue(`${remoteHome}/${SUFFIX}/${START}`, {
        timeout: 30_000
      })
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()

      // With the checkout in place, one click sets the devbox up like the Mac.
      exec(
        [
          `mkdir -p ~/${SUFFIX}/${START}`,
          `cd ~/${SUFFIX}`,
          'git init -q -b main',
          `printf 'devbox\\n' > ${START}/README.md`,
          'git add -A && git -c user.email=e2e@test.local -c user.name=e2e commit -qm init',
          `git remote add origin ${quotePosixShell(ORIGIN)}`
        ].join(' && ')
      )
      await openSetLocation(page, localRepoId, hostLabel)
      await expect
        .poll(() => readDevboxSetup(page, hostId), { timeout: 30_000 })
        .toEqual(expect.objectContaining({ path: `${remoteHome}/${SUFFIX}`, startPath: START }))
      await expect(dialog).toBeHidden()
      await page.screenshot({ path: testInfo.outputPath('devbox-mapped-setup.png') })

      const devbox = (await readDevboxSetup(page, hostId))!
      await page.getByRole('button', { name: /^Create workspace/ }).click()
      await expect
        .poll(
          () =>
            page.evaluate(
              (repoId) =>
                (window.__store!.getState().worktreesByRepo[repoId] ?? [])
                  .filter((worktree) => !worktree.isMainWorktree)
                  .map((worktree) => worktree.path),
              devbox.repoId
            ),
          { timeout: 60_000, message: 'no sub workspace was created on the devbox' }
        )
        .toEqual([`${remoteHome}/${SUFFIX}`])
    })
  } finally {
    if (localRoot) {
      rmSync(localRoot, { recursive: true, force: true })
    }
  }
})
