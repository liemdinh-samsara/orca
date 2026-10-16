import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import type { TabGroup } from '../../../../../shared/tab-types'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../shared/constants'
import {
  createTestStore,
  makeTabGroup,
  makeUnifiedTab,
  makeWorktree,
  seedStore
} from '../store-test-helpers'
import { createStoreCascadesMockApi } from '../store-cascades-test-harness'
import { placeInBrowserSidePane } from './browser-side-pane-placement'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))
vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  restorePtyDataHandlersAfterFailedShutdown: vi.fn(),
  unregisterPtyDataHandlers: vi.fn(() => [])
}))
vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return { ...actual, detectAgentStatusFromTitle: vi.fn().mockReturnValue(null) }
})

createStoreCascadesMockApi()

const WT = 'repo1::/path/wt-side-pane'
const LEFT = 'left'
const RIGHT = 'right'
type Store = ReturnType<typeof createTestStore>

function seedRightPane(store: Store, tabStripOrientation?: TabGroup['tabStripOrientation']): void {
  store.setState((state) => ({
    groupsByWorktree: {
      [WT]: [
        ...state.groupsByWorktree[WT],
        makeTabGroup({ id: RIGHT, worktreeId: WT, tabStripOrientation })
      ]
    },
    layoutByWorktree: {
      [WT]: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: LEFT },
        second: { type: 'leaf', groupId: RIGHT }
      }
    }
  }))
}

