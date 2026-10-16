import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import type { AppState } from '../types'
import { translate } from '@/i18n/i18n'
import { parseExecutionHostId } from '../../../../shared/execution-host'
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
      if (host?.kind !== 'ssh') {
        return { status: 'unavailable', reason: 'unsupported-host' }
      }
      try {
        const outcome = await window.api.projects.setupMappedFolder(args)
        if (outcome.status !== 'ready') {
          return outcome
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
