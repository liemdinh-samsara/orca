import { describe, expect, it } from 'vitest'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { resolveChildWorkspacesToggleGroupKey } from './child-workspaces-toggle-target'
import { worktree as baseWorktree } from './worktree-list-groups-test-fixtures'

type ToggleState = Parameters<typeof resolveChildWorkspacesToggleGroupKey>[0]
type HoverDocument = NonNullable<Parameters<typeof resolveChildWorkspacesToggleGroupKey>[2]>

function worktree(id: string, overrides: Partial<Worktree> = {}): Worktree {
  return { ...baseWorktree, id, instanceId: `${id}-instance`, path: `/tmp/${id}`, ...overrides }
}

function lineage(child: Worktree, parent: Worktree): WorktreeLineage {
  return {
    worktreeId: child.id,
    worktreeInstanceId: child.instanceId ?? '',
    parentWorktreeId: parent.id,
    parentWorktreeInstanceId: parent.instanceId ?? '',
    origin: 'cli',
    capture: { source: 'explicit-cli-flag', confidence: 'explicit' },
    createdAt: 1
  }
}

function hoveredDocument(...hovered: Worktree[]): HoverDocument {
  const rows = hovered.map((row) => ({
    dataset: { worktreeId: row.id, worktreeHostIdentity: getWorktreeHostIdentity(row) }
  }))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only length, item() and dataset from the hovered-row query.
  return {
    activeElement: null,
    querySelectorAll: () => ({ length: rows.length, item: (index: number) => rows[index] ?? null })
  } as unknown as HoverDocument
}

function toggleState(args: {
  worktrees: Worktree[]
  lineageById?: Record<string, WorktreeLineage>
  active?: Worktree
}): ToggleState {
  return {
    activeWorktreeId: args.active?.id ?? null,
    activeWorkspaceExecutionHostId: args.active?.hostId ?? null,
    worktreeLineageById: args.lineageById ?? {},
    worktreesByRepo: { [baseWorktree.repoId]: args.worktrees }
  }
}

const parent = worktree('parent')
const child = worktree('child')

// Why: the fork's parent lookup no longer pre-filters by host, so these guard same-host preference.
describe('child workspace toggle host scoping', () => {
  it('does not fold an archived parent', () => {
    const archivedParent = { ...parent, isArchived: true }
    expect(
      resolveChildWorkspacesToggleGroupKey(
        toggleState({
          worktrees: [archivedParent, child],
          lineageById: { child: lineage(child, archivedParent) }
        }),
        new Set(['lineage:parent']),
        hoveredDocument(child)
      )
    ).toBeNull()
  })

  it('uses host-qualified keys and ignores same-id rows on another host', () => {
    const remoteParent = worktree('parent', { hostId: 'ssh:box' })
    const remoteChild = worktree('child', { hostId: 'ssh:box' })
    const remoteKey = `lineage:${getWorktreeHostIdentity(remoteParent)}`
    const state = toggleState({
      worktrees: [parent, remoteParent, remoteChild],
      lineageById: { child: lineage(remoteChild, remoteParent) },
      active: remoteChild
    })
    const resolve = (chips: ReadonlySet<string>, doc = hoveredDocument()): string | null =>
      resolveChildWorkspacesToggleGroupKey(state, chips, doc)

    expect(resolve(new Set([remoteKey]))).toBe(remoteKey)
    // Why: the local row sharing the parent's id has no chip of its own to fold.
    expect(resolve(new Set(['lineage:parent']))).toBeNull()
    expect(resolve(new Set([remoteKey]), hoveredDocument(remoteParent))).toBe(remoteKey)
  })
})

describe('cross-host child workspace toggles', () => {
  const localParent = worktree('local-parent', { hostId: 'local', projectId: 'project-1' })
  const sshChild = worktree('ssh-child', {
    hostId: 'ssh:box',
    repoId: 'ssh-repo',
    projectId: 'project-1'
  })
  const parentKey = `lineage:${getWorktreeHostIdentity(localParent)}`
  const chips = new Set([parentKey])

  it('folds the local same-project parent when the SSH child has no own chip', () => {
    const state = toggleState({
      worktrees: [localParent, sshChild],
      lineageById: { [sshChild.id]: lineage(sshChild, localParent) },
      active: sshChild
    })

    expect(resolveChildWorkspacesToggleGroupKey(state, chips, hoveredDocument(sshChild))).toBe(
      parentKey
    )
    expect(resolveChildWorkspacesToggleGroupKey(state, chips, hoveredDocument())).toBe(parentKey)
  })

  it('does not fold a local parent from a different project', () => {
    const unrelated = { ...localParent, projectId: 'project-2' }
    const state = toggleState({
      worktrees: [unrelated, sshChild],
      lineageById: { [sshChild.id]: lineage(sshChild, unrelated) }
    })

    expect(resolveChildWorkspacesToggleGroupKey(state, chips, hoveredDocument(sshChild))).toBeNull()
  })

  it('does not fold a recreated local parent through a stale instance', () => {
    const state = toggleState({
      worktrees: [{ ...localParent, instanceId: 'recreated' }, sshChild],
      lineageById: { [sshChild.id]: lineage(sshChild, localParent) }
    })

    expect(resolveChildWorkspacesToggleGroupKey(state, chips, hoveredDocument(sshChild))).toBeNull()
  })
})
