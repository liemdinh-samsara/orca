import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService, join, listWorktrees, tmpdir } from '../orca-runtime-test-mocks.spec'
import type { WorktreeLineage, WorktreeMeta } from '../orca-runtime-test-mocks.spec'
import { makeWorktreeInfo, makeWorktreeMeta, store } from '../orca-runtime-test-fixtures.spec'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { Repo } from '../../../shared/repo-types'
import type { RuntimeStore } from '../runtime-store-contract'

function projectLineageScenario(childHostId?: ExecutionHostId, parentHostId?: ExecutionHostId) {
  const repos: Repo[] = ['repo-devbox', 'repo-mac'].map((id) => ({
    id,
    path: join(tmpdir(), id),
    displayName: id,
    badgeColor: 'blue',
    addedAt: 1
  }))
  const childPath = join(repos[0].path, 'swissport')
  const parentPath = join(repos[1].path, 'peek')
  const childId = `repo-devbox::${childPath}`
  const parentId = `repo-mac::${parentPath}`
  const metaById: Record<string, WorktreeMeta> = {
    [childId]: makeWorktreeMeta({
      instanceId: 'child-instance',
      projectId: 'github:acme/mono',
      hostId: childHostId
    }),
    [parentId]: makeWorktreeMeta({
      instanceId: 'parent-instance',
      projectId: 'github:acme/mono',
      hostId: parentHostId
    })
  }
  const setWorktreeLineage = vi.fn((_worktreeId: string, lineage: WorktreeLineage) => lineage)
  const setWorkspaceLineage = vi.fn<NonNullable<RuntimeStore['setWorkspaceLineage']>>()
  const runtimeStore: RuntimeStore = {
    ...store,
    getRepos: () => repos,
    getRepo: (id: string) => repos.find((repo) => repo.id === id),
    getAllWorktreeMeta: () => metaById,
    getWorktreeMeta: (worktreeId: string) => metaById[worktreeId],
    setWorktreeMeta: (worktreeId: string, meta: Partial<WorktreeMeta>) => {
      metaById[worktreeId] = { ...metaById[worktreeId], ...meta }
      return metaById[worktreeId]
    },
    getWorktreeLineage: () => undefined,
    setWorktreeLineage,
    setWorkspaceLineage
  }
  vi.mocked(listWorktrees).mockImplementation(async (repoPath) => [
    ...(repoPath === repos[0].path ? [makeWorktreeInfo(childPath)] : []),
    ...(repoPath === repos[1].path ? [makeWorktreeInfo(parentPath)] : [])
  ])
  const runtime = new OrcaRuntimeService(runtimeStore)

  return { runtime, childId, parentId, setWorktreeLineage, setWorkspaceLineage }
}

describe('OrcaRuntimeService manual lineage across repos of one project', () => {
  it('nests a workspace under a parent from another repo setup of the same project', async () => {
    const { runtime, childId, parentId, setWorktreeLineage } = projectLineageScenario()

    await runtime.updateManagedWorktreeMeta(`id:${childId}`, {
      lineage: { parentWorktree: `id:${parentId}` }
    })

    expect(setWorktreeLineage).toHaveBeenCalledWith(
      childId,
      expect.objectContaining({
        parentWorktreeId: parentId,
        parentWorktreeInstanceId: 'parent-instance'
      })
    )
  })

  it.each([
    { childHostId: 'local', parentHostId: 'ssh:target-a' },
    { childHostId: 'ssh:target-a', parentHostId: 'local' }
  ] as const)(
    'nests a $childHostId child under a same-project $parentHostId parent',
    async ({ childHostId, parentHostId }) => {
      const { runtime, childId, parentId, setWorktreeLineage, setWorkspaceLineage } =
        projectLineageScenario(childHostId, parentHostId)

      await runtime.updateManagedWorktreeMeta(`id:${childId}`, {
        lineage: { parentWorktree: `id:${parentId}` }
      })

      expect(setWorktreeLineage).toHaveBeenCalledExactlyOnceWith(
        childId,
        expect.objectContaining({
          worktreeId: childId,
          worktreeInstanceId: 'child-instance',
          parentWorktreeId: parentId,
          parentWorktreeInstanceId: 'parent-instance',
          capture: { source: 'manual-action', confidence: 'explicit' }
        })
      )
      expect(setWorkspaceLineage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          childWorkspaceKey: `worktree:${childId}`,
          parentWorkspaceKey: `worktree:${parentId}`,
          parentInstanceId: 'parent-instance'
        })
      )
    }
  )

  it('rejects a same-project parent on a paired runtime without writing lineage', async () => {
    const { runtime, childId, parentId, setWorktreeLineage, setWorkspaceLineage } =
      projectLineageScenario('local', 'runtime:paired-host')

    await expect(
      runtime.updateManagedWorktreeMeta(`id:${childId}`, {
        lineage: { parentWorktree: `id:${parentId}` }
      })
    ).rejects.toThrow(
      'Parent worktree must be on the same execution host, or belong to the same project.'
    )
    expect(setWorktreeLineage).not.toHaveBeenCalled()
    expect(setWorkspaceLineage).not.toHaveBeenCalled()
  })
})
