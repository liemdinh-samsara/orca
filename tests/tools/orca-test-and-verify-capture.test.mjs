import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect } from 'vitest'
import {
  cleanupScratch,
  copyScriptsIntoRepo,
  passed,
  run,
  sandbox,
  stubExecutable,
  stubNode,
  unix
} from './orca-skill-script-sandbox.mjs'

afterEach(cleanupScratch)

const proofSpec = 'tests/e2e/zz-proof-pane.spec.ts'
const failureEnv = {
  'build failure': { FAIL_BUILD: '1' },
  'test failure': { FAIL_TEST: '1' },
  'runtime failure': { FAIL_RUNTIME: '1' }
}

// Why: the build stub snapshots the working tree to prove what the BEFORE build could see.
const buildStub = `echo "npx $* expose=$(printenv VITE_EXPOSE_STORE || echo unset)" >> "$CALLS"
{ cat tracked.txt staged.txt .claude/settings.json
  cat untracked.txt 2>/dev/null || echo no-untracked
  cat ${proofSpec} .claude/keep.txt test-results/keep.txt
  git stash list --format=%s; } > "$OBSERVATION"
echo stub-build
exit "$FAIL_BUILD"`

const pnpmStub = `echo "pnpm $*" >> "$CALLS"
if [ "$1" = run ]; then exit "$FAIL_RUNTIME"; fi
echo "proof=$PROOF_DIR label=$PROOF_LABEL background=$ORCA_BACKGROUND_LAUNCH skip=$SKIP_BUILD" >> "$CALLS"
printf png > "$PROOF_DIR/$PROOF_LABEL-pane.png"
printf '{}' > "$PROOF_DIR/$PROOF_LABEL-state.json"
echo '1 passed (stub)'
exit "$FAIL_TEST"`

async function captureSandbox({ edited = true } = {}) {
  const box = sandbox({ FAIL_BUILD: '0', FAIL_TEST: '0', FAIL_RUNTIME: '0' })
  const { repo, copiedScripts, git } = copyScriptsIntoRepo(box)
  for (const dir of ['tests/e2e', 'test-results']) {
    mkdirSync(join(repo, dir), { recursive: true })
  }
  const write = (path, text) => writeFileSync(join(repo, path), text)
  write('tracked.txt', 'baseline\n')
  write('staged.txt', 'staged baseline\n')
  write('.claude/settings.json', 'claude baseline\n')
  write('tests/e2e/tracked.spec.ts', 'tracked spec\n')
  await git(['init'])
  await git(['add', '-f', '.'])
  await git(['commit', '-m', 'baseline', '--no-verify'])
  if (edited) {
    write('tracked.txt', 'modified\n')
    write('staged.txt', 'staged edit\n')
    await git(['add', 'staged.txt'])
    write('untracked.txt', 'untracked\n')
    write('.claude/settings.json', 'claude edit\n')
  }
  write(proofSpec, 'proof spec\n')
  write('.claude/keep.txt', 'claude state\n')
  write('test-results/keep.txt', 'test state\n')
  stubNode(box.bin)
  stubExecutable(box.bin, 'npx', buildStub)
  stubExecutable(box.bin, 'pnpm', pnpmStub)
  const observation = join(box.dir, 'build-state')
  return {
    ...box,
    env: { ...box.env, OBSERVATION: observation },
    repo,
    git,
    observation,
    out: join(box.dir, 'proof output'),
    branch: await git(['branch', '--show-current']),
    script: join(copiedScripts, 'capture-before-after.sh')
  }
}

function capture(fixture, args, extraEnv = {}) {
  return run('bash', [fixture.script, ...args], {
    cwd: fixture.repo,
    env: { ...fixture.env, ...extraEnv }
  })
}

function readText(fixture, path) {
  return readFileSync(join(fixture.repo, path), 'utf8')
}

function recordedCalls(fixture) {
  return existsSync(fixture.calls) ? readFileSync(fixture.calls, 'utf8') : ''
}

const baselineTree = 'baseline\nstaged baseline\nclaude edit\nno-untracked\n'
const keptTree = 'proof spec\nclaude state\ntest state\n'

describe('capture-before-after.sh argument checks', () => {
  const missingArgument = [
    [[], 'before|after'],
    [['before'], 'path to tests/e2e/zz-proof-*.spec.ts'],
    [['before', proofSpec], 'output directory']
  ]
  for (const [args, message] of missingArgument) {
    unix(`requires phase, spec and output directory: missing "${message}"`, async () => {
      const f = await captureSandbox()
      const result = await capture(f, args)
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain(message)
      expect(recordedCalls(f)).toBe('')
    })
  }

  unix('rejects an unknown phase without building or stashing', async () => {
    const f = await captureSandbox()
    const result = await capture(f, ['during', proofSpec, f.out])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('phase must be before or after')
    expect(recordedCalls(f)).toBe('')
    expect(await f.git(['stash', 'list'])).toBe('')
    expect(readText(f, 'tracked.txt')).toBe('modified\n')
  })

  for (const phase of ['before', 'after']) {
    unix(`rejects a tracked spec in ${phase} and leaves the working tree alone`, async () => {
      const f = await captureSandbox()
      const result = await capture(f, [phase, 'tests/e2e/tracked.spec.ts', f.out])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('is tracked; keep it untracked')
      expect(recordedCalls(f)).toBe('')
      expect(await f.git(['stash', 'list'])).toBe('')
      expect(readText(f, 'tracked.txt')).toBe('modified\n')
    })
  }
})

