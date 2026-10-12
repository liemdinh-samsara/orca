import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import type {
  ProjectHostMappedSetupOutcome,
  ProjectHostSetupResult
} from '../../../shared/project-types'
import { parseExecutionHostId } from '../../../shared/execution-host'
import { mapPathBetweenHostPrefixes } from '../../../shared/project-host-path-mapping'
import { isFolderRepo } from '../../../shared/repo-kind'
import {
  normalizeWorkspaceStartPath,
  resolveWorkspaceStartCwd
} from '../../../shared/workspace-start-path'
import { getSshConnectionManager } from '../../ssh/ssh-target-registry'
import { resolveRemoteDirectory } from '../ssh-browse'
import {
  buildProjectHostSetupResult,
  setupExistingFolderOnHost
} from './project-host-existing-folder-setup'
import { resolveRemoteHomePath } from './remote-home-path'

type MappedSetupArgs = { projectId: string; hostId: string }

type MappedSetupResult =
  | { status: 'ready'; result: ProjectHostSetupResult; alreadyExisted: boolean }
  | Extract<ProjectHostMappedSetupOutcome, { status: 'unavailable' }>

function localProjectPrefixes(): string[] {
  const home = homedir()
  try {
    // Why: checkouts are stored canonicalized (/private/var/...) while HOME may not be.
    const real = realpathSync(home)
    return real === home ? [home] : [home, real]
  } catch {
    return [home]
  }
}

/** The SSH host's project prefix: its configured one, else its home folder. */
async function resolveSshProjectPrefix(store: Store, targetId: string): Promise<string | null> {
  const configured = store.getSshTarget(targetId)?.projectPathPrefix?.trim() || '~'
  const resolved = await resolveRemoteHomePath(targetId, configured)
  return resolved.startsWith('~') ? null : resolved
}

/** Another host's checkout of the project, re-rooted onto the target prefix. Local wins. */
async function findMappedSource(
  store: Store,
  args: MappedSetupArgs,
  targetPrefix: string
): Promise<{ repo: Repo; root: string } | null> {
  const setups = store
    .getProjectHostSetups()
    .filter(
      (setup) =>
        setup.projectId === args.projectId &&
        setup.hostId !== args.hostId &&
        setup.setupState === 'ready' &&
        setup.repoId
    )
    .sort((a, b) => Number(b.hostId === 'local') - Number(a.hostId === 'local'))
  for (const setup of setups) {
    const repo = store.getRepo(setup.repoId)
    const host = parseExecutionHostId(setup.hostId)
    if (!repo || !host) {
      continue
    }
    const prefixes =
      host.kind === 'local'
        ? localProjectPrefixes()
        : host.kind === 'ssh'
          ? [await resolveSshProjectPrefix(store, host.targetId)].filter((p) => p !== null)
          : []
    for (const prefix of prefixes) {
      const root = mapPathBetweenHostPrefixes(repo.path, prefix, targetPrefix)
      if (root) {
        return { repo, root }
      }
    }
  }
  return null
}

/** Sets a project up on an SSH host at the path its other checkout implies, e.g. ~/co/app. */
export async function setupProjectAtMappedPath(
  store: Store,
  args: MappedSetupArgs
): Promise<MappedSetupResult> {
  const host = parseExecutionHostId(args.hostId)
  if (host?.kind !== 'ssh') {
    return { status: 'unavailable', reason: 'unsupported-host' }
  }
  const conn = getSshConnectionManager()?.getConnection(host.targetId)
  const targetPrefix = conn ? await resolveSshProjectPrefix(store, host.targetId) : null
  if (!conn || !targetPrefix) {
    return { status: 'unavailable', reason: 'not-connected' }
  }
  const source = await findMappedSource(store, args, targetPrefix)
  if (!source) {
    return { status: 'unavailable', reason: 'no-mappable-setup' }
  }
  const startFolder = resolveWorkspaceStartCwd(source.root, source.repo)
  if (!(await resolveRemoteDirectory(conn, startFolder))) {
    return { status: 'unavailable', reason: 'not-found', suggestedPath: startFolder }
  }

  const base = {
    projectId: args.projectId,
    hostId: args.hostId,
    displayName: source.repo.displayName
  }
  if (isFolderRepo(source.repo)) {
    return {
      status: 'ready',
      ...(await setupExistingFolderOnHost(store, { ...base, path: startFolder, kind: 'folder' }))
    }
  }
  let setup: Awaited<ReturnType<typeof setupExistingFolderOnHost>>
  try {
    setup = await setupExistingFolderOnHost(store, { ...base, path: source.root, kind: 'git' })
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('Not a valid git repository')) {
      throw error
    }
    // Why: a plain copy of the checkout without .git still works as a folder project.
    setup = await setupExistingFolderOnHost(store, { ...base, path: startFolder, kind: 'folder' })
    return { status: 'ready', ...setup }
  }
  return { status: 'ready', ...mirrorWorkspaceSettings(store, setup, source.repo, startFolder) }
}

/** A new git checkout starts in the same subfolder and creates workspaces the same way. */
function mirrorWorkspaceSettings(
  store: Store,
  setup: { result: ProjectHostSetupResult; alreadyExisted: boolean },
  sourceRepo: Repo,
  startFolder: string
): { result: ProjectHostSetupResult; alreadyExisted: boolean } {
  const repo = setup.result.repo
  if (setup.alreadyExisted) {
    return setup
  }
  const root = repo.path.replace(/\/+$/, '')
  const startPath = startFolder.startsWith(`${root}/`)
    ? normalizeWorkspaceStartPath(startFolder.slice(root.length + 1))
    : null
  const updated = store.updateRepo(repo.id, {
    ...(startPath ? { workspaceStartPath: startPath } : {}),
    ...(sourceRepo.inPlaceWorkspaces === undefined
      ? {}
      : { inPlaceWorkspaces: sourceRepo.inPlaceWorkspaces })
  })
  return updated ? { ...setup, result: buildProjectHostSetupResult(store, updated) } : setup
}
