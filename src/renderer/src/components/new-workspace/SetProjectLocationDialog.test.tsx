// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NeedsSetupProjectHostOption } from '@/lib/project-host-setup-options'

const storeMocks = vi.hoisted(() => ({
  setupProjectExistingFolder: vi.fn(),
  setupProjectClone: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector(storeMocks)
}))

vi.mock('@/components/sidebar/RemoteFileBrowser', () => ({
  RemoteFileBrowser: ({
    targetId,
    onSelect,
    onCancel
  }: {
    targetId?: string
    onSelect: (path: string) => void
    onCancel: () => void
  }) => (
    <div data-testid="remote-file-browser" data-target={targetId ?? ''}>
      <button type="button" onClick={() => onSelect('/remote/orca')}>
        Select remote folder
      </button>
      <button type="button" onClick={onCancel}>
        Cancel browse
      </button>
    </div>
  )
}))

import { SetProjectLocationDialog } from './SetProjectLocationDialog'

const option: NeedsSetupProjectHostOption = {
  kind: 'needs-setup',
  id: 'needs-setup:ssh:openclaw',
  projectId: 'project-orca',
  hostId: 'ssh:openclaw',
  label: 'openclaw',
  detail: 'Project location not set',
  isAvailable: true,
  attention: false,
  canSetLocation: true
}

function renderDialog(
  overrides: Partial<ComponentProps<typeof SetProjectLocationDialog>> = {}
): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup()
  render(
    <SetProjectLocationDialog
      option={option}
      projectName="orca"
      projectKind="git"
      defaultCloneUrl="git@github.com:stablyai/orca.git"
      onClose={vi.fn()}
      onReady={vi.fn()}
      {...overrides}
    />
  )
  return user
}

beforeEach(() => {
  storeMocks.setupProjectExistingFolder.mockReset()
  storeMocks.setupProjectClone.mockReset()
  storeMocks.setupProjectExistingFolder.mockResolvedValue({
    setup: { id: 'setup-openclaw' }
  })
  storeMocks.setupProjectClone.mockResolvedValue({
    setup: { id: 'setup-openclaw-clone' }
  })
})

afterEach(() => {
  cleanup()
})