describe('capture-before-after.sh BEFORE phase', () => {
  for (const scenario of ['success', ...Object.keys(failureEnv)]) {
    unix(`hides edits from the build and restores them after ${scenario}`, async () => {
      const f = await captureSandbox()
      const result = await capture(f, ['before', proofSpec, f.out], failureEnv[scenario])
      expect(result.code, result.stderr).toBe(scenario === 'success' ? 0 : 1)
      expect(result.stdout).toContain('[proof] stashed 3 changed path(s) for the BEFORE build')
      expect(result.stdout).toContain('[proof] restored working-tree changes')
      expect(await f.git(['stash', 'list'])).toBe('')
      expect(readText(f, 'tracked.txt')).toBe('modified\n')
      expect(readText(f, 'staged.txt')).toBe('staged edit\n')
      expect(readText(f, 'untracked.txt')).toBe('untracked\n')
      expect(readText(f, '.claude/settings.json')).toBe('claude edit\n')
      expect(readText(f, proofSpec)).toBe('proof spec\n')
      expect(readText(f, '.claude/keep.txt')).toBe('claude state\n')
      expect(readText(f, 'test-results/keep.txt')).toBe('test state\n')
      if (scenario !== 'runtime failure') {
        const stash = `On ${f.branch}: orca-proof-before\n`
        expect(readFileSync(f.observation, 'utf8')).toBe(baselineTree + keptTree + stash)
      }
    })
  }

  unix('builds in e2e mode, runs the spec headless and writes the proof files', async () => {
    const f = await captureSandbox()
    const result = await capture(f, ['before', proofSpec, f.out])
    passed(result)
    const playwright = `pnpm exec playwright test ${proofSpec} --config tests/playwright.config.ts --project electron-headless`
    expect(recordedCalls(f)).toBe(
      [
        'pnpm run --silent ensure:electron-runtime',
        'npx electron-vite build --mode e2e expose=true',
        playwright,
        `proof=${f.out} label=before background=1 skip=1`,
        ''
      ].join('\n')
    )
    expect(readFileSync(join(f.out, 'before-build.log'), 'utf8')).toContain('stub-build')
    expect(readFileSync(join(f.out, 'before-playwright.log'), 'utf8')).toContain('1 passed')
    expect(result.stdout).toContain('1 passed (stub)')
    expect(result.stdout).toContain('before-pane.png\nbefore-state.json')
  })

  unix('stashes nothing and still builds when only the proof spec is untracked', async () => {
    const f = await captureSandbox({ edited: false })
    const result = await capture(f, ['before', proofSpec, f.out])
    passed(result)
    expect(result.stdout).not.toContain('stashed')
    expect(result.stdout).not.toContain('restored')
    expect(await f.git(['stash', 'list'])).toBe('')
    const tree = 'baseline\nstaged baseline\nclaude baseline\nno-untracked\n'
    expect(readFileSync(f.observation, 'utf8')).toBe(tree + keptTree)
  })
})

describe('capture-before-after.sh AFTER phase', () => {
  unix('builds the current edits without creating a stash', async () => {
    const f = await captureSandbox()
    const result = await capture(f, ['after', join(f.repo, proofSpec), f.out])
    passed(result)
    const tree = 'modified\nstaged edit\nclaude edit\nuntracked\n'
    expect(readFileSync(f.observation, 'utf8')).toBe(tree + keptTree)
    expect(await f.git(['stash', 'list'])).toBe('')
    expect(result.stdout).not.toContain('stashed')
    expect(recordedCalls(f)).toContain(`proof=${f.out} label=after background=1 skip=1`)
    for (const name of ['after-build.log', 'after-pane.png', 'after-state.json']) {
      expect(existsSync(join(f.out, name)), name).toBe(true)
    }
  })

  unix('exits with the spec status and leaves the working tree untouched', async () => {
    const f = await captureSandbox()
    const result = await capture(f, ['after', proofSpec, f.out], { FAIL_TEST: '1' })
    expect(result.code).toBe(1)
    expect(await f.git(['stash', 'list'])).toBe('')
    expect(readText(f, 'untracked.txt')).toBe('untracked\n')
  })
})
