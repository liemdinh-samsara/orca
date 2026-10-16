// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { RepositoryWorkspaceModeSection } from './RepositoryWorkspaceModeSection'

const { searchState } = vi.hoisted(() => ({ searchState: { query: '' } }))

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: searchState.query })
}))

const BASE_REPO: Repo = {
  id: 'repo-1',
  path: '/home/user/monorepo',
  displayName: 'My Monorepo',
  badgeColor: '#000000',
  addedAt: 0
}

const IN_PLACE_TITLE = 'Create workspaces without git worktrees'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  searchState.query = ''
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function render(
  repo: Repo,
  updateRepo: React.ComponentProps<typeof RepositoryWorkspaceModeSection>['updateRepo'],
  forceVisible = true
): void {
  act(() => {
    root.render(
      React.createElement(RepositoryWorkspaceModeSection, { repo, updateRepo, forceVisible })
    )
  })
}

function getStartFolderInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input')
  if (!input) {
    throw new Error('start folder input not found')
  }
  return input
}

function getSwitch(): HTMLButtonElement {
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')
  if (!toggle) {
    throw new Error('in-place workspaces switch not found')
  }
  return toggle
}

function typeText(input: HTMLInputElement, text: string): void {
  // Why: React tracks controlled-input values via the native setter, so assigning input.value is swallowed.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setValue?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function blurInput(input: HTMLInputElement): void {
  // Why: React delegates onBlur via focusout, which bubbles; a plain blur event never reaches it.
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

describe('RepositoryWorkspaceModeSection — in-place switch', () => {
  it('reflects the stored setting and turns it on from the default', () => {
    const updateRepo = vi.fn()
    render(BASE_REPO, updateRepo)

    expect(getSwitch().getAttribute('aria-checked')).toBe('false')
    act(() => {
      getSwitch().click()
    })

    expect(updateRepo).toHaveBeenCalledTimes(1)
    expect(updateRepo).toHaveBeenCalledWith('repo-1', { inPlaceWorkspaces: true })
  })

  it('turns an enabled setting back off with an explicit false', () => {
    const updateRepo = vi.fn()
    render({ ...BASE_REPO, inPlaceWorkspaces: true }, updateRepo)

    expect(getSwitch().getAttribute('aria-checked')).toBe('true')
    act(() => {
      getSwitch().click()
    })

    expect(updateRepo).toHaveBeenCalledTimes(1)
    expect(updateRepo).toHaveBeenCalledWith('repo-1', { inPlaceWorkspaces: false })
  })
})

describe('RepositoryWorkspaceModeSection — start folder', () => {
  it('does not call updateRepo while the user is typing', () => {
    const updateRepo = vi.fn()
    render(BASE_REPO, updateRepo)

    const input = getStartFolderInput()
    typeText(input, 'ser')
    typeText(input, 'services/api')

    expect(updateRepo).not.toHaveBeenCalled()
  })

  it('shows the stored value', () => {
    render({ ...BASE_REPO, workspaceStartPath: 'services/api' }, vi.fn())

    expect(getStartFolderInput().value).toBe('services/api')
  })

  it('sends the normalized value on blur', () => {
    const updateRepo = vi.fn()
    render(BASE_REPO, updateRepo)

    const input = getStartFolderInput()
    typeText(input, '  services//api/./  ')
    blurInput(input)

    expect(updateRepo).toHaveBeenCalledTimes(1)
    expect(updateRepo).toHaveBeenCalledWith('repo-1', { workspaceStartPath: 'services/api' })
  })

  it.each(['../x', '/abs', 'a/../../b', '\\abs', 'C:\\abs'])(
    'does not send the invalid start folder %s',
    (invalid) => {
      const updateRepo = vi.fn()
      render({ ...BASE_REPO, workspaceStartPath: 'services/api' }, updateRepo)

      const input = getStartFolderInput()
      typeText(input, invalid)
      blurInput(input)

      expect(updateRepo).not.toHaveBeenCalled()
    }
  )

  it('does not send a value that normalizes to the stored one', () => {
    const updateRepo = vi.fn()
    render({ ...BASE_REPO, workspaceStartPath: 'services/api' }, updateRepo)

    const input = getStartFolderInput()
    typeText(input, ' services//api/ ')
    blurInput(input)

    expect(updateRepo).not.toHaveBeenCalled()
  })

  it('does not send anything when an empty field blurs untouched', () => {
    const updateRepo = vi.fn()
    render(BASE_REPO, updateRepo)

    blurInput(getStartFolderInput())

    expect(updateRepo).not.toHaveBeenCalled()
  })

  it.each(['', '   ', './'])(
    'clears the setting with undefined when the field is %j',
    (cleared) => {
      const updateRepo = vi.fn()
      render({ ...BASE_REPO, workspaceStartPath: 'services/api' }, updateRepo)

      const input = getStartFolderInput()
      typeText(input, cleared)
      blurInput(input)

      // Strict equality keeps the explicit undefined key that tells the store to drop the value.
      expect(updateRepo.mock.calls).toStrictEqual([['repo-1', { workspaceStartPath: undefined }]])
    }
  )
})

describe('RepositoryWorkspaceModeSection — settings search', () => {
  it('shows both rows when the search is empty', () => {
    render(BASE_REPO, vi.fn(), false)

    expect(container.textContent).toContain(IN_PLACE_TITLE)
    expect(container.textContent).toContain('Start folder')
  })

  it('finds only the in-place row by its own keyword', () => {
    searchState.query = 'monolith'
    render(BASE_REPO, vi.fn(), false)

    expect(container.textContent).toContain(IN_PLACE_TITLE)
    expect(container.textContent).not.toContain('Start folder')
  })

  it('finds only the start folder row by its own keyword', () => {
    searchState.query = 'working directory'
    render(BASE_REPO, vi.fn(), false)

    expect(container.textContent).not.toContain(IN_PLACE_TITLE)
    expect(container.textContent).toContain('Start folder')
  })

  it('matches both rows on the project name', () => {
    searchState.query = 'My Monorepo'
    render(BASE_REPO, vi.fn(), false)

    expect(container.textContent).toContain(IN_PLACE_TITLE)
    expect(container.textContent).toContain('Start folder')
  })

  it('hides both rows when nothing matches', () => {
    searchState.query = 'zzz-no-such-setting'
    render(BASE_REPO, vi.fn(), false)

    expect(container.textContent).toBe('')
  })
})
