import React from 'react'
import { useAppStore } from '@/store'
import type { NeedsProjectHostOption } from './new-workspace-composer-card-props'

type MappedProjectLocationOptions = {
  onProjectHostSetupChange?: (setupId: string) => void
  onNestedDialogOpenChange?: (open: boolean) => void
  openDialog: (option: NeedsProjectHostOption) => void
}

/** "Set location" first tries the host's mapped path; the dialog opens only when that fails. */
export function useMappedProjectLocation({
  onProjectHostSetupChange,
  onNestedDialogOpenChange,
  openDialog
}: MappedProjectLocationOptions): {
  suggestedPath: string | null
  handleSetLocation: (option: NeedsProjectHostOption) => void
} {
  const [suggestedPath, setSuggestedPath] = React.useState<string | null>(null)
  const setupProjectMappedFolder = useAppStore((state) => state.setupProjectMappedFolder)
  // Why a ref: the caller passes a fresh opener each render; the callback stays stable.
  const openDialogRef = React.useRef(openDialog)
  openDialogRef.current = openDialog
  const handleSetLocation = React.useCallback(
    (option: NeedsProjectHostOption): void => {
      void setupProjectMappedFolder({ projectId: option.projectId, hostId: option.hostId }).then(
        (outcome) => {
          if (outcome?.status === 'ready') {
            onProjectHostSetupChange?.(outcome.result.setup.id)
            return
          }
          setSuggestedPath(outcome?.suggestedPath ?? null)
          openDialogRef.current(option)
          onNestedDialogOpenChange?.(true)
        }
      )
    },
    [onNestedDialogOpenChange, onProjectHostSetupChange, setupProjectMappedFolder]
  )
  return { suggestedPath, handleSetLocation }
}
