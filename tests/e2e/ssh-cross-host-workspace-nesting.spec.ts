import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { quotePosixShell } from '../../src/shared/shell-argument-quoting'
import {
  launchManagedWorkspace,
  relaunchManagedApp,
  skipUnlessManagedDockerHost,
  withManagedHost
} from './helpers/orcad-managed-workspace'

skipUnlessManagedDockerHost()

// Why one origin: Orca files both checkouts under one project, which is what lets them nest.
const ORIGIN = 'https://github.com/orca-e2e/cross-host-nesting.git'

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

type Row = { id: string; projectId?: string; hostId?: string }

function readRow(page: Page, worktreeId: string): Promise<Row | null> {
  return page.evaluate((worktreeId) => {
    for (const rows of Object.values(window.__store!.getState().worktreesByRepo)) {
      const row = rows.find((worktree) => worktree.id === worktreeId)
      if (row) {
        return { id: row.id, projectId: row.projectId, hostId: row.hostId }
      }
    }
    return null
  }, worktreeId)
}

function localMainWorktreeId(page: Page, repoId: string): Promise<string | null> {
  return page.evaluate(async (repoId) => {
    const store = window.__store!
    await store.getState().fetchWorktrees(repoId)
    return (
      (store.getState().worktreesByRepo[repoId] ?? []).find((row) => row.isMainWorktree)?.id ?? null
    )
  }, repoId)
}

function parentOf(page: Page, worktreeId: string): Promise<string | null> {
  return page.evaluate(
    (id) => window.__store!.getState().worktreeLineageById[id]?.parentWorktreeId ?? null,
    worktreeId
  )
}

test('nests a managed devbox workspace under a Mac workspace of the same project by drag', async (// oxlint-disable-next-line no-empty-pattern -- Owns app launch.
{}, testInfo) => {
  test.setTimeout(6 * 60_000)
  const localDir = seedLocalRepo()
  try {
    await withManagedHost(testInfo, async (fixture) => {
      fixture.host.exec!(
        `cd ${quotePosixShell(fixture.host.remoteRepoPath)} && git remote add origin ${quotePosixShell(ORIGIN)}`
      )
      let localRepoId = ''
      const workspace = await launchManagedWorkspace(fixture, {
        beforeSeed: async (page) => {
          localRepoId = await page.evaluate(async (repoPath) => {
            const result = await window.api.repos.add({ path: repoPath })
            if ('error' in result) {
              throw new Error(result.error)
            }
            return result.repo.id
          }, localDir)
        }
      })
      let page = workspace.page
      const childId = workspace.seeded.worktreeId
      const parentId = (await localMainWorktreeId(page, localRepoId))!
      await expect
        .poll(
          async () => {
            const [child, parent] = await Promise.all([
              readRow(page, childId),
              readRow(page, parentId)
            ])
            return Boolean(parent?.projectId && parent.projectId === child?.projectId)
          },
          { timeout: 90_000, message: 'both checkouts never joined one project' }
        )
        .toBe(true)
      expect((await readRow(page, childId))?.hostId).toBe(`runtime:${workspace.environmentId}`)
      expect((await readRow(page, parentId))?.hostId).toBe('local')
      await page.evaluate(() => window.__store!.getState().setGroupBy('repo'))

      // The devbox card sits in its own project group; drop it on the Mac card's body.
      const source = page.locator(`[data-worktree-drag-id="${childId}"]`).first()
      const parentCard = page.locator(`[data-worktree-drag-id="${parentId}"]`).first()
      const parentContent = parentCard.locator('[data-worktree-card-parent-content]').first()
      await expect(source).toBeVisible({ timeout: 30_000 })
      await expect(parentContent).toBeVisible({ timeout: 30_000 })
      const from = (await source.boundingBox())!
      const to = (await parentContent.boundingBox())!
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 12, { steps: 4 })
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
      await expect(parentCard.locator('[data-worktree-lineage-drop-target]')).toHaveCount(1)
      await page.mouse.up()

      await expect.poll(() => parentOf(page, childId), { timeout: 20_000 }).toBe(parentId)
      await expect(parentCard.getByRole('button', { name: 'Hide 1 child workspace' })).toBeVisible({
        timeout: 10_000
      })
      await page.screenshot({ path: testInfo.outputPath('cross-host-nested.png') })
      // The desktop holds the edge; the devbox's own lineage refresh must not wipe it.
      const desktopLineage = await page.evaluate(() => window.api.worktrees.listLineage())
      expect(desktopLineage.lineage[childId]?.parentWorktreeId).toBe(parentId)
      await page.evaluate(
        (hostId) => window.__store!.getState().fetchWorktreeLineage({ executionHostId: hostId }),
        `runtime:${workspace.environmentId}` as const
      )
      expect(await parentOf(page, childId)).toBe(parentId)

      page = await relaunchManagedApp(fixture)
      await page.evaluate(() => window.__store!.getState().setGroupBy('repo'))
      await expect.poll(() => parentOf(page, childId), { timeout: 60_000 }).toBe(parentId)
      await expect(
        page
          .locator(`[data-worktree-drag-id="${parentId}"]`)
          .first()
          .getByRole('button', { name: 'Hide 1 child workspace' })
      ).toBeVisible({ timeout: 30_000 })
    })
  } finally {
    rmSync(localDir, { recursive: true, force: true })
  }
})
