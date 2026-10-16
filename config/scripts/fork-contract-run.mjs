import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { resolvePnpmCliInvocation } from './pnpm-cli-invocation.mjs'
import { runProcessSync } from '@orca/process-host'

export const RUN_KINDS = ['unit', 'mobile', 'checks', 'e2e']

function featureTestGroups(features, kind) {
  const seen = new Set()
  return features
    .map((feature) => {
      const files =
        kind === 'unit'
          ? [...feature.unit, ...feature.unitSupport.map(({ runner }) => runner)]
          : feature[kind]
      return {
        id: feature.id,
        files: files.filter((file) => {
          if (seen.has(file)) {
            return false
          }
          seen.add(file)
          return true
        })
      }
    })
    .filter(({ files }) => files.length > 0)
}

export function buildRunPlan(registry, opts = {}) {
  const root = opts.root ?? process.cwd()
  const env = opts.env ?? process.env
  const kinds = opts.kinds ?? ['unit', 'mobile', 'checks']
  const selectedIds = opts.features ?? registry.features.map(({ id }) => id)
  for (const kind of kinds) {
    if (!RUN_KINDS.includes(kind)) {
      throw new Error(`Unknown test kind: ${kind}`)
    }
  }
  for (const id of selectedIds) {
    if (!registry.features.some((feature) => feature.id === id)) {
      throw new Error(`Unknown feature: ${id}`)
    }
  }
  const features = registry.features.filter(({ id }) => selectedIds.includes(id))
  const pnpm = opts.pnpm ?? resolvePnpmCliInvocation()
  const plan = []
  const step = (kind, name, command, args, extra = {}) =>
    plan.push({ kind, name, command, args, cwd: root, ...extra })
  const pnpmStep = (kind, name, args, extra) =>
    step(kind, name, pnpm.command, [...pnpm.prefixArgs, ...args], extra)
  const runtime = (kind, name) =>
    step(kind, name, process.execPath, [
      'config/scripts/ensure-native-runtime.mjs',
      '--runtime=node'
    ])
  const units = featureTestGroups(features, 'unit')
  if (kinds.includes('unit') && units.length) {
    runtime('unit', 'prepare node runtime')
    for (const { id, files } of units) {
      pnpmStep(
        'unit',
        `${id}: unit`,
        ['exec', 'vitest', 'run', '--config', 'config/vitest.config.ts', ...files],
        { dependsOn: ['prepare node runtime'] }
      )
    }
  }
  if (kinds.includes('mobile')) {
    for (const { id, files } of featureTestGroups(features, 'mobile')) {
      pnpmStep(
        'mobile',
        `${id}: mobile`,
        ['exec', 'vitest', 'run', ...files.map((file) => file.slice('mobile/'.length))],
        { cwd: path.join(root, 'mobile') }
      )
    }
  }
  if (kinds.includes('checks')) {
    for (const feature of features) {
      for (const check of feature.checks) {
        const missing = (check.requires ?? []).filter((tag) => !(opts.with ?? []).includes(tag))
        step(
          'checks',
          `${feature.id}: ${check.name}`,
          check.cmd[0],
          check.cmd.slice(1),
          missing.length
            ? { status: 'skipped', reason: `Requires --with ${missing.join(',')}` }
            : {}
        )
      }
    }
  }
  const e2e = featureTestGroups(features, 'e2e')
  if (kinds.includes('e2e') && e2e.length) {
    pnpmStep('e2e', 'prepare electron runtime', ['run', 'ensure:electron-runtime'])
    const dependencies = ['prepare electron runtime']
    if (env.SKIP_BUILD !== '1') {
      pnpmStep('e2e', 'build electron app', ['exec', 'electron-vite', 'build', '--mode', 'e2e'], {
        env: { VITE_EXPOSE_STORE: 'true' },
        dependsOn: [...dependencies]
      })
      dependencies.push('build electron app')
    }
    for (const { id, files } of e2e) {
      pnpmStep(
        'e2e',
        `${id}: e2e`,
        [
          'exec',
          'playwright',
          'test',
          ...files,
          '--config',
          'tests/playwright.config.ts',
          '--project',
          'electron-headless'
        ],
        { env: { ORCA_BACKGROUND_LAUNCH: '1', SKIP_BUILD: '1' }, dependsOn: dependencies }
      )
    }
    runtime('e2e', 'restore node runtime')
  }
  return plan
}

export function executeRunPlan(
  plan,
  {
    run = runProcessSync,
    env = process.env,
    now = () => new Date().toISOString(),
    clock = () => performance.now(),
    output = console.log
  } = {}
) {
  const startedAt = now()
  const results = []
  for (const step of plan) {
    const dependency = step.dependsOn?.find((name) =>
      results.some((result) => result.name === name && result.status !== 'passed')
    )
    const reason =
      step.reason ?? (dependency ? `Prerequisite did not pass: ${dependency}` : undefined)
    if (step.status === 'skipped' || dependency) {
      results.push({
        kind: step.kind,
        name: step.name,
        status: 'skipped',
        exitCode: null,
        durationMs: 0,
        reason
      })
      continue
    }
    const start = clock()
    let exitCode = null
    let failure
    try {
      const result = run({
        program: step.command,
        args: step.args,
        cwd: step.cwd,
        env: { ...env, ORCA_BACKGROUND_LAUNCH: '1', ...step.env },
        timeoutMs: null,
        stdio: 'inherit'
      })
      exitCode = result.code
      if (result.timedOut || result.signal || result.code === null) {
        failure = result.timedOut ? 'Timed out' : `Terminated: ${result.signal ?? 'no exit code'}`
      }
    } catch (cause) {
      failure = cause.message
    }
    results.push({
      kind: step.kind,
      name: step.name,
      status: exitCode === 0 && !failure ? 'passed' : 'failed',
      exitCode,
      durationMs: Math.max(0, Math.round(clock() - start)),
      ...(failure ? { reason: failure } : {})
    })
  }
  const report = { startedAt, finishedAt: now(), results }
  output('Kind\tName\tStatus\tExit\tDuration (ms)\tReason')
  for (const result of results) {
    output(
      [
        result.kind,
        result.name,
        result.status,
        result.exitCode ?? '-',
        result.durationMs,
        result.reason ?? ''
      ].join('\t')
    )
  }
  return report
}

export function writeRunReport(root, file, report) {
  const destination = path.resolve(root, file)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`)
}
