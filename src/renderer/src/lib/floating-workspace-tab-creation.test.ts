import { describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import type { AppState } from '@/store/types'
import { createFloatingWorkspaceTerminalTab } from './floating-workspace-tab-creation'

const focusTerminalTabSurfaceMock = vi.hoisted(() => vi.fn())

vi.mock('./create-untitled-markdown', () => ({
  createUntitledMarkdownFileWithTemplateSelection: vi.fn()
}))

vi.mock('./connection-context', () => ({
  getConnectionId: vi.fn(() => null)
}))

vi.mock('./focus-terminal-tab-surface', () => ({
  focusTerminalTabSurface: focusTerminalTabSurfaceMock
}))

describe('createFloatingWorkspaceTerminalTab', () => {
  it('starts the terminal in a requested folder', async () => {
    const createTab = vi.fn<AppState['createTab']>()
    const store = {
      activeGroupIdByWorktree: { [FLOATING_TERMINAL_WORKTREE_ID]: 'floating-group' },
      createTab
    }

    await createFloatingWorkspaceTerminalTab(store, undefined, undefined, '/Users/me/co/mono')

    expect(createTab).toHaveBeenCalledWith(
      FLOATING_TERMINAL_WORKTREE_ID,
      'floating-group',
      undefined,
      {
        id: expect.any(String),
        startupCwd: '/Users/me/co/mono'
      }
    )
    expect(focusTerminalTabSurfaceMock).toHaveBeenCalledWith(createTab.mock.calls[0][3]?.id)
  })
})
