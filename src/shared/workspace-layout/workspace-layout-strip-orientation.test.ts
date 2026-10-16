import { describe, expect, it } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID } from '../execution-host'
import { loadWorkspaceLayout } from './workspace-layout-load'
import { saveWorkspaceLayout } from './workspace-layout-save'
import { pruneViewRecord } from './workspace-layout-view-prune'
import { GIT_KEY, addWorkspace, emptySession, leaf } from './workspace-layout-session.test-fixture'

function storedSession() {
  return addWorkspace(emptySession(), GIT_KEY, [
    { id: 'group-a', tabs: [{ id: 'tab-a', leaves: [[leaf(1)]] }] },
    { id: 'group-b', tabs: [{ id: 'tab-b', leaves: [[leaf(2)]] }] }
  ])
}

function withOrientation() {
  const session = storedSession()
  const groups = (session.tabGroups?.[GIT_KEY] ?? []).map((group) =>
    group.id === 'group-b' ? { ...group, tabStripOrientation: 'vertical' as const } : group
  )
  return { ...session, tabGroups: { ...session.tabGroups, [GIT_KEY]: groups } }
}

function load(session: ReturnType<typeof storedSession>) {
  let next = 0
  return loadWorkspaceLayout(LOCAL_EXECUTION_HOST_ID, session, {
    mintId: () => `minted-${++next}`,
    mintLeafId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`
  })
}

// Why: main loads and re-saves the session when it adds agent or browser tabs; a group's
// vertical tab strip must survive that round trip instead of reverting to horizontal.
describe('workspace layout tab strip orientation', () => {
  it('keeps each group orientation through load and save', () => {
    const loaded = load(withOrientation())
    expect(loaded.changes).toEqual([])
    const groups = saveWorkspaceLayout(loaded).tabGroups?.[GIT_KEY] ?? []
    expect(groups.find((group) => group.id === 'group-b')?.tabStripOrientation).toBe('vertical')
    expect(groups.find((group) => group.id === 'group-a')).not.toHaveProperty('tabStripOrientation')
  })

  it('keeps the orientation when the view is pruned', () => {
    const loaded = load(withOrientation())
    const view = pruneViewRecord(loaded.desktopView, loaded.layout)
    expect(view.groups[GIT_KEY]?.['group-b']?.tabStripOrientation).toBe('vertical')
  })
})
