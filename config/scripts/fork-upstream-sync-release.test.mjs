import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { runProcessSync } from '@orca/process-host'
import { compareReleaseNames, pickRelease } from './fork-upstream-sync.mjs'
import {
  cli,
  git,
  source,
  upstream,
  upstreamCommit,
  registerSyncTestRepos,
  work,
  write
} from './fork-upstream-sync-test-repos.mjs'

registerSyncTestRepos()

const DAY_MS = 24 * 60 * 60 * 1000

// Upstream cuts each release on a side commit off main, so the tag is not on main.
function upstreamRelease(tag, daysAgo, { fromMain = true } = {}) {
  const env = {
    ...process.env,
    GIT_COMMITTER_DATE: new Date(Date.now() - daysAgo * DAY_MS).toISOString()
  }
  const run = (...args) => {
    const result = runProcessSync({ program: 'git', args, cwd: source, env })
    expect(result.code, result.stderr || result.stdout).toBe(0)
    return result.stdout.trim()
  }
  if (fromMain) {
    run('switch', '-q', '--detach', 'main')
  }
  write(source, 'package.json', `{"version":"${tag.slice(1)}"}\n`)
  run('add', 'package.json')
  run('commit', '-qm', `release: ${tag}`)
  run('tag', '-a', tag, '-m', tag)
  const sha = run('rev-parse', 'HEAD')
  run('push', '-q', 'origin', `refs/tags/${tag}`)
  run('switch', '-q', 'main')
  return sha
}

function trackReleases(extra = {}) {
  write(
    work,
    'config/fork/fork-features.json',
    JSON.stringify({
      upstream: { remote: 'upstream', url: upstream, branch: 'main', track: 'release', ...extra },
      features: []
    })
  )
  git(work, 'commit', '-qam', 'chore: track upstream releases')
  git(work, 'push', '-q', 'origin', 'main')
  return git(work, 'rev-parse', 'HEAD')
}

describe('release selection', () => {
  const pattern = '^v\\d+\\.\\d+\\.\\d+$'
  const now = Date.UTC(2026, 10, 10)
  const tag = (name, daysAgo) => ({ name, date: now - daysAgo * DAY_MS })

  it('picks the newest release that is old enough, ignoring prereleases and other tags', () => {
    const tags = [
      tag('v1.4.9', 20),
      tag('v1.4.10', 8),
      tag('v1.4.11', 2),
      tag('v1.4.12-rc.0', 9),
      tag('mobile-android-v0.0.62', 30)
    ]
    expect(pickRelease(tags, { pattern, minAgeDays: 7, now })?.name).toBe('v1.4.10')
    expect(pickRelease(tags, { pattern, minAgeDays: 0, now })?.name).toBe('v1.4.11')
    expect(pickRelease(tags, { pattern, minAgeDays: 30, now })).toBeNull()
  })

  it('compares release numbers numerically', () => {
    expect(compareReleaseNames('v1.4.10', 'v1.4.9')).toBeGreaterThan(0)
    expect(compareReleaseNames('v2.0.0', 'v1.99.99')).toBeGreaterThan(0)
    expect(compareReleaseNames('v1.4.246', 'v1.4.246')).toBe(0)
  })
})

describe('start with upstream releases', () => {
  it('merges the newest release that is old enough instead of upstream main', () => {
    const baseSha = trackReleases({ minReleaseAgeDays: 7 })
    upstreamCommit('docs/first.md', 'one\n', 'feat: first upstream')
    const releaseSha = upstreamRelease('v1.0.1', 10)
    upstreamCommit('docs/second.md', 'two\n', 'feat: second upstream')
    upstreamRelease('v1.0.2', 1)
    upstreamCommit('docs/tip.md', 'tip\n', 'feat: unreleased')
    const result = cli(work, 'start', '--branch', 'sync/release', '--json')
    expect(result.code, result.stderr).toBe(0)
    const state = JSON.parse(result.stdout)
    expect(state).toMatchObject({
      status: 'merged',
      baseSha,
      upstreamRef: 'v1.0.1',
      upstreamSha: releaseSha,
      behind: 2,
      release: { tag: 'v1.0.1', ageDays: 10, pinned: false, alreadyMerged: false }
    })
    expect(git(work, 'rev-list', '--parents', '-1', 'HEAD').split(' ').slice(1)).toEqual([
      baseSha,
      releaseSha
    ])
    expect(git(work, 'log', '-1', '--format=%s')).toMatch(
      /^chore: sync upstream stablyai\/orca v1\.0\.1 \(2 commits, up to [a-f0-9]+\)$/
    )
    expect(git(work, 'show', 'HEAD:package.json')).toContain('1.0.1')
    expect(() => git(work, 'cat-file', '-e', 'HEAD:docs/tip.md')).toThrow()
  })

  it('merges a pinned release even when it is newer than the age rule allows', () => {
    trackReleases({ minReleaseAgeDays: 7 })
    upstreamRelease('v1.0.1', 10)
    const pinned = upstreamRelease('v1.0.2', 1)
    const result = cli(work, 'start', '--release', 'v1.0.2', '--branch', 'sync/pinned', '--json')
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'merged',
      upstreamSha: pinned,
      release: { tag: 'v1.0.2', pinned: true }
    })
  })

  it('never merges a release older than one the fork already has', () => {
    trackReleases({ minReleaseAgeDays: 7 })
    upstreamRelease('v1.0.1', 10)
    upstreamRelease('v1.0.2', 1)
    git(work, 'fetch', '-q', upstream, 'refs/tags/v1.0.2:refs/tags/v1.0.2')
    git(work, 'merge', '-q', '--no-ff', '--no-edit', 'v1.0.2^{commit}')
    git(work, 'push', '-q', 'origin', 'main')
    const before = git(work, 'for-each-ref', '--format=%(refname)', 'refs/heads/')
    const result = cli(work, 'start', '--json')
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'up-to-date',
      branch: null,
      behind: 0,
      release: { tag: 'v1.0.1', alreadyMerged: true }
    })
    expect(git(work, 'for-each-ref', '--format=%(refname)', 'refs/heads/')).toBe(before)
  })

  it('fails without a branch when no release is old enough or the pin is unknown', () => {
    trackReleases({ minReleaseAgeDays: 7 })
    upstreamRelease('v1.0.1', 1)
    const tooNew = cli(work, 'start', '--json')
    expect(tooNew.code).toBe(1)
    expect(tooNew.stderr).toContain('at least 7 day(s) old')
    const unknown = cli(work, 'start', '--release', 'v9.9.9', '--json')
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toContain('No upstream release tag v9.9.9')
    expect(git(work, 'branch', '--show-current')).toBe('main')
  })

  it('rejects --release when the fork tracks the upstream branch', () => {
    const result = cli(work, 'start', '--release', 'v1.0.1', '--json')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('upstream.track "release"')
  })
})
