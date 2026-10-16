import { describe, expect, it } from 'vitest'
import { NativeChatSkills } from './native-chat-params'
import { RPC_PARAMS_BY_METHOD } from './rpc-params-catalog.generated'

const BASE = { worktreeId: 'wt-1', agent: 'claude' }

describe('nativeChat.skills params', () => {
  it('accepts a workspace and agent', () => {
    expect(NativeChatSkills.parse(BASE)).toEqual(BASE)
  })

  it('accepts worktreeId and agent at their length limits', () => {
    const params = { worktreeId: 'w'.repeat(2048), agent: 'a'.repeat(64) }
    expect(NativeChatSkills.parse(params)).toEqual(params)
  })

  it('rejects unknown keys', () => {
    expect(NativeChatSkills.safeParse({ ...BASE, refresh: true }).success).toBe(false)
  })

  it.each([
    ['empty worktreeId', { ...BASE, worktreeId: '' }],
    ['over-long worktreeId', { ...BASE, worktreeId: 'w'.repeat(2049) }],
    ['empty agent', { ...BASE, agent: '' }],
    ['over-long agent', { ...BASE, agent: 'a'.repeat(65) }],
    ['missing worktreeId', { agent: 'claude' }],
    ['missing agent', { worktreeId: 'wt-1' }],
    ['missing both fields', {}]
  ])('rejects %s', (_label, params) => {
    expect(NativeChatSkills.safeParse(params).success).toBe(false)
  })

  it('registers the skills schema in the generated RPC catalog', () => {
    expect(RPC_PARAMS_BY_METHOD['nativeChat.skills']).toBe(NativeChatSkills)
  })
})
