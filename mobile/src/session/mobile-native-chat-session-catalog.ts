import type { AgentSessionConversationCommand } from '../../../src/shared/agent-session-conversation-command'
import type { AgentSessionSlashCommand } from '../../../src/shared/agent-session-wire'
import {
  sessionSlashCommandSuggestions,
  type SlashCommandSuggestion
} from '../../../src/shared/native-chat-slash-commands'
import { structuredSlashCommands } from '../../../src/shared/structured-agent-session-composer'
import { getMobileNativeChatCommands } from './mobile-native-chat-send-classification'

// Why: desktop shows reported skills in a separate picker group; mobile has no such
// group, so the `/` menu lists them after the commands. A command wins a shared name.
function skillRows(
  reported: readonly AgentSessionSlashCommand[],
  commands: readonly SlashCommandSuggestion[]
): SlashCommandSuggestion[] {
  const taken = new Set(commands.map((command) => command.name))
  return reported
    .filter((entry) => entry.kind === 'skill' && !taken.has(entry.name))
    .map((entry): SlashCommandSuggestion => ({
      name: entry.name,
      ...(entry.description ? { description: entry.description } : {}),
      ...(entry.argumentHint ? { argumentHint: entry.argumentHint } : {})
    }))
}

export function mobileSessionSlashSuggestions(
  agent: string,
  reported: readonly AgentSessionSlashCommand[]
): readonly SlashCommandSuggestion[] {
  const commands = sessionSlashCommandSuggestions(agent, reported)
  return [...commands, ...skillRows(reported, commands)]
}

/** What the composer's `/` menu offers. A structured session's own report wins once the host
 *  sends it; a terminal-backed chat has no report, so the host's skills follow its curated
 *  commands (a command keeps its name over a skill's). */
export function mobileSlashCommands(args: {
  agent?: string | null
  structuredCommands?: readonly AgentSessionConversationCommand[]
  sessionCommands?: readonly AgentSessionSlashCommand[]
}): readonly SlashCommandSuggestion[] {
  const { agent, structuredCommands, sessionCommands } = args
  if (structuredCommands === undefined) {
    const commands = agent ? getMobileNativeChatCommands(agent) : []
    return [...commands, ...skillRows(sessionCommands ?? [], commands)]
  }
  return agent && sessionCommands !== undefined
    ? mobileSessionSlashSuggestions(agent, sessionCommands)
    : structuredSlashCommands(structuredCommands, agent)
}
