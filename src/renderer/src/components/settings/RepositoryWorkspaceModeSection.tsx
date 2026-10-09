import type { Repo } from '../../../../shared/repo-types'
import { normalizeWorkspaceStartPath } from '../../../../shared/workspace-start-path'
import { Label } from '../ui/label'
import { RepoSettingsDraftInput } from './RepositorySettingsDraftInput'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow, SettingsSwitch } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

type RepositoryWorkspaceModeSectionProps = {
  repo: Repo
  updateRepo: (
    repoId: string,
    updates: Partial<Pick<Repo, 'inPlaceWorkspaces' | 'workspaceStartPath'>>
  ) => void | Promise<boolean>
  forceVisible: boolean
}

export function RepositoryWorkspaceModeSection({
  repo,
  updateRepo,
  forceVisible
}: RepositoryWorkspaceModeSectionProps): React.JSX.Element {
  const inPlaceTitle = translate(
    'components.settings.RepositoryWorkspaceModeSection.inPlaceTitle',
    'Create workspaces without git worktrees'
  )
  const startPathTitle = translate(
    'components.settings.RepositoryWorkspaceModeSection.startPathTitle',
    'Start folder'
  )
  return (
    <>
      <SearchableSetting
        title={inPlaceTitle}
        description={translate(
          'components.settings.RepositoryWorkspaceModeSection.inPlaceDescription',
          'New workspaces share this checkout and its branch instead of creating a git worktree. Useful for large monorepos.'
        )}
        keywords={[repo.displayName, 'monolith', 'monorepo', 'in place', 'worktree', 'sub project']}
        forceVisible={forceVisible}
      >
        <SettingsRow
          labelId={`in-place-workspaces-${repo.id}`}
          label={inPlaceTitle}
          description={translate(
            'components.settings.RepositoryWorkspaceModeSection.inPlaceDescription',
            'New workspaces share this checkout and its branch instead of creating a git worktree. Useful for large monorepos.'
          )}
          control={
            <SettingsSwitch
              checked={repo.inPlaceWorkspaces === true}
              ariaLabelledBy={`in-place-workspaces-${repo.id}`}
              onChange={() =>
                void updateRepo(repo.id, { inPlaceWorkspaces: repo.inPlaceWorkspaces !== true })
              }
            />
          }
        />
      </SearchableSetting>

      <SearchableSetting
        title={startPathTitle}
        description={translate(
          'components.settings.RepositoryWorkspaceModeSection.startPathDescription',
          'Folder inside each workspace where terminals and agents start. Git still runs from the project root.'
        )}
        keywords={[
          repo.displayName,
          'cwd',
          'working directory',
          'subfolder',
          'terminal',
          'monorepo'
        ]}
        className="space-y-2"
        forceVisible={forceVisible}
      >
        <Label>{startPathTitle}</Label>
        <RepoSettingsDraftInput
          repoId={repo.id}
          storeValue={repo.workspaceStartPath ?? ''}
          placeholder={translate(
            'components.settings.RepositoryWorkspaceModeSection.startPathPlaceholder',
            'Project root'
          )}
          onTextChange={() => {}}
          onBlur={(e) => {
            const normalized = normalizeWorkspaceStartPath(e.currentTarget.value)
            if (normalized === null || normalized === (repo.workspaceStartPath ?? '')) {
              return
            }
            void updateRepo(repo.id, { workspaceStartPath: normalized || undefined })
          }}
          className="h-9 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {translate(
            'components.settings.RepositoryWorkspaceModeSection.startPathHint',
            'Relative to the project root, for example services/api. Leave empty to start at the root.'
          )}
        </p>
      </SearchableSetting>
    </>
  )
}
