import { describe, expect, it } from 'vitest'
import { parseWorkspaceSession } from './workspace-session-schema'

describe('workspace session tab strip orientation', () => {
  it.each([
    { persisted: 'vertical', expected: 'vertical' },
    { persisted: 'future-orientation', expected: undefined }
  ])('loads $persisted without dropping the group', ({ persisted, expected }) => {
    const result = parseWorkspaceSession({
      activeRepoId: null,
      activeWorktreeId: null,
      activeTabId: null,
      tabsByWorktree: {},
      terminalLayoutsByTabId: {},
      tabGroups: {
        w1: [
          {
            id: 'g1',
            worktreeId: 'w1',
            activeTabId: null,
            tabOrder: [],
            tabStripOrientation: persisted
          }
        ]
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('Expected a valid workspace session')
    }
    expect(result.value.tabGroups?.w1).toHaveLength(1)
    expect(result.value.tabGroups?.w1[0]).toMatchObject({
      id: 'g1',
      worktreeId: 'w1',
      tabOrder: []
    })
    expect(result.value.tabGroups?.w1[0].tabStripOrientation).toBe(expected)
  })
})
