import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeTestStores,
  createStore,
  makeRepo,
  testState,
  writeDataFile
} from './persistence-test-harness'

vi.mock('electron', () => ({ app: { getPath: () => testState.dir } }))
vi.mock('./telemetry/client', () => ({ track: vi.fn() }))

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'orca-in-place-default-'))
})
afterEach(async () => {
  await closeTestStores()
  rmSync(testState.dir, { recursive: true, force: true })
})

describe('Store.addRepo in-place default', () => {
  it('defaults a new git repo to in-place workspaces and persists it across reloads', async () => {
    const store = createStore()
    const added = makeRepo({ kind: 'git' })
    store.addRepo(added)
    expect(added.inPlaceWorkspaces).toBe(true)
    expect(store.getRepo(added.id)?.inPlaceWorkspaces).toBe(true)
    store.flush()
    await closeTestStores()
    expect(createStore().getRepo(added.id)?.inPlaceWorkspaces).toBe(true)
  })

  it('preserves and persists an explicitly disabled in-place mode', async () => {
    const store = createStore()
    const added = makeRepo({ kind: 'git', inPlaceWorkspaces: false })
    store.addRepo(added)
    expect(store.getRepo(added.id)?.inPlaceWorkspaces).toBe(false)
    store.flush()
    await closeTestStores()
    expect(createStore().getRepo(added.id)?.inPlaceWorkspaces).toBe(false)
  })

  it('leaves folder projects without the git workspace flag', () => {
    const store = createStore()
    const added = makeRepo({ kind: 'folder' })
    store.addRepo(added)
    expect(added.inPlaceWorkspaces).toBeUndefined()
    expect(store.getRepo(added.id)?.inPlaceWorkspaces).toBeUndefined()
  })

  it('does not apply the new-project default to existing persisted git projects', () => {
    writeDataFile({
      repos: [
        makeRepo({ kind: 'git' }),
        makeRepo({ id: 'disabled', path: '/disabled', kind: 'git', inPlaceWorkspaces: false })
      ]
    })
    const store = createStore()
    expect(store.getRepo('r1')?.inPlaceWorkspaces).toBeUndefined()
    expect(store.getRepo('disabled')?.inPlaceWorkspaces).toBe(false)
  })
})
