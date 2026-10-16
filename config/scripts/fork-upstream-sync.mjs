import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DEFAULT_UPSTREAM = {
  remote: 'upstream',
  url: 'https://github.com/stablyai/orca.git',
  branch: 'main'
}

class SyncError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.exitCode = exitCode
  }
}

function command(root, program, args) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  })
  if (result.error) {
    throw result.error
  }
  return result
}

function checked(result) {
  if (result.status !== 0) {
    throw new SyncError(result.stderr?.trim() || result.stdout?.trim() || 'Command failed')
  }
  return result.stdout.trim()
}

function git(root, args) {
  return checked(command(root, 'git', args))
}

function unresolvedFiles(root) {
  return commandFiles(root, ['diff', '--name-only', '--diff-filter=U', '-z'])
}

function commandFiles(root, args) {
  const result = command(root, 'git', args)
  checked(result)
  return result.stdout.split('\0').filter(Boolean)
}

function mergeInProgress(root) {
  const result = command(root, 'git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  if (result.status !== 0 && result.status !== 1) {
    checked(result)
  }
  return result.status === 0
}

function statePath(root) {
  return path.resolve(root, git(root, ['rev-parse', '--git-path', 'fork-sync/state.json']))
}

export function readState(root) {
  return JSON.parse(fs.readFileSync(statePath(root), 'utf8'))
}

