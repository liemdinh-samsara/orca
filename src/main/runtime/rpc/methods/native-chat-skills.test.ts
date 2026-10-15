import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveredSkill, SkillDiscoveryResult } from '../../../../shared/skills'
import type { RpcContext } from '../core'

const discovery = vi.hoisted((): { result: SkillDiscoveryResult | null } => ({ result: null }))
vi.mock('../../../skills/skill-discovery-target', () => ({
  discoverSkillsOnTarget: vi.fn(async () => discovery.result)
}))
vi.mock('./skills', () => ({ resolveDiscoveryTarget: (params: unknown) => params }))

import { NativeChatSkills } from '../../../../shared/rpc-contract/native-chat-params'
import { NATIVE_CHAT_SKILL_METHODS } from './native-chat-skills'

const HOME_CLAUDE = '/home/u/.claude/skills'
const HOME_AGENTS = '/home/u/.agents/skills'
const REPO_CLAUDE = '/repo/.claude/skills'
const HOME_CODEX = '/home/u/.codex/skills'

function skill(name: string, rootPath: string, description: string | null = null): DiscoveredSkill {
  return {
    id: `${rootPath}/${name}`,
    name,
    description,
    providers: [],
    sourceKind: 'home',
    sourceLabel: 'x',
    rootPath,
    directoryPath: `${rootPath}/${name}`,
    skillFilePath: `${rootPath}/${name}/SKILL.md`,
    installed: true,
    updatedAt: null
  }
}

function source(path: string, owner: 'claude' | 'codex' | null) {
  return {
    id: path,
    label: path,
    path,
    sourceKind: 'home' as const,
    providers: [],
    owner,
    exists: true
  }
}

const method = NATIVE_CHAT_SKILL_METHODS[0]

function list(params: unknown): Promise<unknown> {
  const runtime = { listRepos: () => [], resolveSkillDiscoveryProviderRoots: async () => ({}) }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only runtime.listRepos and resolveSkillDiscoveryProviderRoots; the rest of RpcContext is transport it never touches.
  const context = { runtime } as unknown as RpcContext
  return method.handler(NativeChatSkills.parse(params), context)
}

beforeEach(() => {
  discovery.result = null
})

describe('nativeChat.skills', () => {
  it('offers the repo, Claude-home and shared-home skills a Claude chat can run', async () => {
    discovery.result = {
      skills: [
        skill('liem-upload-report', HOME_CLAUDE, 'Publish a report'),
        skill('agent-browser', HOME_AGENTS),
        skill('repo-skill', REPO_CLAUDE),
        skill('codex-only', HOME_CODEX)
      ],
      sources: [
        source(HOME_CLAUDE, 'claude'),
        source(HOME_AGENTS, null),
        source(REPO_CLAUDE, 'claude'),
        source(HOME_CODEX, 'codex')
      ],
      scannedAt: 1
    }

    await expect(list({ worktreeId: 'wt', agent: 'claude' })).resolves.toEqual({
      skills: [
        { name: 'agent-browser', description: null },
        { name: 'liem-upload-report', description: 'Publish a report' },
        { name: 'repo-skill', description: null }
      ]
    })
  })

  it('never sends file paths to the phone', async () => {
    discovery.result = {
      skills: [skill('a-skill', HOME_CLAUDE)],
      sources: [source(HOME_CLAUDE, 'claude')],
      scannedAt: 1
    }

    expect(JSON.stringify(await list({ worktreeId: 'wt', agent: 'claude' }))).not.toContain('/home')
  })

  it('lists a skill once and drops names that cannot be typed as one token', async () => {
    discovery.result = {
      skills: [
        skill('dup', HOME_CLAUDE),
        skill('dup', REPO_CLAUDE),
        skill('has space', HOME_CLAUDE),
        skill('bad‮name', HOME_CLAUDE),
        skill('plugin:check', HOME_CLAUDE, 'ok‮ hidden')
      ],
      sources: [source(HOME_CLAUDE, 'claude'), source(REPO_CLAUDE, 'claude')],
      scannedAt: 1
    }

    await expect(list({ worktreeId: 'wt', agent: 'claude' })).resolves.toEqual({
      skills: [
        { name: 'dup', description: null },
        { name: 'plugin:check', description: 'ok hidden' }
      ]
    })
  })

  it('offers nothing to an agent whose skills are not invoked with a slash', async () => {
    discovery.result = {
      skills: [skill('a-skill', HOME_CODEX)],
      sources: [source(HOME_CODEX, 'codex')],
      scannedAt: 1
    }

    await expect(list({ worktreeId: 'wt', agent: 'codex' })).resolves.toEqual({ skills: [] })
  })

  it('answers an empty list when the scan finds nothing', async () => {
    discovery.result = { skills: [], sources: [], scannedAt: 1 }

    await expect(list({ worktreeId: 'wt', agent: 'claude' })).resolves.toEqual({ skills: [] })
  })
})
