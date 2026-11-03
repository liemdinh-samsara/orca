import { describe, expect, it, vi } from 'vitest'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import { writeCrossHostWorktreeLineage } from './cross-host-lineage'

const PROJECT = 'github:acme/mono'
const child = {
  id: 'box-repo::/home/ubuntu/co/mono',
  instanceId: 'child-instance',
  hostId: 'runtime:devbox' as const,
  projectId: PROJECT
}
const parent = {
  id: 'mac-repo::/Users/me/co/mono',
  instanceId: 'parent-instance',
  hostId: 'local' as const,
  projectId: PROJECT
}

function fakeStore(
  lineage: Record<string, WorktreeLineage> = {},
  meta: Record<string, Partial<WorktreeMeta>> = {}
) {
  return {
    getWorktreeLineage: vi.fn((id: string) => lineage[id]),
    getWorktreeMeta: vi.fn((id: string): Partial<WorktreeMeta> | undefined => meta[id]),
    setWorktreeLineage: vi.fn(
      (_target: unknown, record: WorktreeLineage): WorktreeLineage | undefined => record
    ),
    removeWorktreeLineage: vi.fn()
  }
}

describe('writeCrossHostWorktreeLineage', () => {
  it('records a manual edge from a devbox workspace to a Mac workspace', () => {
    const store = fakeStore()

    const written = writeCrossHostWorktreeLineage(store, { child, parent }, 42)

    expect(written).toEqual({
      worktreeId: child.id,
      worktreeInstanceId: 'child-instance',
      parentWorktreeId: parent.id,
      parentWorktreeInstanceId: 'parent-instance',
      origin: 'manual',
      capture: { source: 'manual-action', confidence: 'explicit' },
      createdAt: 42
    })
    expect(store.setWorktreeLineage).toHaveBeenCalledWith(
      { id: child.id, hostId: 'runtime:devbox' },
      written
    )
  })

  it("writes into the bucket the child's saved metadata already owns", () => {
    const store = fakeStore({}, { [child.id]: { hostId: 'ssh:devbox-target' } })

    writeCrossHostWorktreeLineage(store, { child, parent }, 1)

    expect(store.setWorktreeLineage).toHaveBeenCalledWith(
      { id: child.id, hostId: 'ssh:devbox-target' },
      expect.objectContaining({ parentWorktreeId: parent.id })
    )
  })

  it.each([
    ['the hosts match', { ...child, hostId: 'local' as const }, 'Same-host lineage'],
    ['the projects differ', { ...child, projectId: 'github:other/repo' }, 'within one project'],
    ['a project is missing', { ...child, projectId: undefined }, 'within one project']
  ])('refuses when %s', (_label, candidateChild, message) => {
    const store = fakeStore()
    expect(() => writeCrossHostWorktreeLineage(store, { child: candidateChild, parent })).toThrow(
      message
    )
    expect(store.setWorktreeLineage).not.toHaveBeenCalled()
  })

  it('refuses a parent that already descends from the child', () => {
    const store = fakeStore({
      [parent.id]: {
        worktreeId: parent.id,
        worktreeInstanceId: 'parent-instance',
        parentWorktreeId: child.id,
        parentWorktreeInstanceId: 'child-instance',
        origin: 'manual',
        capture: { source: 'manual-action', confidence: 'explicit' },
        createdAt: 1
      }
    })
    expect(() => writeCrossHostWorktreeLineage(store, { child, parent })).toThrow('cycle')
  })

  it('reports a store that will not take the record', () => {
    const store = fakeStore()
    store.setWorktreeLineage.mockReturnValueOnce(undefined)
    expect(() => writeCrossHostWorktreeLineage(store, { child, parent })).toThrow(
      'cannot record lineage'
    )
  })

  it('clears an edge from the bucket that holds it', () => {
    const store = fakeStore({}, { [child.id]: { hostId: 'ssh:devbox-target' } })

    expect(writeCrossHostWorktreeLineage(store, { clearChildId: child.id })).toBeNull()
    expect(store.removeWorktreeLineage).toHaveBeenCalledWith({
      id: child.id,
      hostId: 'ssh:devbox-target'
    })
  })
})