describe('browser side-pane placement', () => {
  let store: Store

  beforeEach(() => {
    store = createTestStore()
    seedStore(store, {
      worktreesByRepo: { repo1: [makeWorktree({ id: WT, repoId: 'repo1' })] },
      activeWorktreeId: WT,
      activeGroupIdByWorktree: { [WT]: LEFT },
      groupsByWorktree: {
        [WT]: [
          makeTabGroup({
            id: LEFT,
            worktreeId: WT,
            activeTabId: 'terminal',
            tabOrder: ['terminal']
          })
        ]
      },
      unifiedTabsByWorktree: {
        [WT]: [makeUnifiedTab({ id: 'terminal', worktreeId: WT, groupId: LEFT })]
      },
      layoutByWorktree: { [WT]: { type: 'leaf', groupId: LEFT } }
    })
  })

  it('splits a right pane off a lone terminal and gives only the new pane vertical tabs', () => {
    const workspace = store.getState().createBrowserTab(WT, 'https://example.com', {
      placement: 'side-pane'
    })
    const state = store.getState()
    const browserTab = state.unifiedTabsByWorktree[WT]?.find(
      (tab) => tab.entityId === workspace.id && tab.contentType === 'browser'
    )
    expect(browserTab).toBeDefined()
    const rightGroupId = browserTab?.groupId
    expect(rightGroupId).toEqual(expect.any(String))
    expect(rightGroupId).not.toBe(LEFT)
    expect(state.groupsByWorktree[WT]).toHaveLength(2)
    expect(state.layoutByWorktree[WT]).toMatchObject({
      type: 'split',
      direction: 'horizontal',
      first: { type: 'leaf', groupId: LEFT },
      second: { type: 'leaf', groupId: rightGroupId }
    })
    expect(state.groupsByWorktree[WT]?.find((group) => group.id === rightGroupId)).toMatchObject({
      tabStripOrientation: 'vertical',
      tabOrder: [browserTab?.id]
    })
    expect(state.groupsByWorktree[WT]?.find((group) => group.id === LEFT)).toMatchObject({
      tabOrder: ['terminal']
    })
    expect(
      state.groupsByWorktree[WT]?.find((group) => group.id === LEFT)?.tabStripOrientation
    ).toBeUndefined()
  })

  it('reuses an existing right pane and defaults its unset tab orientation to vertical', () => {
    seedRightPane(store)
    const layout = store.getState().layoutByWorktree[WT]

    expect(placeInBrowserSidePane(store.getState, WT, undefined)).toBe(RIGHT)

    expect(store.getState().groupsByWorktree[WT]).toHaveLength(2)
    expect(store.getState().layoutByWorktree[WT]).toEqual(layout)
    expect(
      store.getState().groupsByWorktree[WT]?.find((group) => group.id === RIGHT)
    ).toMatchObject({
      tabStripOrientation: 'vertical'
    })
    expect(
      store.getState().groupsByWorktree[WT]?.find((group) => group.id === LEFT)?.tabStripOrientation
    ).toBeUndefined()
  })

  it.each(['horizontal', 'vertical'] as const)(
    'keeps the explicit %s tab orientation the user chose on the side pane',
    (orientation) => {
      seedRightPane(store, orientation)
      const setOrientation = vi.spyOn(store.getState(), 'setTabGroupStripOrientation')

      expect(placeInBrowserSidePane(store.getState, WT, undefined)).toBe(RIGHT)

      expect(
        store.getState().groupsByWorktree[WT]?.find((group) => group.id === RIGHT)
      ).toMatchObject({
        tabStripOrientation: orientation
      })
      expect(setOrientation).not.toHaveBeenCalled()
    }
  )

  it('does not set an orientation on a left pane that already shows a browser', () => {
    seedRightPane(store)
    store.setState({
      unifiedTabsByWorktree: {
        [WT]: [
          makeUnifiedTab({ id: 'browser', worktreeId: WT, groupId: LEFT, contentType: 'browser' })
        ]
      }
    })
    const before = store.getState().groupsByWorktree[WT]
    const setOrientation = vi.spyOn(store.getState(), 'setTabGroupStripOrientation')

    expect(placeInBrowserSidePane(store.getState, WT, undefined)).toBe(LEFT)

    expect(store.getState().groupsByWorktree[WT]).toEqual(before)
    expect(setOrientation).not.toHaveBeenCalled()
  })

  it.each([undefined, LEFT])(
    'returns the requested group %s unchanged for the floating terminal worktree',
    (requestedGroupId) => {
      store.setState({
        groupsByWorktree: {
          [FLOATING_TERMINAL_WORKTREE_ID]: [
            makeTabGroup({ id: LEFT, worktreeId: FLOATING_TERMINAL_WORKTREE_ID })
          ]
        },
        activeGroupIdByWorktree: { [FLOATING_TERMINAL_WORKTREE_ID]: LEFT },
        unifiedTabsByWorktree: {
          [FLOATING_TERMINAL_WORKTREE_ID]: [
            makeUnifiedTab({
              id: 'floating-terminal',
              worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
              groupId: LEFT
            })
          ]
        }
      })
      const split = vi.spyOn(store.getState(), 'createEmptySplitGroup')
      const setOrientation = vi.spyOn(store.getState(), 'setTabGroupStripOrientation')

      expect(
        placeInBrowserSidePane(store.getState, FLOATING_TERMINAL_WORKTREE_ID, requestedGroupId)
      ).toBe(requestedGroupId)
      expect(split).not.toHaveBeenCalled()
      expect(setOrientation).not.toHaveBeenCalled()
    }
  )

  it('returns the undefined requested group when no source group exists', () => {
    store.setState({ groupsByWorktree: {}, activeGroupIdByWorktree: {} })
    const split = vi.spyOn(store.getState(), 'createEmptySplitGroup')
    const setOrientation = vi.spyOn(store.getState(), 'setTabGroupStripOrientation')

    expect(placeInBrowserSidePane(store.getState, WT, undefined)).toBeUndefined()
    expect(split).not.toHaveBeenCalled()
    expect(setOrientation).not.toHaveBeenCalled()
  })

  it('falls back to the source group when creating a right split fails', () => {
    const createEmptySplitGroup = vi.fn(() => null)
    store.setState({ createEmptySplitGroup })
    const before = store.getState()

    expect(placeInBrowserSidePane(store.getState, WT, undefined)).toBe(LEFT)

    expect(createEmptySplitGroup).toHaveBeenCalledExactlyOnceWith(WT, LEFT, 'right')
    expect(store.getState().groupsByWorktree).toEqual(before.groupsByWorktree)
    expect(store.getState().layoutByWorktree).toEqual(before.layoutByWorktree)
  })
})
