import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildRunPlan, executeRunPlan, writeRunReport } from './fork-contract-run.mjs'

let scratch
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'orca-fork-contract-run-'))
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

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
function plan(opts = {}, value = runnableRegistry()) {
  return buildRunPlan(value, {
    root: scratch,
    env: {},
    pnpm: { command: 'node', prefixArgs: ['pnpm.cjs'], shell: false },
    ...opts
  })
}

describe('buildRunPlan', () => {
  it('defaults to unit, mobile and checks, with deduped files and argv arrays', () => {
    const steps = plan()
    expect(steps.map(({ kind }) => kind)).toEqual(['unit', 'unit', 'mobile', 'checks', 'checks'])
    expect(steps[0].args).toEqual(['config/scripts/ensure-native-runtime.mjs', '--runtime=node'])
    expect(steps[1].args).toEqual([
      'pnpm.cjs',
      'exec',
      'vitest',
      'run',
      '--config',
      'config/vitest.config.ts',
      'src/code.test.ts',
      'src/runner.test.ts'
    ])
    expect(steps[1].name).toBe('sample-feature: unit')
    expect(steps[1].dependsOn).toEqual(['prepare node runtime'])
    expect(steps[2].name).toBe('sample-feature: mobile')
    expect(steps[2].cwd).toBe(join(scratch, 'mobile'))
    expect(steps[2].args).toEqual(['pnpm.cjs', 'exec', 'vitest', 'run', 'a.test.tsx'])
    expect(steps[3]).toMatchObject({ command: 'node', args: ['a.mjs'], cwd: scratch })
  })
  it('filters by kind and feature', () => {
    const steps = plan({ kinds: ['unit', 'checks'], features: ['second'] })
    expect(steps.map(({ kind }) => kind)).toEqual(['unit', 'unit'])
    expect(steps[1].args.slice(-2)).toEqual(['src/code.test.ts', 'src/runner.test.ts'])
    expect(steps[1].name).toBe('second: unit')
    expect(plan({ kinds: [] })).toEqual([])
    expect(plan({ features: [] })).toEqual([])
  })
  it('rejects unknown kinds and features', () => {
    expect(() => plan({ kinds: ['typo'] })).toThrow('Unknown test kind')
    expect(() => plan({ features: ['typo'] })).toThrow('Unknown feature')
  })
  it('requires all tags and names missing tags', () => {
    expect(plan({ kinds: ['checks'] })[1]).toMatchObject({
      status: 'skipped',
      reason: 'Requires --with network,device'
    })
    expect(plan({ kinds: ['checks'], with: ['network'] })[1].reason).toBe('Requires --with device')
    expect(plan({ kinds: ['checks'], with: ['network', 'device'] })[1].status).toBeUndefined()
  })
  it('orders kinds regardless of option order and restores node after e2e', () => {
    const steps = plan({ kinds: ['e2e', 'checks', 'mobile', 'unit'] })
    expect(steps.map(({ kind }) => kind)).toEqual([
      'unit',
      'unit',
      'mobile',
      'checks',
      'checks',
      'e2e',
      'e2e',
      'e2e',
      'e2e'
    ])
    expect(steps[5].args).toEqual(['pnpm.cjs', 'run', 'ensure:electron-runtime'])
    expect(steps[6]).toMatchObject({
      command: 'node',
      args: ['pnpm.cjs', 'exec', 'electron-vite', 'build', '--mode', 'e2e'],
      env: { VITE_EXPOSE_STORE: 'true' },
      dependsOn: ['prepare electron runtime']
    })
    expect(steps[7]).toMatchObject({
      name: 'sample-feature: e2e',
      args: [
        'pnpm.cjs',
        'exec',
        'playwright',
        'test',
        'tests/e2e/a.spec.ts',
        '--config',
        'tests/playwright.config.ts',
        '--project',
        'electron-headless'
      ],
      env: { ORCA_BACKGROUND_LAUNCH: '1', SKIP_BUILD: '1' },
      dependsOn: ['prepare electron runtime', 'build electron app']
    })
    expect(steps.at(-1).name).toBe('restore node runtime')
  })
  it('skips only the build when SKIP_BUILD=1', () => {
    expect(plan({ kinds: ['e2e'], env: { SKIP_BUILD: '1' } }).map(({ name }) => name)).toEqual([
      'prepare electron runtime',
      'sample-feature: e2e',
      'restore node runtime'
    ])
    expect(plan({ kinds: ['e2e'], env: { SKIP_BUILD: '0' } })).toHaveLength(4)
    expect(plan({ kinds: ['e2e'], env: { SKIP_BUILD: '1' } })[1].dependsOn).toEqual([
      'prepare electron runtime'
    ])
  })
  it.each(['unit', 'mobile', 'e2e'])(
    'emits separate %s steps with shared setup and assigns duplicate files to the first feature',
    (kind) => {
      const value = runnableRegistry()
      const secondFile = {
        unit: 'src/second.test.ts',
        mobile: 'mobile/second.test.tsx',
        e2e: 'tests/e2e/second.spec.ts'
      }[kind]
      value.features[0][kind].push(value.features[0][kind][0])
      value.features[1][kind].push(secondFile, secondFile)
      const steps = plan({ kinds: [kind], features: ['second', 'sample-feature'] }, value)
      const featureSteps = steps.filter(({ name }) => name.endsWith(`: ${kind}`))
      expect(featureSteps.map(({ name }) => name)).toEqual([
        `sample-feature: ${kind}`,
        `second: ${kind}`
      ])
      const firstFile = value.features[0][kind][0]
      const argument = kind === 'mobile' ? firstFile.slice('mobile/'.length) : firstFile
      expect(featureSteps[0].args.filter((arg) => arg === argument)).toHaveLength(1)
      expect(featureSteps[1].args).not.toContain(argument)
      expect(featureSteps[1].args).not.toContain('src/runner.test.ts')
      expect(
        featureSteps[1].args.filter(
          (arg) =>
            arg.endsWith('second.test.ts') ||
            arg.endsWith('second.test.tsx') ||
            arg.endsWith('second.spec.ts')
        )
      ).toHaveLength(1)
      if (kind === 'unit') {
        expect(steps.map(({ name }) => name)).toEqual([
          'prepare node runtime',
          'sample-feature: unit',
          'second: unit'
        ])
        expect(
          featureSteps.every(
            ({ dependsOn }) => dependsOn.length === 1 && dependsOn[0] === 'prepare node runtime'
          )
        ).toBe(true)
      } else if (kind === 'e2e') {
        expect(steps.map(({ name }) => name)).toEqual([
          'prepare electron runtime',
          'build electron app',
          'sample-feature: e2e',
          'second: e2e',
          'restore node runtime'
        ])
        for (const step of featureSteps) {
          expect(step.dependsOn).toEqual(['prepare electron runtime', 'build electron app'])
        }
      } else {
        expect(steps).toHaveLength(2)
        expect(featureSteps.every(({ cwd }) => cwd === join(scratch, 'mobile'))).toBe(true)
      }
    }
  )
  it('does not prepare runtimes for empty test lists', () => {
    expect(
      buildRunPlan(registry([feature({ unit: [], checks: [] })]), { kinds: ['unit', 'e2e'] })
    ).toEqual([])
  })
})

