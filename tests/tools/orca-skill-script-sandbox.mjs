import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, it } from 'vitest'
import { runProcess } from '@orca/process-host'

export const root = realpathSync(join(import.meta.dirname, '../..'))
export const skill = join(root, '.claude/skills/orca-test-and-verify')
export const scripts = join(skill, 'scripts')
export const unix = it.skipIf(process.platform === 'win32')
export const mac = it.skipIf(process.platform !== 'darwin')
export const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const temporary = []

export function scratch() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orca-skill-test-')))
  temporary.push(dir)
  return dir
}

export function cleanupScratch() {
  for (const dir of temporary.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function stubExecutable(dir, name, body) {
  writeFileSync(join(dir, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 })
}

// Why: env.sh asks `node -p` for the major version, so a stub only has to answer that.
export function stubNode(dir, major = '24') {
  stubExecutable(dir, 'node', `if [ "$1" = -p ]; then echo ${major}; else echo v${major}.0.0; fi`)
}

export function run(program, args, options = {}) {
  return runProcess({ program, args, timeoutMs: 20_000, ...options })
}

export function passed(result) {
  expect(result.code, result.stderr + result.stdout).toBe(0)
  expect(result.timedOut).toBe(false)
}

// Why: the scripts must set the hidden-launch flag themselves, so an inherited one would mask a regression.
const { ORCA_BACKGROUND_LAUNCH: _hiddenLaunch, ...inheritedEnv } = process.env

// Why: a PATH of only stubs plus system dirs keeps real node, pnpm, codesign and mv out of reach.
export function sandbox(extraEnv = {}) {
  const dir = scratch()
  const bin = join(dir, 'bin')
  const home = join(dir, 'home')
  const tmp = join(dir, 'tmp')
  for (const path of [bin, home, tmp]) {
    mkdirSync(path)
  }
  const calls = join(dir, 'calls')
  const env = {
    ...inheritedEnv,
    HOME: home,
    ZDOTDIR: home,
    TMPDIR: tmp,
    PATH: [bin, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter),
    CALLS: calls,
    GIT_CONFIG_GLOBAL: join(dir, 'no-gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Skill test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Skill test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    ...extraEnv
  }
  return { dir, bin, home, tmp, calls, env }
}

// Why: the scripts derive ORCA_REPO from their own location, so a copy inside a throwaway repo
// keeps every git and build command away from the real checkout.
export function copyScriptsIntoRepo(box) {
  const repo = join(box.dir, 'repo')
  const copiedScripts = join(repo, '.claude/skills/orca-test-and-verify/scripts')
  cpSync(scripts, copiedScripts, { recursive: true })
  const git = async (args) => {
    const result = await run('git', args, { cwd: repo, env: box.env })
    expect(result.code, result.stderr).toBe(0)
    return result.stdout.trim()
  }
  return { repo, copiedScripts, git }
}
