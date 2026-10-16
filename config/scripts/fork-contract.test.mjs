import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcessSync } from '../../src/shared/child-process/run-process'
import {
  classifyChangedFiles,
  forkChangedFiles,
  globToRegExp,
  loadRegistry,
  main,
  ownersForFiles,
  validateRegistry
} from './fork-contract.mjs'

const repoRoot = resolve(import.meta.dirname, '../..')
const script = join(repoRoot, 'config/scripts/fork-contract.mjs')
const registryPath = 'config/fork/fork-features.json'

function feature(overrides = {}) {
  return {
    id: 'sample-feature',
    title: 'Sample feature',
    commits: [],
    paths: ['src/code.ts'],
    unit: ['src/code.test.ts'],
    unitSupport: [],
    mobile: [],
    e2e: [],
    checks: [],
    appProof: { surface: 'none', steps: 'Tooling only.' },
    ...overrides
  }
}

function registry(features = [feature()]) {
  return {
    schemaVersion: 1,
    upstream: { remote: 'upstream', url: 'https://github.com/stablyai/orca.git', branch: 'main' },
    exempt: ['**/*.md', 'docs/**'],
    features
  }
}

let scratch
function write(file, text = '') {
  const absolute = join(scratch, file)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, text)
}
function git(...args) {
  const result = runProcessSync({
    program: 'git',
    args,
    cwd: scratch,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_CONFIG_NOSYSTEM: '1'
    }
  })
  expect(result.code, result.stderr).toBe(0)
  return result.stdout.trim()
}
function cli(...args) {
  return runProcessSync({
    program: process.execPath,
    args: [script, ...args],
    cwd: scratch,
    env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' }
  })
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'orca-fork-contract-'))
  write('src/code.ts')
  write('src/code.test.ts')
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(scratch, { recursive: true, force: true })
})

describe('globToRegExp', () => {
  it.each([
    ['**/*.md', 'README.md', true],
    ['**/*.md', 'nested\nfolder/readme.md', true],
    ['docs/**', 'docs/multiline\nname.ts', true],
    ['**/*.md', 'docs/deep/readme.md', true],
    ['**/*.md', 'README.mdx', false],
    ['docs/**', 'docs/a/b', true],
    ['src/**/x?.ts', 'src/x1.ts', true],
    ['src/**/x?.ts', 'src/a/b/x2.ts', true],
    ['src/**/x?.ts', 'src/xx1.ts', false],
    ['a/*/c', 'a/b/c', true],
    ['a/*/c', 'a/b/d/c', false],
    ['a?b', 'a/b', false],
    ['a?b', 'axb', true],
    ['a.ts', 'xa.ts', false],
    ['a.ts', 'aXts', false],
    ['a.ts', 'a.tsx', false],
    ['a+[b](c){d}^$|.ts', 'a+[b](c){d}^$|.ts', true],
    ['a\\b.ts', 'a\\b.ts', true],
    ['**', 'a/b/c', true],
    ['*', 'a/b', false]
  ])('%s matching %s = %s', (pattern, file, expected) => {
    expect(globToRegExp(pattern).test(file)).toBe(expected)
  })
})

