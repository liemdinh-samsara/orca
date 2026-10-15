import { useEffect, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { CLOSE_ALL_CONTEXT_MENUS_EVENT } from '@/lib/close-all-context-menus'
import { ReopenClosedTabMenuItem } from './ReopenClosedTabMenuItem'
import { TAB_CONTEXT_MENU_CONTENT_CLASS } from './tab-context-menu-sizing'

/** The strip's own right-click menu for the empty space around its tabs, as in Chrome. */
export function TabStripBlankAreaMenu({
  worktreeId,
  className,
  children
}: {
  worktreeId: string
  className: string
  children: React.ReactNode
}): React.JSX.Element {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const closeMenu = (): void => setPoint(null)
    window.addEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
    return () => window.removeEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
  }, [])

  // Why: a click into a <webview> never reaches the renderer document, so Radix misses it.
  useEffect(() => {
    if (!point) {
      return
    }
    const dismiss = (): void => setPoint(null)
    window.addEventListener('blur', dismiss)
    return () => window.removeEventListener('blur', dismiss)
  }, [point])

  return (
    <div
      className={className}
      onContextMenu={(event) => {
        // Why: a tab opens its own menu from a capture handler that marks the event handled.
        if (event.nativeEvent.defaultPrevented) {
          return
        }
        event.preventDefault()
        window.dispatchEvent(new Event(CLOSE_ALL_CONTEXT_MENUS_EVENT))
        setPoint({ x: event.clientX, y: event.clientY })
      }}
    >
      {children}
      <DropdownMenu
        open={point !== null}
        onOpenChange={(open) => !open && setPoint(null)}
        modal={false}
      >
        <DropdownMenuTrigger asChild>
          <button
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none fixed size-px opacity-0"
            style={{ left: point?.x ?? 0, top: point?.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className={TAB_CONTEXT_MENU_CONTENT_CLASS}
          sideOffset={0}
          align="start"
        >
          <ReopenClosedTabMenuItem worktreeId={worktreeId} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
