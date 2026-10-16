import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveredSkill, SkillDiscoveryResult } from '../../../../shared/skills'
import type { RpcContext } from '../core'

const discovery = vi.hoisted((): { result: SkillDiscoveryResult | null } => ({ result: null }))
vi.mock('../../../skills/skill-discovery-target', () => ({
  discoverSkillsOnTarget: vi.fn(async () => discovery.result)
}))
vi.mock('./skills', () => ({ resolveDiscoveryTarget: vi.fn() }))

import { discoverSkillsOnTarget } from '../../../skills/skill-discovery-target'
import { resolveDiscoveryTarget } from './skills'
import { NativeChatSkills } from '../../../../shared/rpc-contract/native-chat-params'
import { NATIVE_CHAT_SKILL_METHODS } from './native-chat-skills'
import { MOBILE_RPC_METHOD_ALLOWLIST } from '../../runtime-rpc/runtime-rpc-mobile-method-allowlist'
import { MOBILE_RPC_METHOD_ROUTES } from '../../runtime-rpc/runtime-rpc-mobile-method-routing'

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

const repos = [{ id: 'repo-1', path: '/repo' }]
const providerRootOverrides = { claude: '/custom/claude/skills' }
const runtime = {
  listRepos: vi.fn(() => repos),
  resolveSkillDiscoveryProviderRoots: vi.fn(async () => providerRootOverrides)
}

function list(params: unknown): Promise<unknown> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only runtime.listRepos and resolveSkillDiscoveryProviderRoots; the rest of RpcContext is transport it never touches.
  const context = { runtime } as unknown as RpcContext
  return method.handler(NativeChatSkills.parse(params), context)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveDiscoveryTarget).mockReturnValue({ kind: 'native-host', cwd: '/repo' })
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
    expect(discoverSkillsOnTarget).not.toHaveBeenCalled()
    expect(resolveDiscoveryTarget).not.toHaveBeenCalled()
  })

  it('answers an empty list when the scan finds nothing', async () => {
    discovery.result = { skills: [], sources: [], scannedAt: 1 }

    await expect(list({ worktreeId: 'wt', agent: 'claude' })).resolves.toEqual({ skills: [] })
  })

  it.each([
    [null, 'Publish a report'],
    ['Publish a report', null]
  ])(
    'prefers a described duplicate when descriptions arrive as %s then %s',
    async (first, second) => {
      discovery.result = {
        skills: [skill('dup', HOME_CLAUDE, first), skill('dup', REPO_CLAUDE, second)],
        sources: [source(HOME_CLAUDE, 'claude'), source(REPO_CLAUDE, 'claude')],
        scannedAt: 1
      }

      await expect(list({ worktreeId: 'wt', agent: 'claude' })).resolves.toEqual({
        skills: [{ name: 'dup', description: 'Publish a report' }]
      })
    }
  )

  it('truncates descriptions to 200 characters', async () => {
    discovery.result = {
      skills: [skill('long-description', HOME_CLAUDE, `${'a'.repeat(200)}discarded`)],
      sources: [source(HOME_CLAUDE, 'claude')],
      scannedAt: 1
    }

    await expect(list({ worktreeId: 'wt', agent: 'claude' })).resolves.toEqual({
      skills: [{ name: 'long-description', description: 'a'.repeat(200) }]
    })
  })

  it('offers nothing without scanning for an agent with no native-chat profile', async () => {
    await expect(list({ worktreeId: 'wt', agent: 'unknown-agent' })).resolves.toEqual({
      skills: []
    })
    expect(discoverSkillsOnTarget).not.toHaveBeenCalled()
    expect(resolveDiscoveryTarget).not.toHaveBeenCalled()
  })

  it.each([
    ['local worktree', 'wt-1', '/repo/worktree'],
    ['folder workspace', 'folder:/projects/my folder', '/projects/my folder'],
    ['SSH worktree', 'ssh:host-1:wt-remote', '/remote/repo']
  ])(
    'scans the resolved %s target with provider roots and refresh disabled',
    async (_label, worktreeId, cwd) => {
      const target = { kind: 'native-host' as const, cwd }
      vi.mocked(resolveDiscoveryTarget).mockReturnValueOnce(target)
      discovery.result = { skills: [], sources: [], scannedAt: 1 }

      await list({ worktreeId, agent: 'claude' })

      expect(resolveDiscoveryTarget).toHaveBeenCalledExactlyOnceWith({ worktreeId }, runtime)
      expect(runtime.resolveSkillDiscoveryProviderRoots).toHaveBeenCalledExactlyOnceWith(target)
      expect(runtime.listRepos).toHaveBeenCalledExactlyOnceWith()
      expect(discoverSkillsOnTarget).toHaveBeenCalledExactlyOnceWith(target, repos, {
        providerRootOverrides,
        refresh: false
      })
    }
  )
})

describe('nativeChat.skills mobile routing', () => {
  it('lets a paired phone call it on the host that owns the workspace', () => {
    expect(MOBILE_RPC_METHOD_ALLOWLIST.has('nativeChat.skills')).toBe(true)
    expect(MOBILE_RPC_METHOD_ROUTES.get('nativeChat.skills')).toBe('execution-host')
  })
})
