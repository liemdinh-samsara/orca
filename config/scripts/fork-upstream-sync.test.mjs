import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcessSync } from '@orca/process-host'
import {
  defaultBranch,
  originRepository,
  publishSync,
  readState,
  renderPrBody,
  startSync,
  syncSummary,
  topAreas
} from './fork-upstream-sync.mjs'

const script = resolve(import.meta.dirname, 'fork-upstream-sync.mjs')
let scratch
let work
let source
let origin
let upstream

function write(root, file, content) {
  const target = join(root, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function git(root, ...args) {
  const result = runProcessSync({ program: 'git', args, cwd: root })
  expect(result.code, result.stderr || result.stdout).toBe(0)
  return result.stdout.trim()
}

function cli(root, ...args) {
  return runProcessSync({ program: process.execPath, args: [script, ...args], cwd: root })
}

function commit(root, file, content, subject) {
  write(root, file, content)
  git(root, 'add', '--', file)
  git(root, 'commit', '-qm', subject)
  return git(root, 'rev-parse', 'HEAD')
}

function upstreamCommit(
  file = 'docs/upstream.md',
  content = 'upstream\n',
  subject = 'feat: upstream'
) {
  const sha = commit(source, file, content, subject)
  git(source, 'push', 'origin', 'main')
  return sha
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'orca-upstream-sync-'))
  const config = join(scratch, 'gitconfig')
  writeFileSync(config, '[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n')
  for (const [key, value] of Object.entries({
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Sync Test',
    GIT_AUTHOR_EMAIL: 'sync@example.test',
    GIT_COMMITTER_NAME: 'Sync Test',
    GIT_COMMITTER_EMAIL: 'sync@example.test',
    GIT_TERMINAL_PROMPT: '0',
    ORCA_BACKGROUND_LAUNCH: '1'
  })) {
    vi.stubEnv(key, value)
  }
  origin = join(scratch, 'origin.git')
  upstream = join(scratch, 'upstream.git')
  for (const repo of [origin, upstream]) {
    git(scratch, 'init', '--bare', repo)
    git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  }
  const seed = join(scratch, 'seed')
  mkdirSync(seed)
  git(seed, 'init')
  git(seed, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  write(seed, 'src/main/fork/value.txt', 'base\n')
  write(
    seed,
    'config/fork/fork-features.json',
    JSON.stringify({
      upstream: { remote: 'upstream', url: upstream, branch: 'main' },
      features: []
    })
  )
  git(seed, 'add', '.')
  git(seed, 'commit', '-qm', 'chore: initial')
  git(seed, 'push', origin, 'main')
  git(seed, 'push', upstream, 'main')
  work = join(scratch, 'work')
  source = join(scratch, 'source')
  git(scratch, 'clone', origin, work)
  git(scratch, 'clone', upstream, source)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(scratch, { recursive: true, force: true })
})

