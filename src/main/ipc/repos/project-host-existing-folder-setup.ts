import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import type {
  ProjectHostSetupExistingFolderArgs,
  ProjectHostSetupResult
} from '../../../shared/project-types'
import { getProjectIdForProviderIdentity } from '../../../shared/project-host-setup-projection'
import { getProjectHostSetupForRepo } from '../../../shared/project-host-setup-lookup'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../shared/execution-host'
import { invalidateAuthorizedRootsCache } from '../registered-worktree-roots-cache'
import { addLocalRepoFromPath } from './local-repo-registration'
import { addRemoteRepoFromPath } from './remote-repo-registration'

export function buildProjectHostSetupResult(store: Store, repo: Repo): ProjectHostSetupResult {
  const setup = getProjectHostSetupForRepo(store.getProjectHostSetups(), repo)
  const project = store.getProjects().find((entry) => entry.id === setup.projectId)
  if (!project) {
    throw new Error(`Project setup was created without a project record: ${setup.projectId}`)
  }
  return { project, setup, repo }
}

function alignRepoWithRequestedProject(
  store: Store,
  repo: Repo,
  projectId: string,
  setupMethod: ProjectHostSetupExistingFolderArgs['setupMethod'] = 'imported-existing-folder',
  requestedProviderIdentity?: ProjectHostSetupExistingFolderArgs['projectProviderIdentity']
): ProjectHostSetupResult {
  let setup = getProjectHostSetupForRepo(store.getProjectHostSetups(), repo)
  if (setup.projectId !== projectId) {
    const project = store.getProjects().find((entry) => entry.id === projectId)
    // Why: the selected project can exist only on the source host, so its structured identity travels with the request.
    const identity = project?.providerIdentity ?? requestedProviderIdentity
    if (!identity || getProjectIdForProviderIdentity(identity) !== projectId) {
      throw new Error('Imported folder does not match the selected project identity.')
    }
    // Why: stamp the selected project's provider identity when the folder lacks upstream, so projection can merge it.
    const updated = store.updateRepo(repo.id, {
      upstream: {
        owner: identity.owner,
        repo: identity.repo,
        ...(identity.host ? { host: identity.host } : {})
      }
    })
    if (!updated) {
      throw new Error(`Project setup repo disappeared before it could be linked: ${repo.id}`)
    }
    repo = updated
    setup = getProjectHostSetupForRepo(store.getProjectHostSetups(), repo)
  }
  const updated = store.updateRepo(repo.id, { projectHostSetupMethod: setupMethod })
  if (!updated) {
    throw new Error(
      `Project setup repo disappeared before setup metadata could be linked: ${repo.id}`
    )
  }
  repo = updated
  return buildProjectHostSetupResult(store, repo)
}

/** Registers an existing folder on a local or SSH host and links it to the requested project. */
export async function setupExistingFolderOnHost(
  store: Store,
  // Why a plain string host: IPC args arrive unbranded and are parsed here.
  args: Omit<ProjectHostSetupExistingFolderArgs, 'hostId'> & { hostId: string }
): Promise<{ result: ProjectHostSetupResult; alreadyExisted: boolean }> {
  const parsedHost = parseExecutionHostId(args.hostId)
  if (!parsedHost) {
    throw new Error(`Unsupported host: ${args.hostId}`)
  }
  const registered =
    parsedHost.kind === 'local'
      ? await addLocalRepoFromPath(store, args.path, args.kind)
      : parsedHost.kind === 'ssh'
        ? await addRemoteRepoFromPath(store, {
            connectionId: parsedHost.targetId,
            remotePath: args.path,
            displayName: args.displayName,
            kind: args.kind
          })
        : {
            error:
              'Runtime hosts must be set up through the runtime projectHostSetup.setupExistingFolder RPC.'
          }
  if ('error' in registered) {
    throw new Error(registered.error)
  }
  try {
    const result = alignRepoWithRequestedProject(
      store,
      registered.repo,
      args.projectId,
      args.setupMethod,
      args.projectProviderIdentity
    )
    return { result, alreadyExisted: registered.alreadyExisted }
  } catch (err) {
    // Why: an import that cannot be linked must not leave a new repo registration or authorization root behind.
    if (!registered.alreadyExisted) {
      store.removeProjectForHost(registered.repo.id, getRepoExecutionHostId(registered.repo))
      invalidateAuthorizedRootsCache()
    }
    throw err
  }
}
