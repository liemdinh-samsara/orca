import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, ProjectHostSetup } from '../../../../shared/project-types'
import type { Repo } from '../../../../shared/repo-types'
import { createTestStore } from './store-test-helpers'

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }))

const setupMappedFolder = vi.fn()
const args = { projectId: 'project-1', hostId: 'ssh:devbox' as const }
const project: Project = {
  id: args.projectId,
  displayName: 'Project',
  badgeColor: '#000',
  sourceRepoIds: ['repo-1'],
  createdAt: 1,
  updatedAt: 2
}
const repo: Repo = {
  id: 'repo-1',
  path: '/home/dev/project',
  displayName: 'Project',
  badgeColor: '#000',
  addedAt: 1,
  connectionId: 'devbox',
  workspaceStartPath: 'packages/web'
}
const setup: ProjectHostSetup = {
  id: 'setup-1',
  projectId: project.id,
  repoId: repo.id,
  hostId: args.hostId,
  path: repo.path,
  displayName: 'Project',
  connectionId: 'devbox',
  setupState: 'ready',
  setupMethod: 'imported-existing-folder',
  createdAt: 1,
  updatedAt: 2
}

beforeEach(() => {
  setupMappedFolder.mockReset()
  toastSuccess.mockReset()
  vi.stubGlobal('window', { api: { projects: { setupMappedFolder } } })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mapped project folder store action', () => {
  it.each(['local', 'runtime:env-1'] as const)(
    'returns unsupported for %s without IPC',
    async (hostId) => {
      const store = createTestStore()
      const before = store.getState()

      await expect(store.getState().setupProjectMappedFolder({ ...args, hostId })).resolves.toEqual(
        {
          status: 'unavailable',
          reason: 'unsupported-host'
        }
      )

      expect(store.getState()).toBe(before)
      expect(setupMappedFolder).not.toHaveBeenCalled()
      expect(toastSuccess).not.toHaveBeenCalled()
    }
  )

  it.each(['insert', 'replace'] as const)(
    'merges ready rows by %s while preserving other hosts and projects',
    async (mode) => {
      const store = createTestStore()
      const otherRepo: Repo = { ...repo, connectionId: null, executionHostId: 'local' }
      const otherProject: Project = { ...project, id: 'other-project' }
      const otherSetup: ProjectHostSetup = {
        ...setup,
        id: 'other-setup',
        projectId: otherProject.id
      }
      store.setState({
        repos: mode === 'insert' ? [otherRepo] : [otherRepo, { ...repo, displayName: 'Old repo' }],
        projects: mode === 'insert' ? [otherProject] : [otherProject, { ...project, updatedAt: 1 }],
        projectHostSetups:
          mode === 'insert' ? [otherSetup] : [otherSetup, { ...setup, updatedAt: 1 }],
        sshTargetLabels: new Map([['devbox', 'Devbox']])
      })
      setupMappedFolder.mockResolvedValue({ status: 'ready', result: { repo, project, setup } })
      const ownedRepo: Repo = { ...repo, executionHostId: args.hostId }

      await expect(store.getState().setupProjectMappedFolder(args)).resolves.toEqual({
        status: 'ready',
        result: { repo: ownedRepo, project, setup }
      })

      expect(setupMappedFolder).toHaveBeenCalledExactlyOnceWith(args)
      expect(store.getState().repos).toEqual([otherRepo, ownedRepo])
      expect(store.getState().projects).toEqual([otherProject, project])
      expect(store.getState().projectHostSetups).toEqual([otherSetup, setup])
      expect(toastSuccess).toHaveBeenCalledExactlyOnceWith('Project set up on Devbox', {
        description: '/home/dev/project/packages/web'
      })
    }
  )

  it('uses the SSH target ID in the toast when its display label is missing', async () => {
    const store = createTestStore()
    setupMappedFolder.mockResolvedValue({ status: 'ready', result: { repo, project, setup } })

    await store.getState().setupProjectMappedFolder(args)

    expect(toastSuccess).toHaveBeenCalledWith('Project set up on devbox', {
      description: '/home/dev/project/packages/web'
    })
  })

  it('returns an unavailable outcome unchanged and leaves all state untouched', async () => {
    const store = createTestStore()
    store.setState({ repos: [repo], projects: [project], projectHostSetups: [setup] })
    const before = store.getState()
    const outcome = {
      status: 'unavailable',
      reason: 'not-found',
      suggestedPath: '/home/dev/project'
    }
    setupMappedFolder.mockResolvedValue(outcome)

    await expect(store.getState().setupProjectMappedFolder(args)).resolves.toBe(outcome)

    expect(store.getState()).toBe(before)
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('logs an IPC rejection and resolves null so the manual setup flow can continue', async () => {
    const store = createTestStore()
    const before = store.getState()
    const error = new Error('SSH connection lost')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    setupMappedFolder.mockRejectedValue(error)

    await expect(store.getState().setupProjectMappedFolder(args)).resolves.toBeNull()

    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      'Failed to set up project at its mapped path:',
      error
    )
    expect(store.getState()).toBe(before)
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})
