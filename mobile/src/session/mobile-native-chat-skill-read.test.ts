import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { readMobileNativeChatSkills } from './mobile-native-chat-skill-read'

function success(result: unknown): RpcResponse {
  return { id: '1', ok: true, result }
}

function failure(code: string, message = code): RpcResponse {
  return { id: '1', ok: false, error: { code, message } }
}

function clientWith(sendRequest: ReturnType<typeof vi.fn>): RpcClient {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the reader calls only sendRequest; the rest of RpcClient is connection lifecycle it never touches.
  return { sendRequest } as unknown as RpcClient
}

describe('readMobileNativeChatSkills', () => {
  it('asks the host for the workspace and agent, and returns the skills it names', async () => {
    const sendRequest = vi.fn().mockResolvedValue(
      success({
        skills: [
          { name: 'liem-upload-report', description: 'Publish a report' },
          { name: 'orca-cli', description: null }
        ]
      })
    )

    await expect(
      readMobileNativeChatSkills(clientWith(sendRequest), 'wt-1', 'claude')
    ).resolves.toEqual([
      { name: 'liem-upload-report', description: 'Publish a report' },
      { name: 'orca-cli', description: null }
    ])
    expect(sendRequest).toHaveBeenCalledWith(
      'nativeChat.skills',
      { worktreeId: 'wt-1', agent: 'claude' },
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  it.each([
    ['an older host that does not allow the method', failure('forbidden')],
    ['a host that predates the method', failure('method_not_found')],
    ['a host error', failure('internal_error')],
    ['an unreadable reply', success({ skills: 'nope' })],
    ['a reply with no result', success(undefined)]
  ])('reports nothing known for %s', async (_label, response) => {
    const sendRequest = vi.fn().mockResolvedValue(response)

    await expect(
      readMobileNativeChatSkills(clientWith(sendRequest), 'wt-1', 'claude')
    ).resolves.toBeNull()
  })

  it('reports nothing known when the request itself fails', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('socket closed'))

    await expect(
      readMobileNativeChatSkills(clientWith(sendRequest), 'wt-1', 'claude')
    ).resolves.toBeNull()
  })
})
