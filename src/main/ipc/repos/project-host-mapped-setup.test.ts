import type * as FsModule from 'node:fs'
import type * as OsModule from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import type { ProjectHostSetup } from '../../../shared/project-types'

const mocks = vi.hoisted(() => {
  const connection: { current?: object } = { current: {} }
  return {
    connection,
    remoteDirs: new Set<string>(),
    setupExistingFolderOnHost: vi.fn(),
    buildProjectHostSetupResult: vi.fn()
  }
})

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof OsModule>()),
  homedir: () => '/Users/me'
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof FsModule>()),
  realpathSync: (path: string) => path
}))
vi.mock('../../ssh/ssh-target-registry', () => ({
  getSshConnectionManager: () => ({ getConnection: () => mocks.connection.current })
}))
vi.mock('../ssh-browse', () => ({
  resolveRemoteDirectory: async (_conn: object, path: string) =>
    mocks.remoteDirs.has(path) ? path : null
}))
vi.mock('./remote-home-path', () => ({
  resolveRemoteHomePath: async (_id: string, path: string) =>
    path === '~' ? '/home/ubuntu' : path.replace(/^~\//, '/home/ubuntu/')
}))
vi.mock('./project-host-existing-folder-setup', () => ({
  setupExistingFolderOnHost: mocks.setupExistingFolderOnHost,
  buildProjectHostSetupResult: mocks.buildProjectHostSetupResult
}))

import { setupProjectAtMappedPath } from './project-host-mapped-setup'

const PROJECT = 'github:acme/mono'
const DEVBOX = 'ssh:devbox4'

function makeStore(localRepo: Partial<Repo>, prefix?: string) {
  const repo: Repo = {
    id: 'mac',
    path: '/Users/me/co/mono',
    displayName: 'mono',
    badgeColor: '#000',
    addedAt: 1,
    kind: 'git',
    ...localRepo
  }
  const setup: ProjectHostSetup = {
    id: 'mac',
    projectId: PROJECT,
    hostId: 'local',
    repoId: 'mac',
    path: repo.path,
    displayName: 'mono',
    setupState: 'ready',
    setupMethod: 'imported-existing-folder',
    createdAt: 1,
    updatedAt: 1
  }
  const fake = {
    getProjectHostSetups: () => [setup],
    getRepo: (id: string) => (id === 'mac' ? repo : undefined),
    getSshTarget: () => (prefix ? { projectPathPrefix: prefix } : {}),
    updateRepo: vi.fn((id: string, updates: Partial<Repo>) => ({ ...repo, id, ...updates }))
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mapped setup reads only these members; folder registration is mocked.
  return { store: fake as unknown as Store, updateRepo: fake.updateRepo }
}

function registered(path: string, alreadyExisted = false) {
  return { result: { repo: { id: 'devbox-repo', path } }, alreadyExisted }
}

describe('setupProjectAtMappedPath', () => {
  beforeEach(() => {
    mocks.connection.current = {}
    mocks.remoteDirs = new Set()
    mocks.setupExistingFolderOnHost.mockReset()
    mocks.buildProjectHostSetupResult.mockReset().mockImplementation((_store, repo: Repo) => ({
      repo
    }))
  })

  it('sets the devbox up at the Mac path under its home, starting in the same subfolder', async () => {
    const { store, updateRepo } = makeStore({
      workspaceStartPath: 'projects/ray',
      inPlaceWorkspaces: true
    })
    mocks.remoteDirs.add('/home/ubuntu/co/mono/projects/ray')
    mocks.setupExistingFolderOnHost.mockResolvedValue(registered('/home/ubuntu/co/mono'))

    const outcome = await setupProjectAtMappedPath(store, {
      projectId: PROJECT,
      hostId: DEVBOX
    })

    expect(mocks.setupExistingFolderOnHost).toHaveBeenCalledWith(store, {
      projectId: PROJECT,
      hostId: DEVBOX,
      displayName: 'mono',
      path: '/home/ubuntu/co/mono',
      kind: 'git'
    })
    expect(updateRepo).toHaveBeenCalledWith('devbox-repo', {
      workspaceStartPath: 'projects/ray',
      inPlaceWorkspaces: true
    })
    expect(outcome.status).toBe('ready')
  })

  it('uses the host prefix configured on the SSH target', async () => {
    const { store, updateRepo } = makeStore({}, '/data/src')
    mocks.remoteDirs.add('/data/src/co/mono')
    mocks.setupExistingFolderOnHost.mockResolvedValue(registered('/data/src/co/mono', true))

    await setupProjectAtMappedPath(store, { projectId: PROJECT, hostId: DEVBOX })

    expect(mocks.setupExistingFolderOnHost.mock.calls[0][1].path).toBe('/data/src/co/mono')
    expect(updateRepo).not.toHaveBeenCalled()
  })

  it('offers the mapped path for manual setup when nothing is there', async () => {
    const outcome = await setupProjectAtMappedPath(
      makeStore({ workspaceStartPath: 'projects/ray' }).store,
      { projectId: PROJECT, hostId: DEVBOX }
    )

    expect(outcome).toEqual({
      status: 'unavailable',
      reason: 'not-found',
      suggestedPath: '/home/ubuntu/co/mono/projects/ray'
    })
    expect(mocks.setupExistingFolderOnHost).not.toHaveBeenCalled()
  })

  it('falls back to a folder project when the devbox copy is not a git checkout', async () => {
    const { store } = makeStore({ workspaceStartPath: 'projects/ray' })
    mocks.remoteDirs.add('/home/ubuntu/co/mono/projects/ray')
    mocks.setupExistingFolderOnHost
      .mockRejectedValueOnce(new Error('Not a valid git repository: /home/ubuntu/co/mono'))
      .mockResolvedValueOnce(registered('/home/ubuntu/co/mono/projects/ray'))

    const outcome = await setupProjectAtMappedPath(store, {
      projectId: PROJECT,
      hostId: DEVBOX
    })

    expect(mocks.setupExistingFolderOnHost.mock.calls[1][1]).toMatchObject({
      path: '/home/ubuntu/co/mono/projects/ray',
      kind: 'folder'
    })
    expect(outcome.status).toBe('ready')
  })

  it('does not guess for checkouts outside the home folder, other hosts, or offline devboxes', async () => {
    const outside = makeStore({ path: '/opt/mono' }).store
    expect(await setupProjectAtMappedPath(outside, { projectId: PROJECT, hostId: DEVBOX })).toEqual(
      { status: 'unavailable', reason: 'no-mappable-setup' }
    )
    expect(
      await setupProjectAtMappedPath(makeStore({}).store, {
        projectId: PROJECT,
        hostId: 'runtime:env'
      })
    ).toEqual({ status: 'unavailable', reason: 'unsupported-host' })
    mocks.connection.current = undefined
    expect(
      await setupProjectAtMappedPath(makeStore({}).store, { projectId: PROJECT, hostId: DEVBOX })
    ).toEqual({ status: 'unavailable', reason: 'not-connected' })
  })
})
