import { PanelLeft, PanelTop } from 'lucide-react'
import { useAppStore } from '../../store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

export function TabStripOrientationToggle({
  worktreeId,
  groupId,
  isVertical,
  className
}: {
  worktreeId: string
  groupId: string
  isVertical: boolean
  className: string
}): React.JSX.Element {
  const setTabGroupStripOrientation = useAppStore((state) => state.setTabGroupStripOrientation)
  const label = isVertical
    ? translate('components.tab.group.TabStripOrientationToggle.horizontal', 'Show tabs on top')
    : translate('components.tab.group.TabStripOrientationToggle.vertical', 'Show tabs on the side')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={isVertical}
          className={className}
          onClick={(event) => {
            event.stopPropagation()
            setTabGroupStripOrientation(worktreeId, groupId, isVertical ? 'horizontal' : 'vertical')
          }}
        >
          {isVertical ? <PanelTop className="size-4" /> : <PanelLeft className="size-4" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