describe('SetProjectLocationDialog', () => {
  it('opens the existing-folder form at the suggested path with the missing-path notice', () => {
    renderDialog({ suggestedPath: '/home/dev/co/orca' })

    expect(screen.getByPlaceholderText('/path/to/project/on/host').getAttribute('value')).toBe(
      '/home/dev/co/orca'
    )
    expect(screen.getByRole('button', { name: 'Set location' })).toBeTruthy()
    expect(
      screen.getByText(
        'Nothing was found at the matching path on openclaw. Check the path or browse for the project.'
      )
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Clone from URL/ })).toBeNull()
  })

  it('starts with the location choices and no missing-path notice without a suggestion', async () => {
    const user = renderDialog()

    expect(screen.getByRole('button', { name: /Browse folder/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Clone from URL/ })).toBeTruthy()
    expect(screen.queryByPlaceholderText('/path/to/project/on/host')).toBeNull()
    expect(screen.queryByText(/Nothing was found at the matching path/)).toBeNull()

    await user.click(screen.getByRole('button', { name: /Browse folder/ }))

    expect(screen.getByPlaceholderText('/path/to/project/on/host').getAttribute('value')).toBe('')
    expect(screen.queryByText(/Nothing was found at the matching path/)).toBeNull()
  })

  it('resets an edited path when the suggestion changes for the same host option', async () => {
    const props = {
      option,
      projectName: 'orca',
      projectKind: 'git' as const,
      defaultCloneUrl: '',
      onClose: vi.fn(),
      onReady: vi.fn()
    }
    const { rerender } = render(
      <SetProjectLocationDialog {...props} suggestedPath="/home/dev/co/orca" />
    )
    const user = userEvent.setup()
    const input = screen.getByPlaceholderText('/path/to/project/on/host')
    await user.clear(input)
    await user.type(input, '/my/custom/path')
    expect(input.getAttribute('value')).toBe('/my/custom/path')

    rerender(<SetProjectLocationDialog {...props} suggestedPath="/data/co/orca" />)

    expect(screen.getByPlaceholderText('/path/to/project/on/host').getAttribute('value')).toBe(
      '/data/co/orca'
    )
  })

  it('keeps the parent caller in charge of close and saves an existing folder', async () => {
    const onClose = vi.fn()
    const onReady = vi.fn()
    const user = renderDialog({ onClose, onReady })

    expect(screen.getByTestId('set-project-location-dialog')).toBeTruthy()
    expect(screen.getByText('Set project location')).toBeTruthy()
    expect(screen.getByText('Choose where orca lives on openclaw.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Browse folder/ }))
    await user.click(screen.getByRole('button', { name: 'Browse host filesystem' }))
    await user.click(screen.getByRole('button', { name: 'Select remote folder' }))
    await user.click(screen.getByRole('button', { name: 'Set location' }))

    expect(storeMocks.setupProjectExistingFolder).toHaveBeenCalledWith({
      projectId: 'project-orca',
      hostId: 'ssh:openclaw',
      path: '/remote/orca',
      kind: 'git',
      displayName: 'orca'
    })
    expect(onReady).toHaveBeenCalledWith(JSON.stringify(['setup-openclaw', 'ssh:openclaw']))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('clones onto the selected host', async () => {
    const onReady = vi.fn()
    const user = renderDialog({ onReady })

    await user.click(screen.getByRole('button', { name: /Clone from URL/ }))
    await user.click(screen.getByRole('button', { name: 'Browse host filesystem' }))
    await user.click(screen.getByRole('button', { name: 'Select remote folder' }))
    await user.click(screen.getByRole('button', { name: 'Clone' }))

    expect(storeMocks.setupProjectClone).toHaveBeenCalledWith({
      projectId: 'project-orca',
      hostId: 'ssh:openclaw',
      url: 'git@github.com:stablyai/orca.git',
      destination: '/remote/orca',
      displayName: 'orca'
    })
    expect(onReady).toHaveBeenCalledWith(JSON.stringify(['setup-openclaw-clone', 'ssh:openclaw']))
  })

  it('hides clone for folder projects', () => {
    renderDialog({ projectKind: 'folder' })
    expect(screen.queryByRole('button', { name: /Clone from URL/ })).toBeNull()
  })

  it('does not render when no host is selected', () => {
    render(
      <SetProjectLocationDialog
        option={null}
        projectName="orca"
        projectKind="git"
        defaultCloneUrl=""
        onClose={vi.fn()}
        onReady={vi.fn()}
      />
    )
    expect(screen.queryByTestId('set-project-location-dialog')).toBeNull()
  })

  it('backs out of the host browser on Escape instead of discarding the form', async () => {
    const onClose = vi.fn()
    const user = renderDialog({ onClose })

    await user.click(screen.getByRole('button', { name: /Browse folder/ }))
    await user.click(screen.getByRole('button', { name: 'Browse host filesystem' }))
    expect(screen.getByTestId('remote-file-browser')).toBeTruthy()

    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByTestId('remote-file-browser')).toBeNull()
    expect(screen.getByRole('button', { name: 'Set location' })).toBeTruthy()

    // A second Escape, now back on the form, dismisses the dialog as usual.
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('does not retarget the composer when a slow clone lands after dismissal', async () => {
    // An SSH clone is unbounded and the dialog stays dismissable while it runs.
    let finishClone: (result: { setup: { id: string } }) => void = () => {}
    storeMocks.setupProjectClone.mockReturnValue(
      new Promise((resolve) => {
        finishClone = resolve
      })
    )
    const onReady = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(
      <SetProjectLocationDialog
        option={option}
        projectName="orca"
        projectKind="git"
        defaultCloneUrl="https://github.com/stablyai/orca.git"
        onClose={onClose}
        onReady={onReady}
      />
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Clone from URL/ }))
    await user.type(screen.getByPlaceholderText('/destination/on/host'), '/remote/orca')
    await user.click(screen.getByRole('button', { name: 'Clone' }))

    // The user backs out and points the composer somewhere else.
    rerender(
      <SetProjectLocationDialog
        option={null}
        projectName="orca"
        projectKind="git"
        defaultCloneUrl="https://github.com/stablyai/orca.git"
        onClose={onClose}
        onReady={onReady}
      />
    )
    await act(async () => {
      finishClone({ setup: { id: 'setup-openclaw-clone' } })
    })

    expect(onReady).not.toHaveBeenCalled()
  })

  it('still reports success under StrictMode double-invoked effects', async () => {
    const onReady = vi.fn()
    render(
      <StrictMode>
        <SetProjectLocationDialog
          option={option}
          projectName="orca"
          projectKind="git"
          defaultCloneUrl="git@github.com:stablyai/orca.git"
          onClose={vi.fn()}
          onReady={onReady}
        />
      </StrictMode>
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Browse folder/ }))
    await user.type(screen.getByPlaceholderText('/path/to/project/on/host'), '/remote/orca')
    await user.click(screen.getByRole('button', { name: 'Set location' }))

    expect(onReady).toHaveBeenCalledWith(JSON.stringify(['setup-openclaw', 'ssh:openclaw']))
  })

  it('notifies the parent when dismissed', async () => {
    const onClose = vi.fn()
    renderDialog({ onClose })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')?.click()
    })
    expect(onClose).toHaveBeenCalled()
  })
})