describe('start and status', () => {
  it('merges from origin/main on a new branch and persists both merge parents', () => {
    const baseSha = commit(work, 'docs/fork.md', 'fork\n', 'feat: fork')
    git(work, 'push', 'origin', 'main')
    upstreamCommit('docs/first.md', 'one\n', 'feat: first upstream')
    const upstreamSha = upstreamCommit('docs/last.md', 'two\n', 'fix: last upstream')
    const result = cli(work, 'start', '--branch', 'sync/clean', '--json')
    expect(result.code, result.stderr).toBe(0)
    const state = JSON.parse(result.stdout)
    expect(state).toMatchObject({
      status: 'merged',
      branch: 'sync/clean',
      base: 'origin/main',
      baseSha,
      upstreamRef: 'upstream/main',
      upstreamSha,
      behind: 2,
      forkAhead: 1,
      conflicts: []
    })
    expect(Number.isNaN(Date.parse(state.startedAt))).toBe(false)
    expect(readState(work)).toEqual(state)
    expect(git(work, 'rev-list', '--parents', '-1', 'HEAD').split(' ').slice(1)).toEqual([
      baseSha,
      upstreamSha
    ])
    expect(git(work, 'log', '-1', '--format=%s')).toMatch(
      /^chore: sync upstream stablyai\/orca main \(2 commits, up to [a-f0-9]+\)$/
    )
    expect(git(work, 'rev-parse', 'main')).toBe(baseSha)
    expect(git(origin, 'rev-parse', 'main')).toBe(baseSha)
    const status = cli(work, 'status', '--json')
    expect(status.code, status.stderr).toBe(0)
    expect(JSON.parse(status.stdout)).toMatchObject({
      ...state,
      mergeInProgress: false,
      unresolved: [],
      head: git(work, 'rev-parse', 'HEAD')
    })
  })

  it('does not create or switch branches when already up to date', () => {
    const before = git(work, 'for-each-ref', '--format=%(refname)', 'refs/heads/')
    const result = cli(work, 'start', '--json')
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'up-to-date',
      branch: null,
      behind: 0
    })
    expect(git(work, 'branch', '--show-current')).toBe('main')
    expect(git(work, 'for-each-ref', '--format=%(refname)', 'refs/heads/')).toBe(before)
  })

  it('leaves conflicts in progress and annotates injected feature owners', async () => {
    commit(work, 'src/main/fork/value.txt', 'fork\n', 'feat: fork edit')
    git(work, 'push', 'origin', 'main')
    upstreamCommit('src/main/fork/value.txt', 'upstream\n')
    const resolveOwners = vi.fn((files) => new Map(files.map((f) => [f, ['personal-feature']])))
    const result = await startSync(work, { branch: 'sync/conflict', resolveOwners })
    expect(result.exitCode).toBe(2)
    expect(result.state.status).toBe('conflicts')
    expect(result.state.conflicts).toEqual([
      { file: 'src/main/fork/value.txt', owners: ['personal-feature'] }
    ])
    expect(resolveOwners).toHaveBeenCalledWith(['src/main/fork/value.txt'])
    const status = JSON.parse(cli(work, 'status', '--json').stdout)
    expect(status).toMatchObject({ mergeInProgress: true, unresolved: ['src/main/fork/value.txt'] })
    expect(readState(work)).toEqual(result.state)
    write(work, 'src/main/fork/value.txt', 'resolved\n')
    git(work, 'add', 'src/main/fork/value.txt')
    expect(JSON.parse(cli(work, 'status', '--json').stdout)).toMatchObject({
      mergeInProgress: true,
      unresolved: []
    })
    const blocked = cli(work, 'start', '--json')
    expect(blocked.code).toBe(3)
    expect(blocked.stderr).toContain('merge is already in progress')
    expect(git(work, 'rev-parse', 'MERGE_HEAD')).toBe(status.upstreamSha)
  })

  it('returns exit 2 with unowned conflicts when the optional contract is unavailable', () => {
    commit(work, 'src/main/fork/value.txt', 'fork\n', 'feat: fork edit')
    git(work, 'push', 'origin', 'main')
    upstreamCommit('src/main/fork/value.txt', 'upstream\n')
    const result = cli(work, 'start', '--json')
    expect(result.code, result.stderr).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'conflicts',
      conflicts: [{ file: 'src/main/fork/value.txt', owners: [] }]
    })
  })

  it('rejects a dirty working tree before adding remotes or changing branches', () => {
    write(work, 'untracked.txt', 'dirty\n')
    const result = cli(work, 'start', '--json')
    expect(result.code).toBe(3)
    expect(result.stderr).toContain('Working tree is dirty')
    expect(readState(work).status).toBe('blocked')
    expect(git(work, 'remote')).toBe('origin')
    expect(git(work, 'branch', '--show-current')).toBe('main')
  })

  it('uses local date components for the default branch', () => {
    expect(defaultBranch(new Date(2026, 0, 2, 23, 59))).toBe('sync/upstream-2026-01-02')
  })

  it('skips local and origin branch collisions', () => {
    upstreamCommit()
    const branch = defaultBranch()
    git(work, 'branch', branch)
    git(source, 'push', origin, `HEAD:refs/heads/${branch}-2`)
    const result = cli(work, 'start', '--json')
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).branch).toBe(`${branch}-3`)
  })

  it('appends -2 for an existing local branch with --no-fetch', () => {
    upstreamCommit()
    git(work, 'remote', 'add', 'upstream', upstream)
    git(work, 'fetch', 'upstream')
    git(work, 'branch', 'sync/collision')
    git(work, 'remote', 'set-url', 'origin', join(scratch, 'unavailable.git'))
    const result = cli(work, 'start', '--branch', 'sync/collision', '--no-fetch', '--json')
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).branch).toBe('sync/collision-2')
  })

  it('stores state in the linked worktree Git directory', () => {
    upstreamCommit()
    const linked = join(scratch, 'linked')
    git(work, 'worktree', 'add', '-b', 'scratch', linked, 'origin/main')
    const result = cli(linked, 'start', '--branch', 'sync/linked', '--json')
    expect(result.code, result.stderr).toBe(0)
    expect(readState(linked).status).toBe('merged')
    expect(() => readState(work)).toThrow()
    expect(git(work, 'branch', '--show-current')).toBe('main')
  })

  it('refuses to create main even when that local branch does not exist', () => {
    upstreamCommit()
    git(work, 'switch', '-c', 'scratch')
    git(work, 'branch', '-D', 'main')
    const before = git(work, 'rev-parse', 'HEAD')
    const result = cli(work, 'start', '--branch', 'main', '--json')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('other than main')
    expect(git(work, 'rev-parse', 'HEAD')).toBe(before)
    expect(git(work, 'branch', '--show-current')).toBe('scratch')
  })

  it('uses default upstream settings when no registry exists', () => {
    git(work, 'rm', 'config/fork/fork-features.json')
    git(work, 'commit', '-qm', 'chore: remove registry')
    git(work, 'push', 'origin', 'main')
    upstreamCommit()
    git(work, 'remote', 'add', 'upstream', upstream)
    git(work, 'fetch', 'upstream')
    const result = cli(work, 'start', '--no-fetch', '--json')
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).upstreamRef).toBe('upstream/main')
  })

  it('saves an error state and reports fetch errors without switching branches', () => {
    git(work, 'remote', 'set-url', 'origin', join(scratch, 'missing.git'))
    const result = cli(work, 'start', '--json')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('missing.git')
    expect(readState(work)).toMatchObject({ status: 'error', branch: null })
    expect(git(work, 'branch', '--show-current')).toBe('main')
  })

  it('reports git stderr with exit 1 when a merge fails without conflicts', () => {
    upstreamCommit()
    git(work, 'config', 'merge.verifySignatures', 'true')
    const before = git(work, 'rev-parse', 'main')
    const result = cli(work, 'start', '--branch', 'sync/unsigned', '--json')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('does not have a GPG signature')
    expect(readState(work)).toMatchObject({
      status: 'error',
      branch: 'sync/unsigned',
      conflicts: []
    })
    expect(git(work, 'rev-parse', 'main')).toBe(before)
  })

  it('reads a custom upstream remote and branch from the registry', () => {
    git(source, 'switch', '-c', 'release')
    commit(source, 'release.txt', 'release\n', 'feat: release')
    git(source, 'push', 'origin', 'release')
    commit(
      work,
      'config/fork/fork-features.json',
      JSON.stringify({
        upstream: { remote: 'vendor', url: upstream, branch: 'release' },
        features: []
      }),
      'chore: configure upstream'
    )
    git(work, 'push', 'origin', 'main')
    const result = cli(work, 'start', '--branch', 'sync/custom', '--json')
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'merged',
      upstreamRef: 'vendor/release',
      behind: 1,
      forkAhead: 1
    })
    expect(git(work, 'log', '-1', '--format=%s')).toContain('stablyai/orca release')
  })
})

