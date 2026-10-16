import { describe, expect, it } from 'vitest'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { getWorktreeLineageGroupKey } from './worktree-list/grouping/group-keys'
import { getWorktreeRevealCollapsedGroupKeys } from './worktree-list/navigation/worktree-reveal-group-keys'
import { repo, worktree } from './worktree-list-groups-test-fixtures'

describe('getWorktreeRevealCollapsedGroupKeys across hosts', () => {
  it('reveals a collapsed local parent group for its same-project SSH child', () => {
    const parent: Worktree = {
      ...worktree,
      id: 'parent',
      instanceId: 'parent-instance',
      projectId: 'project-1',
      hostId: 'local'
    }
    const child: Worktree = {
      ...worktree,
      id: 'child',
      instanceId: 'child-instance',
      repoId: 'ssh-repo',
      projectId: 'project-1',
      hostId: 'ssh:box'
    }
    const lineage: WorktreeLineage = {
      worktreeId: child.id,
      worktreeInstanceId: 'child-instance',
      parentWorktreeId: parent.id,
      parentWorktreeInstanceId: 'parent-instance',
      origin: 'cli',
      capture: { source: 'explicit-cli-flag', confidence: 'explicit' },
      createdAt: 1
    }
    const parentKey = getWorktreeLineageGroupKey(parent)

    expect(
      getWorktreeRevealCollapsedGroupKeys({
        worktree: child,
        worktrees: [parent, child],
        worktreeLineageById: { child: lineage },
        repoMap: new Map([
          [repo.id, repo],
          [child.repoId, { ...repo, id: child.repoId, connectionId: 'box' }]
        ]),
        defaultHostId: 'local',
        hostScopedGroups: true,
        collapsedGroups: new Set(['host:ssh:box', parentKey]),
        groupBy: 'none',
        pinnedDisplayPolicy: 'single-location',
        prCache: null,
        workspaceStatuses: [],
        settings: null,
        projectGroups: []
      })
    ).toEqual(['host:ssh:box', parentKey])
  })
})
