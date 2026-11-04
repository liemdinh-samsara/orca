import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import type { AppState } from '../types'
import { translate } from '@/i18n/i18n'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { getManagedOrcadSshTargetId } from '../../../../shared/managed-orcad-execution-host'
import type {
  ProjectHostMappedFolder,
  ProjectHostMappedSetupArgs,
  ProjectHostMappedSetupOutcome
} from '../../../../shared/project-types'
import { normalizeProjectRow } from '../../../../shared/project-catalog-row-normalization'
import { resolveWorkspaceStartCwd } from '../../../../shared/workspace-start-path'
import type { RepoSlice } from '../repos/repo-state'
import { adoptFromEndpoint } from '../adopt-from-endpoint'
import { getProjectSetupRuntimeTarget } from './project-host-routing'
import { mergeProjectHostSetupResult } from './project-host-setup-result-merge'

export function createProjectHostMappedSetupActions(
  set: Parameters<StateCreator<AppState>>[0],
  get: Parameters<StateCreator<AppState>>[1]
): Pick<RepoSlice, 'setupProjectMappedFolder'> {
  return {
    setupProjectMappedFolder: async (args) => {
      const host = parseExecutionHostId(args.hostId)
      const environment =
        host?.kind === 'runtime'
          ? get().runtimeEnvironments.find((entry) => entry.id === host.environmentId)
          : undefined
      const sshTargetId = environment ? getManagedOrcadSshTargetId(environment) : null
      if (host?.kind !== 'ssh' && !sshTargetId) {
        return { status: 'unavailable', reason: 'unsupported-host' }
      }
      try {
        const outcome = await window.api.projects.setupMappedFolder(
          sshTargetId ? { ...args, sshTargetId } : args
        )
        if (outcome.status === 'mapped') {
          return await setupOnManagedServer(get, args, outcome.folder)
        }
        if (outcome.status !== 'ready' || host?.kind !== 'ssh') {
          return outcome.status === 'ready' ? null : outcome
        }
        const target = getProjectSetupRuntimeTarget(args.hostId)
        const repo = adoptFromEndpoint(target, { kind: 'repo', row: outcome.result.repo })
        const setup = adoptFromEndpoint(target, {
          kind: 'projectHostSetup',
          row: outcome.result.setup
        })
        const project = normalizeProjectRow(outcome.result.project)
        set((s) => mergeProjectHostSetupResult(s, { repo, project, setup }))
        toast.success(
          translate('auto.store.projects.mappedSetupReady', 'Project set up on {{host}}', {
            host: get().sshTargetLabels.get(host.targetId) ?? host.targetId
          }),
          { description: resolveWorkspaceStartCwd(repo.path, repo) }
        )
        return { status: 'ready', result: { ...outcome.result, repo, project, setup } }
      } catch (err) {
        // Why: the caller falls back to the manual dialog, which reports its own failures.
        console.error('Failed to set up project at its mapped path:', err)
        return null
      }
    }
  }
}

// Why the store's own setup: a managed server owns its repos, so it registers the folder itself.
async function setupOnManagedServer(
  get: Parameters<StateCreator<AppState>>[1],
  args: ProjectHostMappedSetupArgs,
  folder: ProjectHostMappedFolder
): Promise<ProjectHostMappedSetupOutcome | null> {
  const result = await get().setupProjectExistingFolder({
    projectId: args.projectId,
    hostId: args.hostId,
    path: folder.path,
    kind: folder.kind,
    displayName: folder.displayName
  })
  if (!result) {
    return null
  }
  const updates = {
    ...(folder.workspaceStartPath ? { workspaceStartPath: folder.workspaceStartPath } : {}),
    ...(folder.inPlaceWorkspaces === undefined
      ? {}
      : { inPlaceWorkspaces: folder.inPlaceWorkspaces })
  }
  if (Object.keys(updates).length > 0) {
    await get().updateRepo(result.repo.id, updates, { hostId: args.hostId })
  }
  const repo = get().repos.find((entry) => entry.id === result.repo.id) ?? result.repo
  return { status: 'ready', result: { ...result, repo } }
}