describe('summary and PR body', () => {
  it('reports upstream subjects, areas and changes in fork-owned files', async () => {
    commit(work, 'docs/fork.md', 'fork only\n', 'feat: fork only')
    git(work, 'push', 'origin', 'main')
    upstreamCommit('src/main/fork/value.txt', 'new value\n', 'feat: first upstream')
    upstreamCommit('docs/last.md', 'last\n', 'fix: last upstream')
    expect(cli(work, 'start').code).toBe(0)
    const summary = await syncSummary(work, {
      resolveOwners: (files) =>
        new Map(
          files.map((file) => [
            file,
            file.startsWith('src/') ? ['feature-b', 'feature-a'] : ['docs-feature']
          ])
        )
    })
    expect(summary).toMatchObject({
      count: 2,
      firstSubject: 'feat: first upstream',
      lastSubject: 'fix: last upstream'
    })
    expect(summary.featuresAffected).toEqual([
      { id: 'docs-feature', files: ['docs/last.md'] },
      { id: 'feature-a', files: ['src/main/fork/value.txt'] },
      { id: 'feature-b', files: ['src/main/fork/value.txt'] }
    ])
    expect(summary.topAreas).toContainEqual({ area: 'docs/fork.md', count: 1 })
    expect(summary.topAreas).toContainEqual({ area: 'src/main/fork', count: 1 })
    const result = cli(work, 'summary', '--json')
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ count: 2, featuresAffected: [] })
  })

  it('sorts areas by file count, uses three segments under src and limits to ten', () => {
    const areas = topAreas([
      'src/main/fork/a.ts',
      'src/main/fork/b.ts',
      'docs/topic/a.md',
      'docs/topic/b.md',
      ...Array.from({ length: 12 }, (_, index) => `other/area-${index}/file`)
    ])
    expect(areas).toHaveLength(10)
    expect(areas.slice(0, 2)).toEqual([
      { area: 'docs/topic', count: 2 },
      { area: 'src/main/fork', count: 2 }
    ])
  })

  it('renders template headings, failures first, conflicts, resolutions and affected features', async () => {
    upstreamCommit()
    expect(cli(work, 'start').code).toBe(0)
    const summary = await syncSummary(work)
    const state = { ...readState(work), conflicts: [{ file: 'fork.txt', owners: ['feature-a'] }] }
    summary.featuresAffected = [{ id: 'feature-a', files: ['fork.txt'] }]
    const gate = {
      results: [
        { kind: 'command', name: 'lint', status: 'passed', durationMs: 10, exitCode: 0 },
        {
          kind: 'test',
          name: 'broken | test',
          status: 'failed',
          durationMs: 20,
          exitCode: 1,
          reason: 'test failed'
        },
        { kind: 'test', name: 'manual', status: 'skipped', durationMs: 0, exitCode: null }
      ]
    }
    const body = renderPrBody(state, summary, gate, { resolutions: 'Kept the fork behavior.' })
    for (const heading of ['ELI5', 'What Changed', 'Why', 'Visual Proof', 'Testing', 'Notes']) {
      expect(body).toContain(`## ${heading}\n`)
    }
    expect(body).toContain(`${state.baseSha}..${state.upstreamSha}`)
    expect(body).toContain('(1 commits)')
    expect(body).toContain('docs/upstream.md')
    expect(body).toContain('fork.txt (owners: feature-a)')
    expect(body).toContain('feature-a: fork.txt')
    expect(body).toContain('Kept the fork behavior.')
    expect(body).toContain('No app proof attached')
    expect(body).toContain('merge commit, not squash')
    expect(body.indexOf('| test | broken \\| test | failed | 20 ms |')).toBeLessThan(
      body.indexOf('| command | lint | passed | 10 ms |')
    )
    expect(body).toContain('exit 1 — test failed')
    const linked = renderPrBody(state, summary, gate, { reportUrl: 'https://example.test/report' })
    expect(linked).toContain('[App proof report](https://example.test/report)')
    expect(linked).not.toContain('No app proof attached')
  })

  it('prints and writes PR markdown through the CLI', () => {
    upstreamCommit()
    expect(cli(work, 'start').code).toBe(0)
    const gate = join(scratch, 'gate.json')
    const resolutions = join(scratch, 'resolutions.md')
    writeFileSync(gate, JSON.stringify({ startedAt: '', finishedAt: '', results: [] }))
    writeFileSync(resolutions, 'Resolution details')
    const printed = cli(work, 'pr-body', '--gate', gate, '--resolutions', resolutions)
    expect(printed.code, printed.stderr).toBe(0)
    expect(printed.stdout).toContain('Resolution details')
    expect(printed.stdout).toContain('No app proof attached')
    const output = join(scratch, 'body.md')
    const written = cli(
      work,
      'pr-body',
      '--gate',
      gate,
      '--out',
      output,
      '--report-url',
      'https://example.test/proof'
    )
    expect(written.code, written.stderr).toBe(0)
    expect(written.stdout).toBe('')
    expect(readFileSync(output, 'utf8')).toContain('[App proof report](https://example.test/proof)')
  })
})

