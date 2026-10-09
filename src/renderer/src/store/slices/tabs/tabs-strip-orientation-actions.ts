import type { TabsSlice, TabsSliceSet } from './tabs-slice-contract'

export function createTabsStripOrientationActions(
  set: TabsSliceSet
): Pick<TabsSlice, 'setTabGroupStripOrientation'> {
  return {
    setTabGroupStripOrientation: (worktreeId, groupId, orientation) =>
      set((state) => {
        const groups = state.groupsByWorktree[worktreeId] ?? []
        const current = groups.find((group) => group.id === groupId)
        if (
          !current ||
          (current.tabStripOrientation === 'vertical') === (orientation === 'vertical')
        ) {
          return state
        }
        return {
          groupsByWorktree: {
            ...state.groupsByWorktree,
            [worktreeId]: groups.map((group) =>
              group.id === groupId ? { ...group, tabStripOrientation: orientation } : group
            )
          }
        }
      })
  }
}