describe('registry validation', () => {
  const validate = (value, extra = {}) => validateRegistry(value, { root: scratch, ...extra })

  it('loads the registry and accepts a valid fixture', () => {
    write(registryPath, JSON.stringify(registry()))
    expect(loadRegistry(scratch)).toEqual(registry())
    expect(validate(loadRegistry(scratch))).toEqual([])
  })
  it('rejects malformed JSON when loading', () => {
    write(registryPath, '{')
    expect(() => loadRegistry(scratch)).toThrow()
  })
  it.each([
    ['schemaVersion', 2, 'schemaVersion'],
    ['upstream', {}, 'upstream'],
    ['exempt', [7], 'exempt'],
    ['features', null, 'features']
  ])('rejects invalid registry %s', (key, value, message) => {
    expect(validate({ ...registry(), [key]: value }).join('\n')).toContain(message)
  })
  it.each([null, [], 'registry'])('rejects non-object registry %s', (value) => {
    expect(validate(value)).toEqual(['Registry must be an object'])
  })
  it('rejects non-object features', () => {
    expect(validate(registry([null])).join()).toContain('Feature must be an object')
  })
  it.each([
    ['id', '', 'kebab-case'],
    ['id', 'CamelCase', 'kebab-case'],
    ['id', 'bad--id', 'kebab-case'],
    ['title', ' ', 'title'],
    ['paths', [], 'paths'],
    ['paths', [1], 'paths'],
    ['paths', 'src/**', 'paths'],
    ['paths', ['missing/**'], 'stale pattern'],
    ['unit', ['src/code.ts'], 'invalid unit'],
    ['unit', ['missing.test.ts'], 'missing unit'],
    ['unit', [null], 'unit must be'],
    ['unitSupport', null, 'unitSupport must be'],
    ['unitSupport', [{}], 'file and runner'],
    ['mobile', ['src/code.test.ts'], 'invalid mobile'],
    ['mobile', ['mobile/code.test.mjs'], 'invalid mobile'],
    ['mobile', ['mobile/missing.test.ts'], 'missing mobile'],
    ['mobile', {}, 'mobile must be'],
    ['e2e', ['tests/e2e/code.test.ts'], 'invalid e2e'],
    ['e2e', ['other/code.spec.ts'], 'invalid e2e'],
    ['e2e', ['tests/e2e/missing.spec.ts'], 'missing e2e'],
    ['e2e', null, 'e2e must be'],
    ['checks', null, 'checks must be'],
    ['checks', [{ cmd: ['node'] }], 'name and non-empty string argv'],
    ['checks', [{ name: 'check', cmd: [] }], 'name and non-empty string argv'],
    ['checks', [{ name: 'check', cmd: [''] }], 'name and non-empty string argv'],
    ['checks', [{ name: 'check', cmd: ['node', 3] }], 'name and non-empty string argv'],
    ['checks', [{ name: 'check', cmd: ['node'], requires: 'desktop' }], 'requires'],
    ['appProof', { surface: 'web' }, 'appProof.surface'],
    ['appProof', null, 'appProof.surface']
  ])('rejects invalid feature %s: %j', (key, value, message) => {
    const errors = validate(registry([feature({ [key]: value })]))
    expect(
      errors.some((error) => error.includes(message)),
      errors.join('\n')
    ).toBe(true)
  })
  it('rejects duplicate ids', () => {
    expect(validate(registry([feature(), feature()])).join()).toContain('duplicate id')
  })
  it('requires tests or checks', () => {
    expect(validate(registry([feature({ unit: [] })])).join()).toContain(
      'at least one test or check'
    )
  })
  it.each(['unit', 'unitSupport', 'mobile', 'e2e', 'checks'])(
    'accepts %s as the sole test kind',
    (kind) => {
      write('src/fragments/a.spec.ts')
      write('src/runner.test.ts', "import './fragments/a.spec'")
      write('mobile/a.test.tsx')
      write('tests/e2e/nested/a.spec.ts')
      const entries = {
        unit: ['src/code.test.ts'],
        unitSupport: [{ file: 'src/fragments/a.spec.ts', runner: 'src/runner.test.ts' }],
        mobile: ['mobile/a.test.tsx'],
        e2e: ['tests/e2e/nested/a.spec.ts'],
        checks: [{ name: 'check', cmd: ['node', '--version'] }]
      }
      expect(validate(registry([feature({ unit: [], [kind]: entries[kind] })]))).toEqual([])
    }
  )
  it.each(['ts', 'tsx', 'mts', 'mjs'])('accepts .test.%s unit files', (extension) => {
    const file = `src/a.test.${extension}`
    write(file)
    expect(validate(registry([feature({ unit: [file] })]))).toEqual([])
  })
  it.each(['desktop', 'mobile', 'both', 'none'])('accepts appProof surface %s', (surface) => {
    expect(validate(registry([feature({ appProof: { surface } })]))).toEqual([])
  })
  it('accepts deleted patterns from fork changes but rejects stale existing candidates', () => {
    const value = registry([feature({ paths: ['deleted/**'] })])
    expect(validate(value, { forkChangedFiles: ['deleted/code.ts'] })).toEqual([])
    expect(validate(value).join()).toContain('stale pattern')
  })
  it('matches zero directory glob depth and untracked files', () => {
    expect(validate(registry([feature({ paths: ['src/**/code.ts'] })]))).toEqual([])
  })
  it('uses repoFiles as the candidate universe without walking the filesystem', () => {
    const walk = vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('must not walk')
    })
    const value = registry([feature({ paths: ['src/**/*.ts'] })])
    expect(validate(value, { repoFiles: ['src/code.ts'] })).toEqual([])
    expect(validate(value, { repoFiles: [] }).join()).toContain('stale pattern')
    expect(validate(value, { repoFiles: ['src/missing.ts'] }).join()).toContain('stale pattern')
    expect(validate(value, { repoFiles: [], forkChangedFiles: ['src/deleted.ts'] })).toEqual([])
    expect(walk).not.toHaveBeenCalled()
  })
  it.each([
    ['missing.spec.ts', 'src/code.test.ts', 'missing support file'],
    ['src/code.ts', 'missing.test.ts', 'missing support runner'],
    ['src/code.ts', 'src/code.ts', 'invalid unitSupport runner'],
    ['src/code.ts', 'src/code.test.ts', 'fragment never runs']
  ])('rejects broken support registration %s → %s', (file, runner, message) => {
    expect(validate(registry([feature({ unitSupport: [{ file, runner }] })])).join()).toContain(
      message
    )
  })
  it('uses injected exists and readFile and reports read failures', () => {
    const value = registry([
      feature({ unitSupport: [{ file: 'src/part.ts', runner: 'src/code.test.ts' }] })
    ])
    expect(validate(value, { exists: () => true, readFile: () => "import './part'" })).toEqual([])
    expect(
      validate(value, {
        exists: () => true,
        readFile: () => {
          throw new Error('denied')
        }
      }).join()
    ).toContain('cannot read support runner')
  })
})

