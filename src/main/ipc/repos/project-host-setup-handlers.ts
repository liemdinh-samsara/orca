import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import type {
  ProjectHostSetupCreateArgs,
  ProjectHostSetupCreateResult,
  ProjectHostSetupDeleteArgs,
  ProjectHostSetupDeleteResult,
  ProjectHostMappedSetupArgs,
  ProjectHostMappedSetupOutcome,
  ProjectHostSetupExistingFolderArgs,
  ProjectHostSetupResult,
  ProjectHostSetupUpdateArgs,
  ProjectHostSetupUpdateResult
} from '../../../shared/project-types'
import { prepareLocalWorktreeRootForRepo } from '../../worktree-root-preparation'
import { invalidateAuthorizedRootsCache } from '../registered-worktree-roots-cache'
import { emitRepoAdded } from './repo-added-telemetry'
import { notifyReposChanged } from './repos-changed-notification'
import {
  ProjectHostSetupCreateIpcArgs,
  ProjectHostSetupDeleteIpcArgs,
  ProjectHostMappedSetupIpcArgs,
  ProjectHostSetupExistingFolderIpcArgs,
  ProjectHostSetupUpdateIpcArgs,
  parseProjectGroupIpcArgs
} from './repo-ipc-arg-schemas'
import { setupExistingFolderOnHost } from './project-host-existing-folder-setup'
import { setupProjectAtMappedPath } from './project-host-mapped-setup'

async function finishFolderSetup(
  mainWindow: BrowserWindow,
  store: Store,
  result: ProjectHostSetupResult,
  alreadyExisted: boolean
): Promise<void> {
  invalidateAuthorizedRootsCache()
  notifyReposChanged(mainWindow)
  emitRepoAdded('folder_picker', alreadyExisted)
  if (alreadyExisted) {
    await prepareLocalWorktreeRootForRepo(store, result.repo)
  }
}

export function registerProjectHostSetupHandlers(mainWindow: BrowserWindow, store: Store): void {
  ipcMain.handle(
    'projectHostSetups:create',
    (_event, rawArgs: ProjectHostSetupCreateArgs): ProjectHostSetupCreateResult => {
      const args = parseProjectGroupIpcArgs(
        ProjectHostSetupCreateIpcArgs,
        rawArgs,
        'project_host_setup_create_invalid_args'
      )
      const result = store.createProjectHostSetup(args)
      if (!result) {
        throw new Error(`Project not found: ${args.projectId}`)
      }
      notifyReposChanged(mainWindow)
      return result
    }
  )

  ipcMain.handle(
    'projectHostSetups:update',
    (_event, rawArgs: ProjectHostSetupUpdateArgs): ProjectHostSetupUpdateResult => {
      const args = parseProjectGroupIpcArgs(
        ProjectHostSetupUpdateIpcArgs,
        rawArgs,
        'project_host_setup_update_invalid_args'
      )
      const result = store.updateProjectHostSetup(args)
      if (!result) {
        throw new Error(`Project host setup not found: ${args.setupId}`)
      }
      if ('worktreeBasePath' in args.updates && result.repo) {
        void prepareLocalWorktreeRootForRepo(store, result.repo)
        invalidateAuthorizedRootsCache()
      }
      notifyReposChanged(mainWindow)
      return result
    }
  )

  ipcMain.handle(
    'projectHostSetups:delete',
    (_event, rawArgs: ProjectHostSetupDeleteArgs): ProjectHostSetupDeleteResult => {
      const args = parseProjectGroupIpcArgs(
        ProjectHostSetupDeleteIpcArgs,
        rawArgs,
        'project_host_setup_delete_invalid_args'
      )
      const result = store.deleteProjectHostSetup(args)
      if (!result) {
        throw new Error(`Project host setup not found: ${args.setupId}`)
      }
      notifyReposChanged(mainWindow)
      return result
    }
  )

  ipcMain.handle(
    'projectHostSetups:setupExistingFolder',
    async (
      _event,
      rawArgs: ProjectHostSetupExistingFolderArgs
    ): Promise<ProjectHostSetupResult> => {
      const args = parseProjectGroupIpcArgs(
        ProjectHostSetupExistingFolderIpcArgs,
        rawArgs,
        'project_host_setup_invalid_args'
      )
      const { result, alreadyExisted } = await setupExistingFolderOnHost(store, args)
      await finishFolderSetup(mainWindow, store, result, alreadyExisted)
      return result
    }
  )

  ipcMain.handle(
    'projectHostSetups:setupMappedFolder',
    async (_event, rawArgs: ProjectHostMappedSetupArgs): Promise<ProjectHostMappedSetupOutcome> => {
      const args = parseProjectGroupIpcArgs(
        ProjectHostMappedSetupIpcArgs,
        rawArgs,
        'project_host_setup_mapped_invalid_args'
      )
      const outcome = await setupProjectAtMappedPath(store, args)
      if (outcome.status === 'ready') {
        await finishFolderSetup(mainWindow, store, outcome.result, outcome.alreadyExisted)
        return { status: 'ready', result: outcome.result }
      }
      return outcome
    }
  )
}
