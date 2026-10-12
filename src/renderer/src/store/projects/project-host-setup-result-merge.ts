import type { AppState } from '../types'
import type { Project, ProjectHostSetup } from '../../../../shared/project-types'
import type { Repo } from '../../../../shared/repo-types'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { repoMatchesHostIdentity } from '../slices/repo-host-identity'

/** Upserts the repo, project and setup rows a host setup produced. */
export function mergeProjectHostSetupResult(
  s: AppState,
  result: { repo: Repo; project: Project; setup: ProjectHostSetup }
): Pick<AppState, 'repos' | 'projects' | 'projectHostSetups'> {
  const { repo, project, setup } = result
  const repoHostId = getRepoExecutionHostId(repo)
  const matchesRepo = (entry: Repo): boolean => repoMatchesHostIdentity(entry, repo.id, repoHostId)
  return {
    repos: s.repos.some(matchesRepo)
      ? s.repos.map((entry) => (matchesRepo(entry) ? repo : entry))
      : [...s.repos, repo],
    projects: s.projects.some((entry) => entry.id === project.id)
      ? s.projects.map((entry) => (entry.id === project.id ? project : entry))
      : [...s.projects, project],
    projectHostSetups: s.projectHostSetups.some((entry) => entry.id === setup.id)
      ? s.projectHostSetups.map((entry) => (entry.id === setup.id ? setup : entry))
      : [...s.projectHostSetups, setup]
  }
}