describe('classification and owners', () => {
  const value = registry([
    feature({
      paths: ['src/code.ts', 'overlap/**', 'docs/**', 'owned-test/**'],
      unitSupport: [{ file: 'fragments/a.spec.ts', runner: 'src/runner.test.ts' }],
      mobile: ['mobile/a.test.ts'],
      e2e: ['tests/e2e/a.spec.ts']
    }),
    feature({ id: 'second', paths: ['overlap/**'] })
  ])
  it('classifies every category with deletion, exemption and listed-test precedence', () => {
    const files = [
      'gone.ts',
      'README.md',
      'docs/readme.spec.ts',
      'src/code.test.ts',
      'fragments/a.spec.ts',
      'src/runner.test.ts',
      'mobile/a.test.ts',
      'tests/e2e/a.spec.ts',
      'src/code.ts',
      'overlap/a.ts',
      'owned-test/a.test.ts',
      'unowned.ts',
      'extra.test.ts',
      'extra.spec.mjs',
      'tests/fixture.json',
      'src/code.ts'
    ]
    expect(classifyChangedFiles(value, files, { exists: (file) => file !== 'gone.ts' })).toEqual({
      owned: {
        'src/code.ts': ['sample-feature'],
        'overlap/a.ts': ['sample-feature', 'second'],
        'owned-test/a.test.ts': ['sample-feature']
      },
      exempt: ['README.md', 'docs/readme.spec.ts'],
      tests: [
        'src/code.test.ts',
        'fragments/a.spec.ts',
        'src/runner.test.ts',
        'mobile/a.test.ts',
        'tests/e2e/a.spec.ts'
      ],
      deleted: ['gone.ts'],
      unregistered: ['unowned.ts'],
      unlistedTests: ['extra.test.ts', 'extra.spec.mjs', 'tests/fixture.json']
    })
  })
  it('returns owners for paths, each test list, support runners and unknown files', () => {
    const files = [
      'overlap/a.ts',
      'src/code.test.ts',
      'fragments/a.spec.ts',
      'src/runner.test.ts',
      'mobile/a.test.ts',
      'tests/e2e/a.spec.ts',
      'unknown.ts'
    ]
    expect(ownersForFiles(value, files)).toEqual(
      new Map(
        files.map((file) => [
          file,
          file === 'unknown.ts'
            ? []
            : file === 'overlap/a.ts'
              ? ['sample-feature', 'second']
              : file === 'src/code.test.ts'
                ? ['sample-feature', 'second']
                : ['sample-feature']
        ])
      )
    )
  })
  it('handles file names matching Object prototype properties', () => {
    const result = classifyChangedFiles(registry([feature({ paths: ['*'] })]), ['__proto__'], {
      exists: () => true
    })
    expect(Object.keys(result.owned)).toEqual(['__proto__'])
    expect(result.owned.__proto__).toEqual(['sample-feature'])
  })
})

