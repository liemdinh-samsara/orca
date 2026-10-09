import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  cleanupDockerSshRelayTarget,
  execDockerSshRelayTargetCommand,
  shellQuote,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import { connectDockerSshRelayTarget } from './helpers/docker-ssh-relay-connection'
import { waitForSessionReady } from './helpers/store'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'
// Why one origin: Orca files both checkouts under one project, which is what lets them nest.
const ORIGIN = 'https://github.com/orca-e2e/cross-host-nesting.git'
const REMOTE_REPO = '/tmp/orca-cross-host-nesting'

function seedLocalRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-cross-host-nesting-'))
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@test.local')
  git('config', 'user.name', 'Orca E2E')
  writeFileSync(path.join(dir, 'README.md'), 'local checkout\n')
  git('add', 'README.md')
  git('commit', '-m', 'initial')
  git('remote', 'add', 'origin', ORIGIN)
  return dir
}

function seedRemoteRepo(target: DockerSshRelayTarget): void {
  execDockerSshRelayTargetCommand(
    target,
    [
      `rm -rf ${shellQuote(REMOTE_REPO)}`,
      `mkdir -p ${shellQuote(REMOTE_REPO)}`,
      `cd ${shellQuote(REMOTE_REPO)}`,
      'git init -b main',
      "printf 'remote checkout\\n' > README.md",
      'git add README.md',
      'git commit -m initial',
      `git remote add origin ${shellQuote(ORIGIN)}`
    ].join(' && ')
  )
}

async function readMainWorktree(
  page: Page,
  repoId: string
): Promise<{ id: string; projectId?: string; hostId?: string } | null> {
  return page.evaluate(async (repoId) => {
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    await store.getState().fetchWorktrees(repoId)
    const row = (store.getState().worktreesByRepo[repoId] ?? []).find(
      (worktree) => worktree.isMainWorktree
    )
    return row ? { id: row.id, projectId: row.projectId, hostId: row.hostId } : null
  }, repoId)
}

test.use({ seedTestRepo: false })

test.describe('SSH cross-host workspace nesting', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker-backed SSH tests.')
  test.skip(process.platform === 'win32', 'Docker SSH tests use POSIX ssh tooling.')

  test('nests an SSH workspace under a local workspace of the same project by drag', async ({
    orcaPage
  }, testInfo) => {
    test.setTimeout(300_000)
    const target = startDockerSshRelayTarget(testInfo)
    const localDir = seedLocalRepo()
    try {
      seedRemoteRepo(target)
      await waitForSessionReady(orcaPage)
      const localRepoId = await orcaPage.evaluate(async (repoPath) => {
        const result = await window.api.repos.add({ path: repoPath })
        if ('error' in result) {
          throw new Error(result.error)
        }
        await window.__store?.getState().fetchRepos()
        return result.repo.id
      }, localDir)
      const remote = await connectDockerSshRelayTarget(orcaPage, target, {
        remotePath: REMOTE_REPO,
        seedInitialTab: false
      })

      await expect
        .poll(
          async () => {
            const [local, ssh] = await Promise.all([
              readMainWorktree(orcaPage, localRepoId),
              readMainWorktree(orcaPage, remote.repoId)
            ])
            return local?.projectId && local.projectId === ssh?.projectId
          },
          { timeout: 90_000, message: 'both checkouts never joined one project' }
        )
        .toBe(true)
      const local = (await readMainWorktree(orcaPage, localRepoId))!
      const ssh = (await readMainWorktree(orcaPage, remote.repoId))!
      expect(local.hostId).toBe('local')
      expect(ssh.hostId).toMatch(/^ssh:/)
      await orcaPage.evaluate(() => window.__store!.getState().setGroupBy('repo'))

      const source = orcaPage.locator(`[data-worktree-drag-id="${ssh.id}"]`).first()
      const parentCard = orcaPage.locator(`[data-worktree-drag-id="${local.id}"]`).first()
      const parentContent = parentCard.locator('[data-worktree-card-parent-content]').first()
      await expect(source).toBeVisible({ timeout: 30_000 })
      await expect(parentContent).toBeVisible({ timeout: 30_000 })

      const from = (await source.boundingBox())!
      const to = (await parentContent.boundingBox())!
      await orcaPage.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await orcaPage.mouse.down()
      await orcaPage.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 12, {
        steps: 4
      })
      await orcaPage.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
      await expect(parentCard.locator('[data-worktree-lineage-drop-target]')).toHaveCount(1)
      await orcaPage.mouse.up()

      await expect
        .poll(
          () =>
            orcaPage.evaluate(
              (sshId) =>
                window.__store!.getState().worktreeLineageById[sshId]?.parentWorktreeId ?? null,
              ssh.id
            ),
          { timeout: 20_000 }
        )
        .toBe(local.id)
      await expect(parentCard.getByRole('button', { name: 'Hide 1 child workspace' })).toBeVisible({
        timeout: 10_000
      })
    } finally {
      cleanupDockerSshRelayTarget(target)
      rmSync(localDir, { recursive: true, force: true })
    }
  })
})
