import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../types'
import { makeLineage, makeWorktree } from './worktrees-slice-test-fixtures'
import {
  createTestStore,
  mockApi,
  resetRemoteRuntimeMocks,
  resetWorktreeSliceModuleMemory,
  runtimeEnvironmentCall
} from './worktrees-slice-test-harness'

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }
}))

const PROJECT = 'github:acme/mono'
const macParent = makeWorktree({
  id: 'mac-repo::/Users/me/co/mono::workspace:peek',
  repoId: 'mac-repo',
  hostId: 'local',
  instanceId: 'mac-parent-instance',
  projectId: PROJECT
})
const devboxChild = makeWorktree({
  id: 'box-repo::/home/ubuntu/co/mono',
  repoId: 'box-repo',
  hostId: 'runtime:devbox-env',
  instanceId: 'devbox-child-instance',
  projectId: PROJECT
})
const devboxParent = makeWorktree({
  id: 'box-repo::/home/ubuntu/co/mono::workspace:other',
  repoId: 'box-repo',
  hostId: 'runtime:devbox-env',
  instanceId: 'devbox-parent-instance',
  projectId: PROJECT
})
const desktopEdge = makeLineage({
  worktreeId: devboxChild.id,
  worktreeInstanceId: 'devbox-child-instance',
  parentWorktreeId: macParent.id,
  parentWorktreeInstanceId: 'mac-parent-instance'
})

function storeWith(state: Partial<AppState>) {
  const store = createTestStore()
  const patch: Partial<AppState> = {
    worktreesByRepo: { 'mac-repo': [macParent], 'box-repo': [devboxChild, devboxParent] },
    ...state
  }
  store.setState(patch)
  return store
}

beforeEach(() => {
  resetWorktreeSliceModuleMemory()
  vi.clearAllMocks()
  resetRemoteRuntimeMocks()
})

describe('lineage across a Mac and its managed devbox host', () => {
  it('stores a devbox workspace nested under a Mac workspace on the desktop', async () => {
    mockApi.worktrees.setCrossHostLineage.mockResolvedValueOnce(desktopEdge)
    const store = storeWith({})

    await store.getState().assignWorktreeParent(devboxChild.id, { parentWorktreeId: macParent.id })

    expect(mockApi.worktrees.setCrossHostLineage).toHaveBeenCalledWith({
      child: {
        id: devboxChild.id,
        instanceId: 'devbox-child-instance',
        hostId: 'runtime:devbox-env',
        projectId: PROJECT
      },
      parent: {
        id: macParent.id,
        instanceId: 'mac-parent-instance',
        hostId: 'local',
        projectId: PROJECT
      }
    })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
    expect(store.getState().worktreeLineageById[devboxChild.id]).toEqual(desktopEdge)
  })

  it("clears the devbox's own edge before nesting the child under the Mac", async () => {
    const hostEdge = makeLineage({
      worktreeId: devboxChild.id,
      worktreeInstanceId: 'devbox-child-instance',
      parentWorktreeId: devboxParent.id,
      parentWorktreeInstanceId: 'devbox-parent-instance'
    })
    runtimeEnvironmentCall.mockResolvedValueOnce({
      id: 'rpc-clear-host-edge',
      ok: true,
      result: { worktree: { ...devboxChild, lineage: null } },
      _meta: { runtimeId: 'runtime-devbox' }
    })
    mockApi.worktrees.setCrossHostLineage.mockResolvedValueOnce(desktopEdge)
    const store = storeWith({ worktreeLineageById: { [devboxChild.id]: hostEdge } })

    await store.getState().assignWorktreeParent(devboxChild.id, { parentWorktreeId: macParent.id })

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
      selector: 'devbox-env',
      method: 'worktree.set',
      params: { worktree: `id:${devboxChild.id}`, noParent: true },
      timeoutMs: 15_000
    })
    expect(store.getState().worktreeLineageById[devboxChild.id]).toEqual(desktopEdge)
  })

  it('un-nests a desktop-held edge without asking the devbox', async () => {
    const store = storeWith({ worktreeLineageById: { [devboxChild.id]: desktopEdge } })

    await store.getState().updateWorktreeLineage(devboxChild.id, { noParent: true })

    expect(mockApi.worktrees.setCrossHostLineage).toHaveBeenCalledWith({
      clearChildId: devboxChild.id
    })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
    expect(store.getState().worktreeLineageById[devboxChild.id]).toBeUndefined()
  })

  it("keeps a desktop-held edge when the devbox's own lineage refreshes empty", async () => {
    runtimeEnvironmentCall.mockResolvedValueOnce({
      id: 'rpc-devbox-lineage',
      ok: true,
      result: { lineage: {}, workspaceLineage: {} },
      _meta: { runtimeId: 'runtime-devbox' }
    })
    const store = storeWith({ worktreeLineageById: { [devboxChild.id]: desktopEdge } })

    await store.getState().fetchWorktreeLineage({ executionHostId: 'runtime:devbox-env' })

    expect(store.getState().worktreeLineageById[devboxChild.id]).toEqual(desktopEdge)
  })

  it('drops a desktop-held edge once the desktop no longer lists it', async () => {
    mockApi.worktrees.listLineage.mockResolvedValueOnce({ lineage: {}, workspaceLineage: {} })
    const store = storeWith({ worktreeLineageById: { [devboxChild.id]: desktopEdge } })

    await store.getState().fetchWorktreeLineage({ executionHostId: 'local' })

    expect(store.getState().worktreeLineageById[devboxChild.id]).toBeUndefined()
  })
})