function writeState(root, state) {
  const file = statePath(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`)
}

function upstreamConfig(root) {
  const file = path.join(root, 'config/fork/fork-features.json')
  if (!fs.existsSync(file)) {
    return DEFAULT_UPSTREAM
  }
  const config = { ...DEFAULT_UPSTREAM, ...JSON.parse(fs.readFileSync(file, 'utf8')).upstream }
  for (const key of ['remote', 'url', 'branch']) {
    if (typeof config[key] !== 'string' || !config[key] || config[key].startsWith('-')) {
      throw new SyncError(`Invalid upstream ${key}`)
    }
  }
  if (config.remote === 'origin') {
    throw new SyncError('Upstream remote must differ from origin')
  }
  git(root, ['check-ref-format', `refs/remotes/${config.remote}/${config.branch}`])
  return config
}

async function resolveFileOwners(root, files, resolveOwners) {
  if (resolveOwners) {
    return await resolveOwners(files)
  }
  try {
    const { loadRegistry, ownersForFiles } = await import('./fork-contract.mjs')
    return ownersForFiles(await loadRegistry(root), files)
  } catch {
    return new Map()
  }
}

export function defaultBranch(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `sync/upstream-${date.getFullYear()}-${month}-${day}`
}

function availableBranch(root, requested, noFetch) {
  if (requested === 'main' || requested.startsWith('-')) {
    throw new SyncError('Sync must use a branch other than main')
  }
  git(root, ['check-ref-format', `refs/heads/${requested}`])
  const local = git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/'])
  const taken = new Set(local.split('\n'))
  if (!noFetch) {
    const remote = git(root, ['ls-remote', '--heads', 'origin'])
    for (const line of remote.split('\n').filter(Boolean)) {
      taken.add(line.split('\t')[1])
    }
  }
  let candidate = requested
  for (let suffix = 2; taken.has(`refs/heads/${candidate}`); suffix++) {
    candidate = `${requested}-${suffix}`
  }
  return candidate
}

export async function startSync(root, options = {}) {
  const state = {
    status: 'error',
    branch: null,
    base: options.base ?? 'origin/main',
    baseSha: null,
    upstreamRef: null,
    upstreamSha: null,
    behind: 0,
    forkAhead: 0,
    conflicts: [],
    startedAt: new Date().toISOString()
  }
  let exitCode = 0
  let message
  try {
    if (mergeInProgress(root)) {
      throw new SyncError('A merge is already in progress; finish or abort it before starting', 3)
    }
    if (git(root, ['status', '--porcelain'])) {
      throw new SyncError('Working tree is dirty; commit or stash changes before starting', 3)
    }
    if (state.base.startsWith('-')) {
      throw new SyncError('Invalid base ref')
    }
    const upstream = upstreamConfig(root)
    state.upstreamRef = `${upstream.remote}/${upstream.branch}`
    const remotes = git(root, ['remote']).split('\n')
    if (!remotes.includes(upstream.remote)) {
      git(root, ['remote', 'add', upstream.remote, upstream.url])
    }
    if (!options.noFetch) {
      git(root, ['fetch', 'origin', '--prune'])
      git(root, ['fetch', upstream.remote, upstream.branch, '--no-tags'])
    }
    state.baseSha = git(root, ['rev-parse', '--verify', `${state.base}^{commit}`])
    state.upstreamSha = git(root, ['rev-parse', '--verify', `${state.upstreamRef}^{commit}`])
    state.behind = Number(
      git(root, ['rev-list', '--count', `${state.baseSha}..${state.upstreamSha}`])
    )
    state.forkAhead = Number(
      git(root, ['rev-list', '--count', '--no-merges', `${state.upstreamSha}..${state.baseSha}`])
    )
    if (!state.behind) {
      state.status = 'up-to-date'
    } else {
      const branch = availableBranch(root, options.branch ?? defaultBranch(), options.noFetch)
      git(root, ['switch', '-c', branch, state.base])
      state.branch = branch
      const shortSha = git(root, ['rev-parse', '--short', state.upstreamSha])
      const subject = `chore: sync upstream stablyai/orca ${upstream.branch} (${state.behind} commits, up to ${shortSha})`
      const merge = command(root, 'git', [
        'merge',
        '--no-ff',
        '--no-edit',
        '-m',
        subject,
        state.upstreamRef
      ])
      if (merge.status === 0) {
        state.status = 'merged'
      } else {
        const files = unresolvedFiles(root)
        if (!files.length) {
          checked(merge)
        }
        const owners = await resolveFileOwners(root, files, options.resolveOwners)
        state.conflicts = files.map((file) => ({ file, owners: owners.get(file) ?? [] }))
        state.status = 'conflicts'
        exitCode = 2
      }
    }
  } catch (error) {
    exitCode = error.exitCode ?? 1
    message = error.message
    state.status = exitCode === 3 ? 'blocked' : 'error'
  }
  writeState(root, state)
  return { state, exitCode, message }
}

export function syncStatus(root) {
  return {
    ...readState(root),
    mergeInProgress: mergeInProgress(root),
    unresolved: unresolvedFiles(root),
    head: git(root, ['rev-parse', 'HEAD'])
  }
}

export function topAreas(files) {
  const counts = new Map()
  for (const file of files) {
    const segments = file.split('/')
    const area = segments.slice(0, segments[0] === 'src' ? 3 : 2).join('/')
    counts.set(area, (counts.get(area) ?? 0) + 1)
  }
  return [...counts]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area))
    .slice(0, 10)
}

export async function syncSummary(root, { resolveOwners } = {}) {
  const state = readState(root)
  if (!state.baseSha || !state.upstreamSha) {
    throw new SyncError('Sync state has no commit range; run start successfully first')
  }
  const range = `${state.baseSha}..${state.upstreamSha}`
  const count = Number(git(root, ['rev-list', '--count', range]))
  const firstSubject = count
    ? git(root, ['log', '--reverse', '--format=%s', range]).split('\n')[0]
    : null
  const lastSubject = count ? git(root, ['log', '-1', '--format=%s', range]) : null
  const upstreamFiles = commandFiles(root, [
    'diff',
    '--name-only',
    '-z',
    state.baseSha,
    state.upstreamSha
  ])
  const changed = commandFiles(root, ['diff', '--name-only', '-z', state.baseSha, 'HEAD'])
  const owners = await resolveFileOwners(root, changed, resolveOwners)
  const features = new Map()
  for (const file of changed) {
    for (const id of owners.get(file) ?? []) {
      if (!features.has(id)) {
        features.set(id, new Set())
      }
      features.get(id).add(file)
    }
  }
  return {
    upstreamRef: state.upstreamRef,
    baseSha: state.baseSha,
    upstreamSha: state.upstreamSha,
    count,
    firstSubject,
    lastSubject,
    topAreas: topAreas(upstreamFiles),
    featuresAffected: [...features]
      .map(([id, files]) => ({ id, files: [...files].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }
}

function tableCell(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/\r?\n/g, ' ')
}

export function renderPrBody(state, summary, gate, { resolutions, reportUrl } = {}) {
  const rank = { failed: 0, skipped: 1, passed: 2 }
  const rows = [...gate.results]
    .sort((a, b) => rank[a.status] - rank[b.status])
    .map(
      (r) =>
        `| ${tableCell(r.kind)} | ${tableCell(r.name)} | ${tableCell(r.status)} | ${tableCell(r.durationMs)} ms |`
    )
  const areas = summary.topAreas.map((a) => `- ${a.area}: ${a.count} file(s)`)
  const features = summary.featuresAffected.map((f) => `- ${f.id}: ${f.files.join(', ')}`)
  const conflicts = state.conflicts.map(
    (c) => `- ${c.file} (owners: ${c.owners.join(', ') || 'none'})`
  )
  const failures = gate.results
    .filter((r) => r.status === 'failed')
    .map((r) => `- ${r.name}: exit ${r.exitCode}${r.reason ? ` — ${r.reason}` : ''}`)
  return [
    '## ELI5',
    '',
    `Bring ${summary.count} upstream commit(s) into the personal fork.`,
    '',
    '## What Changed',
    '',
    `Upstream: ${summary.upstreamRef}; range \`${summary.baseSha}..${summary.upstreamSha}\` (${summary.count} commits).`,
    `First subject: ${summary.firstSubject ?? 'none'}`,
    `Last subject: ${summary.lastSubject ?? 'none'}`,
    '',
    '### Top areas',
    '',
    ...(areas.length ? areas : ['None.']),
    '',
    '### Features affected',
    '',
    ...(features.length ? features : ['None.']),
    '',
    '### Conflicts',
    '',
    ...(conflicts.length ? conflicts : ['None.']),
    '',
    ...(resolutions ? ['### Resolutions', '', resolutions, ''] : []),
    '## Why',
    '',
    'Keep the fork current while preserving its changes. A merge retains upstream ancestry for later syncs.',
    '',
    '## Visual Proof',
    '',
    reportUrl ? `[App proof report](${reportUrl})` : 'No app proof attached',
    '',
    '## Testing',
    '',
    '| Kind | Name | Status | Duration |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    ...(failures.length ? ['### Failed gates', '', ...failures, ''] : []),
    '## Notes',
    '',
    '**How to land:** Use a merge commit, not squash, so later syncs keep a merge base.',
    ''
  ].join('\n')
}

