import { z } from 'zod'
import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'
import type { RpcClient } from '../transport/rpc-client'

export type MobileNativeChatSkill = { name: string; description: string | null }

const skillsReplySchema = z.looseObject({
  skills: z.array(
    z.looseObject({ name: z.string().max(200), description: z.string().max(400).nullable() })
  )
})

/** An error reply, an older host and an unreadable reply all read as null. */
const nativeChatSkillsRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'nativeChat.read-skills',
    method: 'nativeChat.skills',
    acceptance: 'object-result-or-null',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('native-chat-skills', skillsReplySchema)
  })
)

const READ_TIMEOUT_MS = 10_000

/**
 * The skills the host says this workspace's agent can run (repo and home folders alike), or null
 * when it gave no usable answer: an older host, a refusal, or no connection. Null means "keep what
 * the menu already has", never "there are none".
 */
export async function readMobileNativeChatSkills(
  client: RpcClient,
  worktreeId: string,
  agent: string
): Promise<readonly MobileNativeChatSkill[] | null> {
  let response
  try {
    response = await nativeChatSkillsRead.request(
      client,
      { worktreeId, agent },
      { timeoutMs: READ_TIMEOUT_MS, budgetSpansConnect: true }
    )
  } catch {
    return null
  }
  const reply = nativeChatSkillsRead.interpret(response)
  return reply === null
    ? null
    : reply.skills.map(({ name, description }) => ({ name, description }))
}
