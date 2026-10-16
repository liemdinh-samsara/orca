import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SshTarget } from '../../shared/ssh-types'
import {
  closeTestStores,
  createStore,
  readDataFile,
  testState,
  writeDataFile
} from '../persistence-test-harness'
import { SshConnectionStore } from '../ssh/ssh-connection-store'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const target: SshTarget = {
  id: 'ssh-devbox',
  label: 'Devbox',
  host: 'devbox.example.test',
  username: 'dev',
  port: 22,
  projectPathPrefix: '/srv/team projects'
}

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'orca-project-prefix-'))
})

afterEach(async () => {
  await closeTestStores()
  rmSync(testState.dir, { recursive: true, force: true })
})

describe('SSH project path prefix persistence', () => {
  it('keeps the prefix through registration, normalization, and a fresh store load', () => {
    const store = createStore()
    store.addSshTarget(target)

    expect(store.getSshTargets()).toEqual([{ ...target, configHost: target.label }])
    store.flush()
    expect(readDataFile()).toMatchObject({ sshTargets: [target] })

    const reloaded = createStore()
    expect(reloaded.getSshTarget(target.id)).toMatchObject({ ...target, configHost: target.label })
  })

  it('retains the prefix while normalizing older persisted target rows', () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {},
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {},
      sshTargets: [
        { ...target, remoteWorkspaceSyncEnabled: true, remoteWorkspaceSyncGracePeriodSeconds: 0 }
      ]
    })
    const store = createStore()

    expect(store.getSshTarget(target.id)).toMatchObject({
      projectPathPrefix: target.projectPathPrefix,
      configHost: target.label,
      relayGracePeriodSeconds: 0
    })
    expect(store.getSshTarget(target.id)).not.toHaveProperty('remoteWorkspaceSyncEnabled')
    store.flush()

    expect(createStore().getSshTarget(target.id)?.projectPathPrefix).toBe(target.projectPathPrefix)
  })

  it('preserves the prefix when updating an unrelated endpoint field', () => {
    const store = createStore()
    store.addSshTarget(target)
    const connections = new SshConnectionStore(store)

    expect(connections.updateTarget(target.id, { port: 2222 })).toMatchObject({
      port: 2222,
      projectPathPrefix: target.projectPathPrefix
    })
    store.flush()

    expect(createStore().getSshTarget(target.id)).toMatchObject({
      port: 2222,
      projectPathPrefix: target.projectPathPrefix
    })
  })

  it('replaces an explicitly updated prefix and persists the new location', () => {
    const store = createStore()
    store.addSshTarget(target)
    const connections = new SshConnectionStore(store)

    expect(
      connections.updateTarget(target.id, { projectPathPrefix: '/opt/projects' })
    ).toMatchObject({
      host: target.host,
      projectPathPrefix: '/opt/projects'
    })
    store.flush()

    expect(createStore().getSshTarget(target.id)?.projectPathPrefix).toBe('/opt/projects')
  })

  it.each([undefined, ''])('persists an explicitly cleared prefix (%s)', (projectPathPrefix) => {
    const store = createStore()
    store.addSshTarget(target)
    const connections = new SshConnectionStore(store)

    expect(connections.updateTarget(target.id, { projectPathPrefix })?.projectPathPrefix).toBe(
      projectPathPrefix
    )
    store.flush()

    expect(createStore().getSshTarget(target.id)?.projectPathPrefix).toBe(projectPathPrefix)
  })
})
