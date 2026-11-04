import type { Store } from '../../persistence/loading-store/store'
import type { Repo } from '../../../shared/repo-types'
import type {
  ProjectHostSetupExistingFolderArgs,
  ProjectHostSetupResult
} from '../../../shared/project-types'
import { getProjectHostSetupForRepo } from '../../../shared/project-host-setup-lookup'
import { resolveImportedFolderProjectLink } from '../../../shared/imported-folder-project-identity'
import { readCurrentGitRemoteIdentity } from '../../workspaces/catalog/repo-git-remote-identity'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../shared/execution-host'
import { invalidateAuthorizedRootsCache } from '../worktrees/removal/registered-worktree-roots-cache'
import { addLocalRepoFromPath } from './local-repo-registration'
import { sshTargetNotConnectedMessage } from '../../providers/ssh-host-not-served-error'
import { assertWslMoveHostSetupWritable } from '../../persistence/moving-wsl-projects/wsl-move-scope-guard'

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
  folderRemote: Pick<Repo, 'gitRemoteIdentity'>,
  projectId: string,
  setupMethod: ProjectHostSetupExistingFolderArgs['setupMethod'] = 'imported-existing-folder',
  requestedProviderIdentity?: ProjectHostSetupExistingFolderArgs['projectProviderIdentity']
): ProjectHostSetupResult {
  assertWslMoveHostSetupWritable(store, {
    projectId,
    hostId: getRepoExecutionHostId(repo),
    repoId: repo.id
  })
  let setup = getProjectHostSetupForRepo(store.getProjectHostSetups(), repo)
  if (setup.projectId !== projectId) {
    const project = store.getProjects().find((entry) => entry.id === projectId)
    // Project identity must travel with the request when it exists only on the source host.
    const updated = store.updateRepo(
      repo,
      resolveImportedFolderProjectLink(
        { ...repo, ...folderRemote },
        projectId,
        project?.providerIdentity ?? requestedProviderIdentity
      )
    )
    if (!updated) {
      throw new Error(`Project setup repo disappeared before it could be linked: ${repo.id}`)
    }
    repo = updated
    setup = getProjectHostSetupForRepo(store.getProjectHostSetups(), repo)
  }
  const updated = store.updateRepo(repo, { projectHostSetupMethod: setupMethod })
  if (!updated) {
    throw new Error(
      `Project setup repo disappeared before setup metadata could be linked: ${repo.id}`
    )
  }
  repo = updated
  return buildProjectHostSetupResult(store, repo)
}

/** Registers an existing folder on the local host and links it to the requested project. */
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
        ? { error: sshTargetNotConnectedMessage(parsedHost.targetId) }
        : {
            error:
              'Runtime hosts must be set up through the runtime projectHostSetup.setupExistingFolder RPC.'
          }
  if ('error' in registered) {
    throw new Error(registered.error)
  }
  // Stored remotes may predate changes made in the checkout.
  const folderRemote =
    registered.alreadyExisted || registered.repo.gitRemoteIdentity === undefined
      ? await readCurrentGitRemoteIdentity(registered.repo)
      : registered.repo
  try {
    const result = alignRepoWithRequestedProject(
      store,
      registered.repo,
      folderRemote,
      args.projectId,
      args.setupMethod,
      args.projectProviderIdentity
    )
    return { result, alreadyExisted: registered.alreadyExisted }
  } catch (err) {
    // Failed linking must not leave a newly registered repo or authorization root.
    if (!registered.alreadyExisted) {
      store.removeProjectForHost(registered.repo)
      invalidateAuthorizedRootsCache()
    }
    throw err
  }
}
