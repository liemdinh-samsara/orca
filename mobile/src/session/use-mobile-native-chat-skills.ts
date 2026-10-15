import { useEffect, useMemo, useState } from 'react'
import type { AgentSessionSlashCommand } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import {
  readMobileNativeChatSkills,
  type MobileNativeChatSkill
} from './mobile-native-chat-skill-read'

const NO_SKILLS: readonly MobileNativeChatSkill[] = []

/**
 * The skills the host says this chat's agent can run, for the `/` menu. It asks whenever a new
 * slash starts (`wanted` rising), so a skill created meanwhile shows up with no restart; the host
 * shares its scans for a few seconds, so this stays cheap. A refresh that gets no answer keeps the
 * last list, and a list is only ever shown for the workspace and agent it was read for.
 */
export function useMobileNativeChatSkills(args: {
  client: RpcClient | null
  worktreeId: string | null
  agent: string | null
  wanted: boolean
}): readonly MobileNativeChatSkill[] {
  const { client, worktreeId, agent, wanted } = args
  const key = worktreeId && agent ? JSON.stringify([worktreeId, agent]) : null
  const [known, setKnown] = useState<{
    key: string
    skills: readonly MobileNativeChatSkill[]
  } | null>(null)

  useEffect(() => {
    if (!wanted || !client || !worktreeId || !agent || key === null) {
      return
    }
    let stale = false
    void readMobileNativeChatSkills(client, worktreeId, agent).then((skills) => {
      if (!stale && skills !== null) {
        setKnown({ key, skills })
      }
    })
    return () => {
      stale = true
    }
  }, [wanted, client, worktreeId, agent, key])

  return known !== null && known.key === key ? known.skills : NO_SKILLS
}

// A slash token still being typed: `/` or `/liem`, not `/liem some text`.
const SLASH_TOKEN = /^\/\S*$/

/** The host's skills as the reported `/` entries a composer already knows how to list. */
export function useMobileNativeChatHostSkills(args: {
  client: RpcClient | null
  worktreeId: string | null
  agent: string | null
  composerText: string
}): readonly AgentSessionSlashCommand[] {
  const skills = useMobileNativeChatSkills({ ...args, wanted: SLASH_TOKEN.test(args.composerText) })
  return useMemo(
    () =>
      skills.map((skill): AgentSessionSlashCommand => ({
        name: skill.name,
        kind: 'skill',
        ...(skill.description ? { description: skill.description } : {})
      })),
    [skills]
  )
}
