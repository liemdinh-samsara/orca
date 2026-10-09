import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService, join, listWorktrees, tmpdir } from '../orca-runtime-test-mocks.spec'
import type { WorktreeLineage, WorktreeMeta } from '../orca-runtime-test-mocks.spec'
import { makeWorktreeInfo, makeWorktreeMeta, store } from '../orca-runtime-test-fixtures.spec'

describe('OrcaRuntimeService manual lineage across repos of one project', () => {
  it('nests a workspace under a parent from another repo setup of the same project', async () => {
    const repos = ['repo-devbox', 'repo-mac'].map((id) => ({
      id,
      path: join(tmpdir(), id),
      displayName: id,
      badgeColor: 'blue' as const,
      addedAt: 1
    }))
    const childPath = join(repos[0].path, 'swissport')
    const parentPath = join(repos[1].path, 'peek')
    const childId = `repo-devbox::${childPath}`
    const parentId = `repo-mac::${parentPath}`
    const metaById: Record<string, WorktreeMeta> = {
      [childId]: makeWorktreeMeta({ instanceId: 'child-instance', projectId: 'github:acme/mono' }),
      [parentId]: makeWorktreeMeta({ instanceId: 'parent-instance', projectId: 'github:acme/mono' })
    }
    const setWorktreeLineage = vi.fn((_worktreeId: string, lineage: WorktreeLineage) => lineage)
    const runtimeStore = {
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
      setWorkspaceLineage: vi.fn()
    }
    vi.mocked(listWorktrees).mockImplementation(async (repoPath) => [
      ...(repoPath === repos[0].path ? [makeWorktreeInfo(childPath)] : []),
      ...(repoPath === repos[1].path ? [makeWorktreeInfo(parentPath)] : [])
    ])
    const runtime = new OrcaRuntimeService(runtimeStore as never)

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
})
