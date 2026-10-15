import { RotateCcw } from 'lucide-react'
import { DropdownMenuItem, DropdownMenuShortcut } from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { canReopenClosedTab } from '@/store/slices/recently-closed-tabs'
import { useOptionalShortcutLabel } from '@/hooks/useShortcutLabel'
import { showClientCreationActionError } from '@/lib/client-creation-action-error'
import { translate } from '@/i18n/i18n'

/** Chrome's "Reopen closed tab": the same cross-type restore as the tab.reopenClosed shortcut. */
export function ReopenClosedTabMenuItem({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const canReopen = useAppStore((state) => canReopenClosedTab(state, worktreeId))
  const shortcut = useOptionalShortcutLabel('tab.reopenClosed')
  return (
    <DropdownMenuItem
      disabled={!canReopen}
      onSelect={() => {
        try {
          useAppStore.getState().reopenClosedTab(worktreeId)
        } catch (error) {
          showClientCreationActionError(error)
        }
      }}
    >
      <RotateCcw className="size-3.5" />
      {translate('components.tab.bar.ReopenClosedTabMenuItem.label', 'Reopen Closed Tab')}
      {shortcut ? <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut> : null}
    </DropdownMenuItem>
  )
}