export function originRepository(url) {
  const match =
    /^(?:https?:\/\/github\.com\/|ssh:\/\/(?:git@)?github\.com\/|git@github\.com:)([^/\s]+\/[^/\s]+?)\/?$/.exec(
      url.trim()
    )
  if (!match) {
    throw new SyncError('Publishing requires a GitHub origin URL (SSH or HTTPS)')
  }
  return match[1].replace(/\.git$/, '')
}

export function publishSync(root, options, run = (program, args) => command(root, program, args)) {
  const current = run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (current.status === 1) {
    throw new SyncError('Refusing to publish detached HEAD; switch to a sync/ branch first', 4)
  }
  const branch = checked(current)
  if (!branch.startsWith('sync/')) {
    throw new SyncError(`Refusing to publish non-sync branch: ${branch}`, 4)
  }
  const repo = originRepository(checked(run('git', ['remote', 'get-url', 'origin'])))
  checked(run('git', ['push', '-u', 'origin', branch]))
  const existing = run('gh', ['pr', 'view', branch, '--repo', repo, '--json', 'url'])
  if (existing.status === 0) {
    const { url } = JSON.parse(existing.stdout)
    checked(run('gh', ['pr', 'edit', branch, '--repo', repo, '--body-file', options.bodyFile]))
    return url
  }
  // Authentication and transport failures must not turn into duplicate PR creation attempts.
  if (!/no pull requests? found/i.test(`${existing.stderr}\n${existing.stdout}`)) {
    checked(existing)
  }
  return checked(
    run('gh', [
      'pr',
      'create',
      '--repo',
      repo,
      '--base',
      'main',
      '--head',
      branch,
      '--title',
      options.title,
      '--body-file',
      options.bodyFile,
      ...(options.draft ? ['--draft'] : [])
    ])
  )
}

