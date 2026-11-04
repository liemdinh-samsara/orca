import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { runProcessSync } from '@orca/process-host'

// Throwaway origin/upstream/work repos shared by the fork-upstream-sync suites (live bindings).
export const script = resolve(import.meta.dirname, 'fork-upstream-sync.mjs')
export let scratch
export let work
export let source
export let origin
export let upstream

export function write(root, file, content) {
  const target = join(root, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

export function git(root, ...args) {
  const result = runProcessSync({ program: 'git', args, cwd: root })
  expect(result.code, result.stderr || result.stdout).toBe(0)
  return result.stdout.trim()
}

export function cli(root, ...args) {
  return runProcessSync({ program: process.execPath, args: [script, ...args], cwd: root })
}

export function commit(root, file, content, subject) {
  write(root, file, content)
  git(root, 'add', '--', file)
  git(root, 'commit', '-qm', subject)
  return git(root, 'rev-parse', 'HEAD')
}

export function upstreamCommit(
  file = 'docs/upstream.md',
  content = 'upstream\n',
  subject = 'feat: upstream'
) {
  const sha = commit(source, file, content, subject)
  git(source, 'push', 'origin', 'main')
  return sha
}

export function registerSyncTestRepos() {
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
}