describe('publish', () => {
  it('refuses a non-sync branch with exit 4 before pushing', () => {
    const result = cli(work, 'publish', '--title', 'chore: sync', '--body-file', 'body.md')
    expect(result.code).toBe(4)
    expect(result.stderr).toContain('Refusing to publish non-sync branch: main')
    const run = vi.fn(() => ({ status: 0, stdout: 'main', stderr: '' }))
    expect(() => publishSync(work, { title: 'title', bodyFile: 'body.md' }, run)).toThrow(
      'non-sync'
    )
    expect(run.mock.calls).toEqual([['git', ['symbolic-ref', '--quiet', '--short', 'HEAD']]])
  })

  it('refuses detached HEAD with exit 4 before pushing', () => {
    git(work, 'switch', '--detach')
    const result = cli(work, 'publish', '--title', 'chore: sync', '--body-file', 'body.md')
    expect(result.code).toBe(4)
    expect(result.stderr).toContain('Refusing to publish detached HEAD')
  })

  it.each([
    'https://github.com/owner/repo.git',
    'https://github.com/owner/repo',
    'git@github.com:owner/repo.git',
    'ssh://git@github.com/owner/repo.git'
  ])('derives owner/repo from %s', (url) => {
    expect(originRepository(url)).toBe('owner/repo')
  })

  it('rejects non-GitHub providers explicitly', () => {
    expect(() => originRepository('git@gitlab.com:owner/repo.git')).toThrow('GitHub origin')
  })

  it.each([true, false])(
    'publishes only the sync branch and handles existing PR = %s',
    (exists) => {
      const run = vi.fn((program, args) => {
        let stdout = ''
        if (args[0] === 'symbolic-ref') {
          stdout = 'sync/test'
        }
        if (args[0] === 'remote') {
          stdout = 'git@github.com:owner/repo.git'
        }
        if (program === 'gh' && args[1] === 'view') {
          return exists
            ? { status: 0, stdout: '{"url":"https://github.com/owner/repo/pull/1"}', stderr: '' }
            : { status: 1, stdout: '', stderr: 'no pull requests found for branch "sync/test"' }
        }
        if (program === 'gh' && args[1] === 'create') {
          stdout = 'https://github.com/owner/repo/pull/1'
        }
        return { status: 0, stdout, stderr: '' }
      })
      expect(
        publishSync(work, { title: 'chore: sync', bodyFile: 'body.md', draft: true }, run)
      ).toBe('https://github.com/owner/repo/pull/1')
      expect(run.mock.calls[2]).toEqual(['git', ['push', '-u', 'origin', 'sync/test']])
      expect(run.mock.calls[3]).toEqual([
        'gh',
        ['pr', 'view', 'sync/test', '--repo', 'owner/repo', '--json', 'url']
      ])
      expect(run.mock.calls[4]).toEqual([
        'gh',
        exists
          ? ['pr', 'edit', 'sync/test', '--repo', 'owner/repo', '--body-file', 'body.md']
          : [
              'pr',
              'create',
              '--repo',
              'owner/repo',
              '--base',
              'main',
              '--head',
              'sync/test',
              '--title',
              'chore: sync',
              '--body-file',
              'body.md',
              '--draft'
            ]
      ])
    }
  )

  it('does not create a PR after a gh authentication or transport failure', () => {
    const run = vi.fn((program, args) => {
      if (program === 'gh') {
        return { status: 1, stdout: '', stderr: 'authentication failed' }
      }
      return {
        status: 0,
        stdout: args[0] === 'remote' ? 'https://github.com/owner/repo' : 'sync/test',
        stderr: ''
      }
    })
    expect(() => publishSync(work, { title: 'title', bodyFile: 'body.md' }, run)).toThrow(
      'authentication failed'
    )
    expect(run.mock.calls.filter(([program]) => program === 'gh')).toHaveLength(1)
  })
})