describe('run execution with fake processes', () => {
  it.each(['unit', 'mobile', 'e2e'])(
    'reports the failing %s feature and continues the next feature',
    (kind) => {
      const value = runnableRegistry()
      const secondFile = {
        unit: 'src/second.test.ts',
        mobile: 'mobile/second.test.tsx',
        e2e: 'tests/e2e/second.spec.ts'
      }[kind]
      value.features[1][kind].push(secondFile)
      const steps = plan({ kinds: [kind] }, value)
      const first = steps.find(({ name }) => name === `sample-feature: ${kind}`)
      const run = vi.fn(({ args }) => ({ code: args === first.args ? 1 : 0 }))
      const report = executeRunPlan(steps, { run, output: () => {} })
      expect(report.results.filter(({ name }) => name.endsWith(`: ${kind}`))).toMatchObject([
        { name: `sample-feature: ${kind}`, status: 'failed', exitCode: 1 },
        { name: `second: ${kind}`, status: 'passed', exitCode: 0 }
      ])
      expect(run).toHaveBeenCalledTimes(steps.length)
      if (kind === 'e2e') {
        expect(report.results.at(-1)).toMatchObject({
          name: 'restore node runtime',
          status: 'passed'
        })
      }
    }
  )
  it.each(['prepare node runtime', 'prepare electron runtime', 'build electron app'])(
    'skips every dependent feature when %s fails',
    (name) => {
      const kind = name === 'prepare node runtime' ? 'unit' : 'e2e'
      const value = runnableRegistry()
      value.features[1][kind].push(kind === 'unit' ? 'second.test.ts' : 'tests/e2e/second.spec.ts')
      const steps = plan({ kinds: [kind] }, value)
      const failed = steps.find((step) => step.name === name)
      const run = vi.fn(({ args }) => ({ code: args === failed.args ? 1 : 0 }))
      const report = executeRunPlan(steps, { run, output: () => {} })
      const featureResults = report.results.filter((result) => result.name.endsWith(`: ${kind}`))
      expect(featureResults).toHaveLength(2)
      for (const result of featureResults) {
        expect(result).toMatchObject({
          status: 'skipped',
          reason: `Prerequisite did not pass: ${name}`
        })
      }
      if (kind === 'e2e') {
        expect(report.results.at(-1)).toMatchObject({
          name: 'restore node runtime',
          status: 'passed'
        })
      }
    }
  )
  it('keeps going after failures and spawn errors and writes the exact report shape', () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ code: 2 })
      .mockImplementationOnce(() => {
        throw new Error('not found')
      })
      .mockReturnValue({ code: 0 })
    const steps = plan({ kinds: ['checks'] })
    steps.push({ ...steps[0], name: 'throws' }, { ...steps[0], name: 'last' })
    const output = vi.fn()
    let tick = 0
    const report = executeRunPlan(steps, {
      run,
      output,
      now: () => '2026-10-16T00:00:00.000Z',
      clock: () => tick++
    })
    expect(report).toEqual({
      startedAt: '2026-10-16T00:00:00.000Z',
      finishedAt: '2026-10-16T00:00:00.000Z',
      results: [
        {
          kind: 'checks',
          name: 'sample-feature: plain',
          status: 'failed',
          exitCode: 2,
          durationMs: 1
        },
        {
          kind: 'checks',
          name: 'sample-feature: tagged',
          status: 'skipped',
          exitCode: null,
          durationMs: 0,
          reason: 'Requires --with network,device'
        },
        {
          kind: 'checks',
          name: 'throws',
          status: 'failed',
          exitCode: null,
          durationMs: 1,
          reason: 'not found'
        },
        { kind: 'checks', name: 'last', status: 'passed', exitCode: 0, durationMs: 1 }
      ]
    })
    expect(run).toHaveBeenCalledTimes(3)
    expect(run.mock.calls[0][0].env.ORCA_BACKGROUND_LAUNCH).toBe('1')
    expect(output.mock.calls[0][0]).toContain('Kind\tName\tStatus')
    writeRunReport(scratch, 'reports/results.json', report)
    expect(JSON.parse(readFileSync(join(scratch, 'reports/results.json'), 'utf8'))).toEqual(report)
  })
  it('skips unsafe dependent steps after setup failure, continues other kinds and restores node', () => {
    const steps = plan({ kinds: ['unit', 'mobile', 'e2e'] })
    const run = vi.fn(({ args }) => ({
      code: args.includes('ensure:electron-runtime') || args.includes('--runtime=node') ? 1 : 0
    }))
    const report = executeRunPlan(steps, { run, output: () => {} })
    expect(report.results.map(({ status }) => status)).toEqual([
      'failed',
      'skipped',
      'passed',
      'failed',
      'skipped',
      'skipped',
      'failed'
    ])
    expect(run.mock.calls.at(-1)[0].args).toEqual([
      'config/scripts/ensure-native-runtime.mjs',
      '--runtime=node'
    ])
  })
  it.each([
    { code: null, signal: 'SIGTERM' },
    { code: 0, timedOut: true }
  ])('reports abnormal termination %j', (result) => {
    const report = executeRunPlan(plan({ kinds: ['mobile'] }), {
      run: () => result,
      output: () => {}
    })
    expect(report.results[0].status).toBe('failed')
    expect(report.results[0].reason).toBeTruthy()
  })
})
