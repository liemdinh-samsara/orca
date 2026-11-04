import { RotateCcw } from 'lucide-react'
import { ContextMenuItem, ContextMenuShortcut } from '@/components/ui/context-menu'
import { DropdownMenuItem, DropdownMenuShortcut } from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { canReopenClosedTab } from '@/store/slices/recently-closed-tabs'
import { useOptionalShortcutLabel } from '@/hooks/useShortcutLabel'
import { showClientCreationActionError } from '@/lib/client-creation-action-error'
import { translate } from '@/i18n/i18n'

/** Chrome's "Reopen closed tab": the same cross-type restore as the tab.reopenClosed shortcut. */
export function ReopenClosedTabMenuItem({
  worktreeId,
  menuKind = 'dropdown'
}: {
  worktreeId: string
  menuKind?: 'dropdown' | 'context'
}): React.JSX.Element {
  const canReopen = useAppStore((state) => canReopenClosedTab(state, worktreeId))
  const shortcut = useOptionalShortcutLabel('tab.reopenClosed')
  const Item = menuKind === 'context' ? ContextMenuItem : DropdownMenuItem
  const Shortcut = menuKind === 'context' ? ContextMenuShortcut : DropdownMenuShortcut
  return (
    <Item
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
      {shortcut ? <Shortcut>{shortcut}</Shortcut> : null}
    </Item>
  )
}
