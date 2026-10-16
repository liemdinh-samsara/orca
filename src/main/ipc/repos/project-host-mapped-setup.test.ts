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
    realpathSync: vi.fn((path: string) => path),
    resolveRemoteHomePath: vi.fn(),
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
  realpathSync: mocks.realpathSync
}))
vi.mock('../../ssh/ssh-target-registry', () => ({
  getSshConnectionManager: () => ({ getConnection: () => mocks.connection.current })
}))
vi.mock('../ssh-browse', () => ({
  resolveRemoteDirectory: async (_conn: object, path: string) =>
    mocks.remoteDirs.has(path) ? path : null
}))
vi.mock('./remote-home-path', () => ({
  resolveRemoteHomePath: mocks.resolveRemoteHomePath
}))
vi.mock('./project-host-existing-folder-setup', () => ({
  setupExistingFolderOnHost: mocks.setupExistingFolderOnHost,
  buildProjectHostSetupResult: mocks.buildProjectHostSetupResult
}))

import { setupProjectAtMappedPath } from './project-host-mapped-setup'

const PROJECT = 'github:acme/mono'
const DEVBOX = 'ssh:devbox4'

function sourceSetup(overrides: Partial<ProjectHostSetup> = {}): ProjectHostSetup {
  return {
    id: 'other',
    projectId: PROJECT,
    hostId: 'ssh:other',
    repoId: 'other',
    path: '/srv/code/co/ssh-mono',
    displayName: 'mono',
    setupState: 'ready',
    setupMethod: 'imported-existing-folder',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function makeStore(
  localRepo: Partial<Repo>,
  prefix?: string,
  extraSetups: ProjectHostSetup[] = []
) {
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
    getProjectHostSetups: () => [...extraSetups, setup],
    getRepo: (id: string) => {
      const extra = extraSetups.find((entry) => entry.repoId === id)
      return id === 'mac' ? repo : extra ? { ...repo, id, path: extra.path } : undefined
    },
    getSshTarget: (id: string) => ({ projectPathPrefix: id === 'other' ? '/srv/code' : prefix }),
    updateRepo: vi.fn((id: string, updates: Partial<Repo>): Repo | null | undefined => ({
      ...repo,
      id,
      ...updates
    }))
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
    mocks.realpathSync.mockReset().mockImplementation((path: string) => path)
    mocks.resolveRemoteHomePath
      .mockReset()
      .mockImplementation(async (_id: string, path: string) =>
        path === '~' ? '/home/ubuntu' : path.replace(/^~\//, '/home/ubuntu/')
      )
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
    expect(outcome).toMatchObject({
      status: 'ready',
      alreadyExisted: false,
      result: { repo: { id: 'devbox-repo', workspaceStartPath: 'projects/ray' } }
    })
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

  it('prefers the local checkout even when a ready SSH setup is listed first', async () => {
    const { store } = makeStore({}, undefined, [sourceSetup()])
    mocks.remoteDirs.add('/home/ubuntu/co/mono')
    mocks.remoteDirs.add('/home/ubuntu/co/ssh-mono')
    mocks.setupExistingFolderOnHost.mockResolvedValue(registered('/home/ubuntu/co/mono'))

    await setupProjectAtMappedPath(store, { projectId: PROJECT, hostId: DEVBOX })

    expect(mocks.setupExistingFolderOnHost).toHaveBeenCalledTimes(1)
    expect(mocks.setupExistingFolderOnHost.mock.calls[0][1].path).toBe('/home/ubuntu/co/mono')
  })

  it('re-roots another SSH checkout from its own configured project prefix', async () => {
    const { store } = makeStore({ path: '/opt/mono' }, undefined, [sourceSetup()])
    mocks.remoteDirs.add('/home/ubuntu/co/ssh-mono')
    mocks.setupExistingFolderOnHost.mockResolvedValue(registered('/home/ubuntu/co/ssh-mono'))

    await setupProjectAtMappedPath(store, { projectId: PROJECT, hostId: DEVBOX })

    expect(mocks.resolveRemoteHomePath).toHaveBeenCalledWith('other', '/srv/code')
    expect(mocks.setupExistingFolderOnHost.mock.calls[0][1]).toMatchObject({
      path: '/home/ubuntu/co/ssh-mono',
      kind: 'git'
    })
  })

  it.each<{ label: string; overrides: Partial<ProjectHostSetup> }>([
    { label: 'not ready', overrides: { setupState: 'setting-up' as const } },
    { label: 'without a repo', overrides: { repoId: '' } },
    { label: 'on the target host', overrides: { hostId: DEVBOX } },
    { label: 'on a runtime host', overrides: { hostId: 'runtime:env' } },
    { label: 'for another project', overrides: { projectId: 'github:other/mono' } }
  ])('ignores a setup $label', async ({ overrides }) => {
    // Why: the candidate would map if its eligibility filter were removed.
    const candidate = sourceSetup({ path: '/home/ubuntu/co/mono', ...overrides })
    if (candidate.hostId === 'ssh:other') {
      candidate.path = '/srv/code/co/mono'
    }
    const { store, updateRepo } = makeStore({ path: '/opt/mono' }, undefined, [candidate])
    mocks.remoteDirs.add('/home/ubuntu/co/mono')

    expect(await setupProjectAtMappedPath(store, { projectId: PROJECT, hostId: DEVBOX })).toEqual({
      status: 'unavailable',
      reason: 'no-mappable-setup'
    })
    expect(mocks.setupExistingFolderOnHost).not.toHaveBeenCalled()
    expect(updateRepo).not.toHaveBeenCalled()
  })

  it('tries the canonical local home after the original home prefix', async () => {
    mocks.realpathSync.mockReturnValue('/private/Users/me')
    const { store } = makeStore({ path: '/private/Users/me/co/mono' })
    mocks.remoteDirs.add('/home/ubuntu/co/mono')
    mocks.setupExistingFolderOnHost.mockResolvedValue(registered('/home/ubuntu/co/mono'))

    await setupProjectAtMappedPath(store, { projectId: PROJECT, hostId: DEVBOX })

    expect(mocks.realpathSync).toHaveBeenCalledWith('/Users/me')
    expect(mocks.setupExistingFolderOnHost.mock.calls[0][1].path).toBe('/home/ubuntu/co/mono')
  })

  it('reports not-connected while the remote home remains unresolved', async () => {
    mocks.resolveRemoteHomePath.mockResolvedValue('~/unresolved')

    expect(
      await setupProjectAtMappedPath(makeStore({}).store, {
        projectId: PROJECT,
        hostId: DEVBOX
      })
    ).toEqual({ status: 'unavailable', reason: 'not-connected' })
    expect(mocks.setupExistingFolderOnHost).not.toHaveBeenCalled()
  })

  it('registers a folder project at its mapped start folder without mirroring settings', async () => {
    const { store, updateRepo } = makeStore({
      kind: 'folder',
      workspaceStartPath: 'projects/ray',
      inPlaceWorkspaces: true
    })
    const setup = registered('/home/ubuntu/co/mono/projects/ray')
    mocks.remoteDirs.add('/home/ubuntu/co/mono/projects/ray')
    mocks.setupExistingFolderOnHost.mockResolvedValue(setup)

    expect(await setupProjectAtMappedPath(store, { projectId: PROJECT, hostId: DEVBOX })).toEqual({
      status: 'ready',
      ...setup
    })
    expect(mocks.setupExistingFolderOnHost).toHaveBeenCalledTimes(1)
    expect(mocks.setupExistingFolderOnHost.mock.calls[0][1]).toMatchObject({
      path: '/home/ubuntu/co/mono/projects/ray',
      kind: 'folder'
    })
    expect(updateRepo).not.toHaveBeenCalled()
  })

  it('rethrows unrelated setup errors without retrying as a folder', async () => {
    const error = new Error('Permission denied')
    mocks.remoteDirs.add('/home/ubuntu/co/mono')
    mocks.setupExistingFolderOnHost.mockRejectedValue(error)

    await expect(
      setupProjectAtMappedPath(makeStore({}).store, {
        projectId: PROJECT,
        hostId: DEVBOX
      })
    ).rejects.toBe(error)
    expect(mocks.setupExistingFolderOnHost).toHaveBeenCalledTimes(1)
  })

  it('omits a start folder outside the registered root and an undefined in-place setting', async () => {
    const { store, updateRepo } = makeStore({ workspaceStartPath: 'projects/ray' })
    mocks.remoteDirs.add('/home/ubuntu/co/mono/projects/ray')
    mocks.setupExistingFolderOnHost.mockResolvedValue(registered('/home/ubuntu/elsewhere'))

    await setupProjectAtMappedPath(store, { projectId: PROJECT, hostId: DEVBOX })

    expect(updateRepo).toHaveBeenCalledWith('devbox-repo', {})
    expect(updateRepo.mock.calls[0][1]).not.toHaveProperty('workspaceStartPath')
    expect(updateRepo.mock.calls[0][1]).not.toHaveProperty('inPlaceWorkspaces')
  })

  it.each([undefined, null])(
    'returns the unmirrored registration when update returns %s',
    async (missingRepo) => {
      const { store, updateRepo } = makeStore({ workspaceStartPath: 'projects/ray' })
      const setup = registered('/home/ubuntu/co/mono')
      mocks.remoteDirs.add('/home/ubuntu/co/mono/projects/ray')
      mocks.setupExistingFolderOnHost.mockResolvedValue(setup)
      updateRepo.mockReturnValue(missingRepo)

      const outcome = await setupProjectAtMappedPath(store, { projectId: PROJECT, hostId: DEVBOX })

      expect(updateRepo).toHaveBeenCalledWith('devbox-repo', { workspaceStartPath: 'projects/ray' })
      expect(outcome).toEqual({ status: 'ready', ...setup })
      if (outcome.status !== 'ready') {
        throw new Error('Expected a ready setup')
      }
      expect(outcome.result).toBe(setup.result)
      expect(mocks.buildProjectHostSetupResult).not.toHaveBeenCalled()
    }
  )
})
