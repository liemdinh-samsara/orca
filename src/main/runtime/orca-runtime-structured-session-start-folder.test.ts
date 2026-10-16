import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Repo } from '../../shared/repo-types'
import { ensureStructuredAgentSessionHost } from './structured-agent-session-runtime'
import { OrcaRuntimeService } from './orca-runtime'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))
vi.mock('./structured-agent-session-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureStructuredAgentSessionHost: vi.fn(async () => undefined)
}))

const directories: string[] = []
afterEach(() => {
  vi.mocked(ensureStructuredAgentSessionHost).mockClear()
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

async function resolveStructuredChatCwd(
  workspacePath: string,
  repo: Repo | null
): Promise<string | undefined> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: host installation reads only getRepo from the store on this path.
  const runtime = new OrcaRuntimeService({ getRepo: () => repo } as never)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: exposes the protected workspace resolver with its actual return shape.
  const internals = runtime as unknown as {
    resolveRuntimeFileTarget: (selector: string) => Promise<unknown>
  }
  vi.spyOn(internals, 'resolveRuntimeFileTarget').mockResolvedValue({
    worktree: { id: 'wt-1', repoId: 'repo-1', path: workspacePath },
    executionHostId: 'local'
  })
  await runtime.ensureStructuredAgentSessionHost()
  const deps = vi.mocked(ensureStructuredAgentSessionHost).mock.calls.at(-1)?.[0]
  return deps?.resolveWorkspacePath('wt-1')
}

function projectRepo(path: string, workspaceStartPath?: string): Repo {
  return {
    id: 'repo-1',
    path,
    displayName: 'app',
    badgeColor: 'blue',
    addedAt: 0,
    kind: 'git',
    workspaceStartPath
  }
}

describe('structured chat session start folder', () => {
  it('starts in the project start folder when it exists', async () => {
    const path = mkdtempSync(join(tmpdir(), 'orca-structured-start-'))
    directories.push(path)
    mkdirSync(join(path, 'packages', 'web'), { recursive: true })

    await expect(resolveStructuredChatCwd(path, projectRepo(path, 'packages/web'))).resolves.toBe(
      join(path, 'packages', 'web')
    )
  })

  it('falls back to the workspace root when the start folder was deleted', async () => {
    const path = mkdtempSync(join(tmpdir(), 'orca-structured-start-'))
    directories.push(path)

    await expect(resolveStructuredChatCwd(path, projectRepo(path, 'packages/web'))).resolves.toBe(
      path
    )
  })

  it('uses the workspace root when the project has no start folder', async () => {
    const path = mkdtempSync(join(tmpdir(), 'orca-structured-start-'))
    directories.push(path)

    await expect(resolveStructuredChatCwd(path, projectRepo(path))).resolves.toBe(path)
    await expect(resolveStructuredChatCwd(path, null)).resolves.toBe(path)
  })
})
