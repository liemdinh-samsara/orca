import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Repo } from '../../shared/repo-types'
import { createRepoUpdateSchema } from '../../shared/rpc-contract/repo-update-params'
import { RuntimeRepositorySettingsController } from './runtime-repository-settings-controller'
import type { RuntimeStore } from './runtime-store-contract'

vi.mock('../ipc/filesystem-auth', () => ({ invalidateAuthorizedRootsCache: vi.fn() }))
vi.mock('../worktree-root-preparation', () => ({ prepareLocalWorktreeRootForRepo: vi.fn() }))

const schema = createRepoUpdateSchema({ repoSelector: z.string() })
function setup() {
  let repo: Repo = {
    id: 'repo-1',
    path: '/repo',
    displayName: 'repo',
    badgeColor: 'blue',
    addedAt: 0,
    kind: 'git',
    connectionId: 'ssh-1',
    workspaceStartPath: 'old/start'
  }
  const updateRepo = vi.fn((_id: string, updates: Partial<Repo>) => {
    repo = { ...repo, ...updates }
    return repo
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: updating these fields only calls updateRepo on the runtime store.
  const store = { updateRepo } as unknown as RuntimeStore
  const controller = new RuntimeRepositorySettingsController({
    getStore: () => store,
    resolveRepo: async () => repo,
    forgetTerminalTopology: vi.fn(),
    invalidateResolvedWorktrees: vi.fn(),
    invalidateWorktreeScan: vi.fn(),
    notifyReposChanged: vi.fn()
  })
  return { controller, updateRepo }
}

function rpcUpdates(updates: unknown) {
  const parsed = schema.parse({ repoSelector: 'id:repo-1', updates }).updates
  return {
    ...('inPlaceWorkspaces' in parsed ? { inPlaceWorkspaces: parsed.inPlaceWorkspaces } : {}),
    ...('workspaceStartPath' in parsed ? { workspaceStartPath: parsed.workspaceStartPath } : {})
  }
}

describe('runtime repository workspace settings through RPC', () => {
  it.each([true, false])(
    'accepts and persists inPlaceWorkspaces=%s and a start folder',
    async (inPlaceWorkspaces) => {
      const { controller, updateRepo } = setup()
      const result = await controller.update(
        'id:repo-1',
        rpcUpdates({ inPlaceWorkspaces, workspaceStartPath: 'packages/web' })
      )
      expect(updateRepo).toHaveBeenCalledWith('repo-1', {
        inPlaceWorkspaces,
        workspaceStartPath: 'packages/web'
      })
      expect(result).toMatchObject({ inPlaceWorkspaces, workspaceStartPath: 'packages/web' })
    }
  )

  // FORK BUG: omitUndefined drops the explicit start-folder clear before it reaches the store.
  it.fails('clears the persisted start folder when the RPC update explicitly supplies undefined', async () => {
    const { controller } = setup()
    const result = await controller.update(
      'id:repo-1',
      rpcUpdates({ workspaceStartPath: undefined })
    )
    expect(result.workspaceStartPath).toBeUndefined()
  })

  // FORK BUG: runtime updates do not normalize an empty start folder into a persisted clear.
  it.fails('clears the start folder when the RPC sends an empty string', async () => {
    const { controller } = setup()
    const result = await controller.update('id:repo-1', rpcUpdates({ workspaceStartPath: '' }))
    expect(result.workspaceStartPath).toBeUndefined()
  })

  // FORK BUG: runtime updates persist an escaping start folder without local IPC validation.
  it.fails.each(['../x', '/absolute'])(
    'ignores invalid start folder %s like local repos:update',
    async (workspaceStartPath) => {
      const { controller } = setup()
      const result = await controller.update('id:repo-1', rpcUpdates({ workspaceStartPath }))
      expect(result.workspaceStartPath).toBe('old/start')
    }
  )

  // FORK BUG: runtime updates persist whitespace and repeated separators without normalization.
  it.fails('normalizes the start folder like local repos:update', async () => {
    const { controller } = setup()
    const result = await controller.update(
      'id:repo-1',
      rpcUpdates({ workspaceStartPath: ' packages//./web/ ' })
    )
    expect(result.workspaceStartPath).toBe('packages/web')
  })
})
