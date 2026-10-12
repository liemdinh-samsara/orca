import { useMemo } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { getConnectionIdFromState } from '@/lib/connection-owner-resolution'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { openLocalTerminalForRemoteWorkspace } from '@/lib/local-terminal-for-remote-workspace'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '../../store'
import { buildLocalTerminalMenuOption, type TabCreateMenuOption } from './tab-create-menu-options'
import type { TabBarCreateMenuController } from './use-tab-bar-create-menu-controller'

export type TabBarCreateMenu = TabBarCreateMenuController & {
  /** Set only in workspaces whose terminals run on an SSH host. */
  openLocalTerminal?: () => void
}

function insertAfterTerminalOptions(
  options: readonly TabCreateMenuOption[],
  option: TabCreateMenuOption
): TabCreateMenuOption[] {
  const lastTerminalIndex = options.findLastIndex(
    (entry) => entry.kind === 'new-terminal' || entry.kind === 'new-terminal-shell'
  )
  return options.toSpliced(lastTerminalIndex + 1, 0, option)
}

/** Adds "New Local Terminal" to the "+" menu of an SSH workspace. */
export function useTabBarLocalTerminalMenu(
  createMenu: TabBarCreateMenuController,
  { worktreeId, terminalOnly }: { worktreeId: string; terminalOnly: boolean }
): TabBarCreateMenu {
  const isSshWorkspace = useAppStore((s) =>
    Boolean(getConnectionIdFromState(s, worktreeId)?.trim())
  )
  // Why desktop only: a web client's floating terminal runs on the host it is paired with.
  const available = isSshWorkspace && !isWebClientLocation()
  const openLocalTerminal = useMemo(
    () =>
      available
        ? () => {
            openLocalTerminalForRemoteWorkspace(worktreeId).catch((error: unknown) => {
              toast.error(
                translate(
                  'auto.components.tab.bar.useTabBarLocalTerminalMenu.openFailed',
                  'Could not open a local terminal'
                ),
                { description: extractIpcErrorMessage(error, '') || undefined }
              )
            })
          }
        : undefined,
    [available, worktreeId]
  )
  const baseOptions = createMenu.createMenuOptions
  const createMenuOptions = useMemo(
    () =>
      available && !terminalOnly
        ? insertAfterTerminalOptions(baseOptions, buildLocalTerminalMenuOption())
        : baseOptions,
    [available, baseOptions, terminalOnly]
  )
  if (!openLocalTerminal) {
    return createMenu
  }
  return {
    ...createMenu,
    createMenuOptions,
    handleSelectCreateMenuOption: (option) =>
      option.kind === 'new-local-terminal'
        ? openLocalTerminal()
        : createMenu.handleSelectCreateMenuOption(option),
    openLocalTerminal
  }
}
