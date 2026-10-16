import { describe, expect, it } from 'vitest'
import { composeWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  getCyclicProjectedWorktreeLineageIds,
  getHostScopedWorktreeLineageInputs,
  getLineageRenderInfo,
  getSidebarLineageParent,
  getProjectedWorktreeLineageChildrenByParentId
} from './worktree-lineage-projection'
import { worktree as baseWorktree } from './worktree-list-groups-test-fixtures'

function makeWorktree(id: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    ...baseWorktree,
    id,
    repoId: 'repo-1',
    instanceId: `${id}-instance`,
    path: `/tmp/${id}`,
    branch: id,
    isMainWorktree: false,
    ...overrides
  }
}

function makeLineage(childId: string, parentId: string): WorktreeLineage {
  return {
    worktreeId: childId,
    worktreeInstanceId: `${childId}-instance`,
    parentWorktreeId: parentId,
    parentWorktreeInstanceId: `${parentId}-instance`,
    origin: 'cli',
    capture: { source: 'explicit-cli-flag', confidence: 'explicit' },
    createdAt: 1
  }
}

/**
 * A sidebar-scale fixture: one root with many children, mirroring the shape the
 * row builder scans on every store write.
 */
function buildFixture(childCount: number): {
  lineageById: Record<string, WorktreeLineage>
  worktreeMap: Map<string, Worktree>
} {
  const worktreeMap = new Map<string, Worktree>()
  const lineageById: Record<string, WorktreeLineage> = {}
  worktreeMap.set('root', makeWorktree('root'))
  for (let index = 0; index < childCount; index += 1) {
    const id = `child-${index}`
    worktreeMap.set(id, makeWorktree(id))
    lineageById[id] = makeLineage(id, 'root')
  }
  return { lineageById, worktreeMap }
}

describe('worktree lineage projection cache', () => {
  it('reuses the cyclic-id scan for an unchanged input pair', () => {
    const { lineageById, worktreeMap } = buildFixture(8)
    const first = getCyclicProjectedWorktreeLineageIds(lineageById, worktreeMap)
    const second = getCyclicProjectedWorktreeLineageIds(lineageById, worktreeMap)
    expect(second).toBe(first)
  })

  it('reuses the children projection for an unchanged input pair', () => {
    const { lineageById, worktreeMap } = buildFixture(8)
    const first = getProjectedWorktreeLineageChildrenByParentId(lineageById, worktreeMap)
    const second = getProjectedWorktreeLineageChildrenByParentId(lineageById, worktreeMap)
    expect(second).toBe(first)
    expect(first.get('root')?.map((worktree) => worktree.id)).toEqual([
      'child-0',
      'child-1',
      'child-2',
      'child-3',
      'child-4',
      'child-5',
      'child-6',
      'child-7'
    ])
  })

  it('rescans when either input is replaced', () => {
    const { lineageById, worktreeMap } = buildFixture(4)
    const baseline = getProjectedWorktreeLineageChildrenByParentId(lineageById, worktreeMap)

    const replacedLineage = { ...lineageById }
    expect(getProjectedWorktreeLineageChildrenByParentId(replacedLineage, worktreeMap)).not.toBe(
      baseline
    )

    const replacedWorktrees = new Map(worktreeMap)
    expect(getProjectedWorktreeLineageChildrenByParentId(lineageById, replacedWorktrees)).not.toBe(
      baseline
    )
  })

  it('reflects a removed lineage edge as soon as the record is replaced', () => {
    const { lineageById, worktreeMap } = buildFixture(2)
    expect(
      getProjectedWorktreeLineageChildrenByParentId(lineageById, worktreeMap).get('root')
    ).toHaveLength(2)

    const withoutFirstChild = { ...lineageById }
    delete withoutFirstChild['child-0']
    const reprojected = getProjectedWorktreeLineageChildrenByParentId(
      withoutFirstChild,
      worktreeMap
    )
    expect(reprojected.get('root')?.map((worktree) => worktree.id)).toEqual(['child-1'])
    const removedChild = worktreeMap.get('child-0')
    if (!removedChild) {
      throw new Error('Missing child fixture')
    }
    expect(
      getLineageRenderInfo(
        removedChild,
        withoutFirstChild,
        worktreeMap,
        getCyclicProjectedWorktreeLineageIds(withoutFirstChild, worktreeMap)
      ).state
    ).toBe('none')
  })

  it('still reports cycles from the cached scan', () => {
    const worktreeMap = new Map<string, Worktree>([
      ['a', makeWorktree('a')],
      ['b', makeWorktree('b')]
    ])
    const lineageById: Record<string, WorktreeLineage> = {
      a: makeLineage('a', 'b'),
      b: makeLineage('b', 'a')
    }
    const cyclic = getCyclicProjectedWorktreeLineageIds(lineageById, worktreeMap)
    expect([...cyclic].sort()).toEqual(['a', 'b'])
    expect(getCyclicProjectedWorktreeLineageIds(lineageById, worktreeMap)).toBe(cyclic)
    expect(getProjectedWorktreeLineageChildrenByParentId(lineageById, worktreeMap).size).toBe(0)
  })
})