function runnableRegistry() {
  return registry([
    feature({
      unitSupport: [{ file: 'src/part.spec.ts', runner: 'src/runner.test.ts' }],
      mobile: ['mobile/a.test.tsx'],
      e2e: ['tests/e2e/a.spec.ts'],
      checks: [
        { name: 'plain', cmd: ['node', 'a.mjs'] },
        { name: 'tagged', cmd: ['node', 'b.mjs'], requires: ['network', 'device'] }
      ]
    }),
    feature({
      id: 'second',
      unit: ['src/code.test.ts', 'src/runner.test.ts'],
      mobile: ['mobile/a.test.tsx'],
      e2e: ['tests/e2e/a.spec.ts']
    })
  ])
}
describe('CLI and git integration', () => {
  function initialize() {
    git('init', '--quiet')
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'upstream')
    git('branch', 'upstream/main')
    write(
      registryPath,
      JSON.stringify(registry([feature({ paths: ['src/code.ts', 'config/fork/**'] })]))
    )
  }
  it('fails on an unregistered fork file then passes after registration', () => {
    initialize()
    write('fork.txt', 'fork commit')
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fork')
    const failed = cli('check')
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain('Unregistered file: fork.txt')
    expect(failed.stderr).toContain('register it under a feature')
    const value = loadRegistry(scratch)
    value.features[0].paths.push('fork.txt')
    write(registryPath, JSON.stringify(value))
    const passed = cli('check', '--json')
    expect(passed.code, passed.stderr).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      errors: [],
      classification: { owned: { 'fork.txt': ['sample-feature'] } }
    })
  })
  it('includes staged, unstaged, untracked and deleted files with spaces and newlines', () => {
    initialize()
    write('src/code.ts', 'modified')
    write('staged.txt')
    git('add', 'staged.txt')
    write('untracked space\nline.txt')
    rmSync(join(scratch, 'src/code.test.ts'))
    expect(forkChangedFiles(scratch)).toEqual(
      [
        registryPath,
        'src/code.test.ts',
        'src/code.ts',
        'staged.txt',
        'untracked space\nline.txt'
      ].sort()
    )
    expect(forkChangedFiles(scratch, 'HEAD')).toEqual(forkChangedFiles(scratch))
  })
  it('uses merge-base instead of reporting upstream-only changes', () => {
    initialize()
    git('checkout', '--quiet', 'upstream/main')
    write('upstream-only.txt')
    git('add', 'upstream-only.txt')
    git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'upstream advances')
    git('checkout', '--quiet', '-')
    expect(forkChangedFiles(scratch)).not.toContain('upstream-only.txt')
  })
  it('gives a fetch hint when upstream is missing and permits explicit base', () => {
    initialize()
    git('branch', '-D', 'upstream/main')
    const result = cli('check')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'git remote add upstream https://github.com/stablyai/orca.git && git fetch upstream main --no-tags'
    )
    expect(cli('check', '--base', 'HEAD').code).toBe(0)
    expect(cli('check', '--base', 'not-a-ref').code).toBe(1)
  })
  it('reports unlisted tests and stale patterns together with file coverage', () => {
    initialize()
    const value = loadRegistry(scratch)
    value.features[0].paths.push('stale/**')
    write(registryPath, JSON.stringify(value))
    write('extra.test.ts')
    const result = cli('check', '--json')
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout).errors.join()).toContain('stale pattern')
    expect(JSON.parse(result.stdout).errors.join()).toContain('Unlisted test: extra.test.ts')
  })
  it('checks tracked and untracked candidates while excluding ignored build output', () => {
    initialize()
    write('.gitignore', 'out/\n')
    write('out/generated.ts')
    write('src/untracked space\nline.ts')
    const value = loadRegistry(scratch)
    value.features[0].paths.push('.gitignore', 'src/untracked*', 'out/**')
    write(registryPath, JSON.stringify(value))
    const failed = cli('check', '--json')
    expect(failed.code).toBe(1)
    const report = JSON.parse(failed.stdout)
    expect(report.errors).toEqual(['sample-feature: stale pattern: out/**'])
    expect(report.files).not.toContain('out/generated.ts')
    value.features[0].paths.pop()
    write(registryPath, JSON.stringify(value))
    const passed = cli('check', '--json')
    expect(passed.code, passed.stderr).toBe(0)
  })
  it('returns validation errors as JSON even when upstream configuration is invalid', () => {
    initialize()
    const value = loadRegistry(scratch)
    value.upstream = {}
    write(registryPath, JSON.stringify(value))
    const result = cli('check', '--json')
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout).errors.join()).toContain(
      'upstream must have remote, url and branch'
    )
  })
  it('prints owners and feature test lists', () => {
    initialize()
    expect(JSON.parse(cli('owners', 'src/code.ts', 'unknown', '--json').stdout)).toEqual({
      'src/code.ts': ['sample-feature'],
      unknown: []
    })
    expect(cli('owners', 'src/code.test.ts').stdout).toContain('sample-feature')
    expect(JSON.parse(cli('list', '--json').stdout)).toEqual(loadRegistry(scratch).features)
    expect(cli('list').stdout).toContain('src/code.test.ts')
  })
  it('runs nothing on dry-run and applies all run options', () => {
    write(registryPath, JSON.stringify(runnableRegistry()))
    const result = cli(
      'run',
      '--kinds',
      'e2e,checks',
      '--features',
      'sample-feature',
      '--with',
      'network,device',
      '--json-out',
      'must-not-exist.json',
      '--dry-run'
    )
    expect(result.code, result.stderr).toBe(0)
    const steps = JSON.parse(result.stdout)
    expect(steps.map(({ kind }) => kind)).toEqual(['checks', 'checks', 'e2e', 'e2e', 'e2e', 'e2e'])
    expect(steps[1].status).toBeUndefined()
    expect(existsSync(join(scratch, 'must-not-exist.json'))).toBe(false)
  })
  it('dry-runs the exact seed registry with default kinds', () => {
    write(registryPath, readFileSync(join(repoRoot, registryPath), 'utf8'))
    const result = cli('run', '--dry-run')
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)[1].args).toContain('config/scripts/fork-contract.test.mjs')
  })
  it.each([
    [],
    ['bad'],
    ['run', '--kinds'],
    ['run', '--kinds', 'typo', '--dry-run'],
    ['run', '--features', 'unknown', '--dry-run'],
    ['check', '--unknown'],
    ['list', 'extra']
  ])('rejects invalid arguments %j', (args) => {
    write(registryPath, JSON.stringify(registry()))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(main(args, scratch)).toBe(1)
    expect(error).toHaveBeenCalled()
  })
})