const OPTIONS = {
  start: { '--base': 'base', '--branch': 'branch', '--no-fetch': 'noFetch', '--json': 'json' },
  status: { '--json': 'json' },
  summary: { '--json': 'json' },
  'pr-body': {
    '--gate': 'gate',
    '--resolutions': 'resolutions',
    '--report-url': 'reportUrl',
    '--out': 'out'
  },
  publish: { '--title': 'title', '--body-file': 'bodyFile', '--draft': 'draft' }
}

function parseOptions(subcommand, args) {
  if (!Object.hasOwn(OPTIONS, subcommand)) {
    throw new SyncError(
      'Usage: fork-upstream-sync.mjs <start|status|summary|pr-body|publish> [options]'
    )
  }
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const key = Object.hasOwn(OPTIONS[subcommand], args[index])
      ? OPTIONS[subcommand][args[index]]
      : undefined
    if (!key) {
      throw new SyncError(`Unknown option: ${args[index]}`)
    }
    if (['json', 'noFetch', 'draft'].includes(key)) {
      options[key] = true
    } else {
      const value = args[++index]
      if (!value || value.startsWith('--')) {
        throw new SyncError(`Missing value for ${key}`)
      }
      options[key] = value
    }
  }
  for (const key of subcommand === 'publish'
    ? ['title', 'bodyFile']
    : subcommand === 'pr-body'
      ? ['gate']
      : []) {
    if (!options[key]) {
      throw new SyncError(`Missing required option: ${key}`)
    }
  }
  return options
}

function printData(data, json) {
  if (json) {
    console.log(JSON.stringify(data, null, 2))
    return
  }
  for (const [key, value] of Object.entries(data)) {
    console.log(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
  }
}

export async function main(args = process.argv.slice(2), root = process.cwd()) {
  try {
    const [subcommand, ...rest] = args
    const options = parseOptions(subcommand, rest)
    if (subcommand === 'start') {
      const result = await startSync(root, options)
      printData(result.state, options.json)
      if (result.message) {
        console.error(result.message)
      }
      return result.exitCode
    }
    if (subcommand === 'status' || subcommand === 'summary') {
      printData(subcommand === 'status' ? syncStatus(root) : await syncSummary(root), options.json)
    } else if (subcommand === 'pr-body') {
      const gate = JSON.parse(fs.readFileSync(path.resolve(root, options.gate), 'utf8'))
      const resolutions = options.resolutions
        ? fs.readFileSync(path.resolve(root, options.resolutions), 'utf8')
        : undefined
      const body = renderPrBody(readState(root), await syncSummary(root), gate, {
        ...options,
        resolutions
      })
      if (options.out) {
        fs.writeFileSync(path.resolve(root, options.out), body)
      } else {
        console.log(body)
      }
    } else {
      console.log(publishSync(root, options))
    }
    return 0
  } catch (error) {
    console.error(error.message)
    return error.exitCode ?? 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main()
}
