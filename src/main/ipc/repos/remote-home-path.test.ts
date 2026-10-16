import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  connection: { current: {} as object | undefined },
  resolveRemoteDirectory: vi.fn()
}))

vi.mock('../../ssh/ssh-target-registry', () => ({
  getSshConnectionManager: () => ({ getConnection: () => mocks.connection.current })
}))
vi.mock('../ssh-browse', () => ({ resolveRemoteDirectory: mocks.resolveRemoteDirectory }))

import { resolveRemoteHomePath } from './remote-home-path'

describe('resolveRemoteHomePath', () => {
  beforeEach(() => {
    mocks.connection.current = {}
    mocks.resolveRemoteDirectory.mockReset().mockResolvedValue('/home/ubuntu')
  })

  it('expands ~ and ~/sub against the host home', async () => {
    await expect(resolveRemoteHomePath('devbox', '~')).resolves.toBe('/home/ubuntu')
    await expect(resolveRemoteHomePath('devbox', '~/')).resolves.toBe('/home/ubuntu')
    await expect(resolveRemoteHomePath('devbox', '~/co/src')).resolves.toBe('/home/ubuntu/co/src')
    expect(mocks.resolveRemoteDirectory).toHaveBeenCalledWith(mocks.connection.current, '~')
  })

  it('leaves absolute paths alone without touching the host', async () => {
    await expect(resolveRemoteHomePath('devbox', '/data/src')).resolves.toBe('/data/src')
    expect(mocks.resolveRemoteDirectory).not.toHaveBeenCalled()
  })

  it('returns the path unexpanded when offline, homeless or failing', async () => {
    mocks.connection.current = undefined
    await expect(resolveRemoteHomePath('devbox', '~/co')).resolves.toBe('~/co')
    mocks.connection.current = {}
    mocks.resolveRemoteDirectory.mockResolvedValueOnce(null)
    await expect(resolveRemoteHomePath('devbox', '~/co')).resolves.toBe('~/co')
    mocks.resolveRemoteDirectory.mockRejectedValueOnce(new Error('channel closed'))
    await expect(resolveRemoteHomePath('devbox', '~/co')).resolves.toBe('~/co')
  })
})