function hostRows(...rows: Worktree[]): Map<string, Worktree> {
  return new Map(rows.map((row) => [composeWorktreeHostIdentity(row.hostId, row.id), row]))
}

class CountedHostRows extends Map<string, Worktree> {
  valuesCalls = 0

  override values() {
    this.valuesCalls += 1
    return super.values()
  }
}

describe('getHostScopedWorktreeLineageInputs', () => {
  it.each([true, false])('prefers own-host rows regardless of input order (%s)', (ownFirst) => {
    const local = makeWorktree('parent', { hostId: 'local' })
    const remote = makeWorktree('parent', { hostId: 'ssh:devbox', instanceId: 'remote-instance' })
    const rows = ownFirst ? [remote, local] : [local, remote]

    expect(
      getHostScopedWorktreeLineageInputs(rows, {}, 'ssh:devbox').worktreeMap.get('parent')
    ).toBe(remote)
  })

  it('fills missing ids from other hosts and keeps the first row for each id', () => {
    const child = makeWorktree('child', { hostId: 'ssh:devbox' })
    const first = makeWorktree('parent', { hostId: 'local' })
    const second = makeWorktree('parent', { hostId: 'ssh:second' })
    const other = makeWorktree('other', { hostId: 'ssh:second' })
    const result = getHostScopedWorktreeLineageInputs(
      [child, first, second, other],
      {},
      'ssh:devbox'
    )

    expect([...result.worktreeMap.values()]).toEqual([child, first, other])
  })

  it('carries projected lineage for a filled-in row only when its instance matches', () => {
    const matching = makeWorktree('matching', { hostId: 'local' })
    const stale = makeWorktree('stale', { hostId: 'local', instanceId: 'recreated' })
    const matchingLineage = makeLineage('matching', 'parent')
    const result = getHostScopedWorktreeLineageInputs(
      [matching, stale],
      { matching: matchingLineage, stale: makeLineage('stale', 'parent') },
      'ssh:devbox'
    )

    expect(result.worktreeMap.get('stale')).toBe(stale)
    expect(result.lineageById).toEqual({ matching: matchingLineage })
  })
})

describe('getSidebarLineageParent across hosts', () => {
  const child = makeWorktree('child', { hostId: 'ssh:box', projectId: 'project-1' })
  const parent = makeWorktree('parent', {
    hostId: 'local',
    repoId: 'repo-local',
    projectId: 'project-1'
  })
  const lineageById = { child: makeLineage('child', 'parent') }

  it('accepts a same-project parent on another known host and repository', () => {
    expect(getSidebarLineageParent(child, lineageById, hostRows(child, parent))).toBe(parent)
  })

  it('rejects a cross-host parent from a different instance', () => {
    const recreated = { ...parent, instanceId: 'recreated' }
    expect(getSidebarLineageParent(child, lineageById, hostRows(child, recreated))).toBeUndefined()
  })

  it('prefers the same-host candidate when both hosts publish the parent id', () => {
    const sameHost = { ...parent, hostId: child.hostId }
    expect(getSidebarLineageParent(child, lineageById, hostRows(parent, sameHost, child))).toBe(
      sameHost
    )
  })

  it('rejects a no-host child under a known-host parent', () => {
    const legacyChild = { ...child, hostId: undefined }
    expect(
      getSidebarLineageParent(legacyChild, lineageById, hostRows(legacyChild, parent))
    ).toBeUndefined()
  })

  it('accepts a no-host child under a no-host parent', () => {
    const legacyChild = { ...child, hostId: undefined }
    const legacyParent = { ...parent, hostId: undefined }
    expect(
      getSidebarLineageParent(legacyChild, lineageById, hostRows(legacyChild, legacyParent))
    ).toBe(legacyParent)
  })

  it('rejects a parent from another project', () => {
    const unrelated = { ...parent, projectId: 'project-2' }
    expect(getSidebarLineageParent(child, lineageById, hostRows(child, unrelated))).toBeUndefined()
  })

  it('reuses the id index per map and rebuilds it for a replacement map', () => {
    const rows = new CountedHostRows(hostRows(child, parent))
    expect(getSidebarLineageParent(child, lineageById, rows)).toBe(parent)
    expect(getSidebarLineageParent(child, lineageById, rows)).toBe(parent)
    expect(rows.valuesCalls).toBe(1)

    const recreated = { ...parent, instanceId: 'recreated' }
    const replacement = new CountedHostRows(hostRows(child, recreated))
    expect(getSidebarLineageParent(child, lineageById, replacement)).toBeUndefined()
    expect(getSidebarLineageParent(child, lineageById, replacement)).toBeUndefined()
    expect(replacement.valuesCalls).toBe(1)
  })
})
