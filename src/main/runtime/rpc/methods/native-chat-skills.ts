import { getNativeChatAgentProfile } from '../../../../shared/native-chat-agent-profiles'
import { isNativeChatSkillForAgent } from '../../../../shared/native-chat-skill-visibility'
import { NativeChatSkills } from '../../../../shared/rpc-contract/native-chat-params'
import { stripUnsafeDisplayCharacters } from '../../../../shared/skill-display-text'
import { discoverSkillsOnTarget } from '../../../skills/skill-discovery-target'
import { defineMethod } from '../core'
import { resolveDiscoveryTarget } from './skills'

// A skill name is typed into the chat composer as one `/token`, so anything else is dropped.
const TYPEABLE_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const MAX_DESCRIPTION_LENGTH = 200

type NativeChatSkillRow = { name: string; description: string | null }

export const NATIVE_CHAT_SKILL_METHODS = [
  defineMethod({
    name: 'nativeChat.skills',
    permission: 'workspace',
    params: NativeChatSkills,
    handler: async (params, { runtime }): Promise<{ skills: NativeChatSkillRow[] }> => {
      // Why: skills with a `$` sigil are Codex grammar, which the phone composer does not offer.
      if (getNativeChatAgentProfile(params.agent)?.skillPrefix !== '/') {
        return { skills: [] }
      }
      const target = resolveDiscoveryTarget({ worktreeId: params.worktreeId }, runtime)
      const result = await discoverSkillsOnTarget(target, runtime.listRepos(), {
        providerRootOverrides: await runtime.resolveSkillDiscoveryProviderRoots(target),
        refresh: false
      })
      const rows = new Map<string, NativeChatSkillRow>()
      for (const skill of result.skills) {
        if (!isNativeChatSkillForAgent(params.agent, skill, result)) {
          continue
        }
        const name = stripUnsafeDisplayCharacters(skill.name)
        if (name !== skill.name || !TYPEABLE_SKILL_NAME.test(name)) {
          continue
        }
        const description = skill.description
          ? stripUnsafeDisplayCharacters(skill.description).slice(0, MAX_DESCRIPTION_LENGTH)
          : null
        const existing = rows.get(name)
        if (!existing || (existing.description === null && description)) {
          rows.set(name, { name, description })
        }
      }
      return { skills: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)) }
    }
  })
]
