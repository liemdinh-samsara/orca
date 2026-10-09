import { Ellipsis, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

export function TabGroupPaneActionsMenu({
  className,
  onClosePane
}: {
  className: string
  onClosePane: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <DropdownMenu modal={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={translate(
                'auto.components.tab.group.TabGroupPanel.9acaf92093',
                'Pane Actions'
              )}
              onClick={(event) => {
                event.stopPropagation()
              }}
              className={className}
            >
              <Ellipsis className="size-4" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
          <DropdownMenuItem variant="destructive" onSelect={() => onClosePane()}>
            <X className="size-4" />
            {translate(
              'auto.components.tab.group.TabGroupPanel.closePaneColumn',
              'Close split pane'
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent side="bottom" sideOffset={6}>
        {translate('auto.components.tab.group.TabGroupPanel.9acaf92093', 'Pane Actions')}
      </TooltipContent>
    </Tooltip>
  )
}
