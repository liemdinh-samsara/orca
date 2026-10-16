import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runProcessSync } from './script-child-process.mjs'
import {
  REGISTRY_PATH,
  loadRegistry,
  validateRegistry,
  classifyChangedFiles,
  ownersForFiles
} from './fork-contract-registry.mjs'
import { buildRunPlan, executeRunPlan, writeRunReport } from './fork-contract-run.mjs'

export {
  loadRegistry,
  validateRegistry,
  classifyChangedFiles,
  ownersForFiles,
  globToRegExp
} from './fork-contract-registry.mjs'
export { buildRunPlan } from './fork-contract-run.mjs'

function git(root, args) {
  const result = runProcessSync({
    program: 'git',
    args,
    cwd: root,
    maxOutputBytes: 64 * 1024 * 1024
  })
  if (result.code !== 0 || result.timedOut) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout
}

export function forkChangedFiles(root, base) {
  if (!base) {
    const { upstream } = loadRegistry(root)
    const ref = `${upstream.remote}/${upstream.branch}`
    try {
      git(root, ['rev-parse', '--verify', `${ref}^{commit}`])
    } catch {
      throw new Error(
        `Missing upstream ref ${ref}. Run: git remote add ${upstream.remote} ${upstream.url} && git fetch ${upstream.remote} ${upstream.branch} --no-tags`
      )
    }
    base = git(root, ['merge-base', 'HEAD', ref]).trim()
  }
  return [
    ...new Set(
      [
        ...git(root, ['diff', '--name-only', '-z', '--no-renames', base, '--']).split('\0'),
        ...git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0')
      ].filter(Boolean)
    )
  ].sort()
}

function parseArguments(command, args) {
  const allowed = {
    check: ['--base', '--json'],
    owners: ['--json'],
    list: ['--json'],
    run: ['--kinds', '--features', '--with', '--json-out', '--dry-run']
  }
  if (!Object.hasOwn(allowed, command)) {
    throw new Error('Usage: fork-contract.mjs <check|owners|list|run> [options]')
  }
  const options = { files: [] }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (command === 'owners' && !arg.startsWith('--')) {
      options.files.push(arg)
      continue
    }
    if (!allowed[command].includes(arg)) {
      throw new Error(`Unknown option for ${command}: ${arg}`)
    }
    if (arg === '--json' || arg === '--dry-run') {
      options[arg] = true
    } else {
      const value = args[++index]
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`)
      }
      options[arg] = value
    }
  }
  return options
}

function printCheck(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(
    `Fork contract ${report.errors.length ? 'FAILED' : 'OK'} (${report.files.length} changed files)`
  )
  if (report.classification) {
    for (const [category, entries] of Object.entries(report.classification)) {
      console.log(
        `  ${category}: ${Array.isArray(entries) ? entries.length : Object.keys(entries).length}`
      )
    }
  }
  for (const error of report.errors) {
    console.error(
      `${error}\n  Fix: register it under a feature in ${REGISTRY_PATH} with tests; correct invalid or stale entries.`
    )
  }
}

export function main(args = process.argv.slice(2), root = process.cwd()) {
  try {
    const [command, ...rest] = args
    const opts = parseArguments(command, rest)
    const registry = loadRegistry(root)
    if (command === 'check') {
      let files = []
      const errors = []
      try {
        files = forkChangedFiles(root, opts['--base'])
      } catch (cause) {
        errors.push(cause.message)
      }
      const repoFiles = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
        .split('\0')
        .filter(Boolean)
      errors.push(...validateRegistry(registry, { root, forkChangedFiles: files, repoFiles }))
      let classification = null
      try {
        classification = classifyChangedFiles(registry, files, {
          exists: (file) => fs.existsSync(path.join(root, file))
        })
      } catch (cause) {
        if (errors.length === 0) {
          throw cause
        }
      }
      if (classification) {
        errors.push(
          ...classification.unregistered.map((file) => `Unregistered file: ${file}`),
          ...classification.unlistedTests.map((file) => `Unlisted test: ${file}`)
        )
      }
      printCheck({ errors, files, classification }, opts['--json'])
      return errors.length ? 1 : 0
    }
    if (command === 'owners') {
      const owners = Object.fromEntries(ownersForFiles(registry, opts.files))
      if (opts['--json']) {
        console.log(JSON.stringify(owners, null, 2))
      } else {
        for (const [file, ids] of Object.entries(owners)) {
          console.log(`${file}: ${ids.join(', ') || '(unregistered)'}`)
        }
      }
      return 0
    }
    if (command === 'list') {
      if (opts['--json']) {
        console.log(JSON.stringify(registry.features, null, 2))
      } else {
        for (const feature of registry.features) {
          console.log(`${feature.id}: ${feature.title}`)
          for (const kind of ['unit', 'unitSupport', 'mobile', 'e2e', 'checks']) {
            console.log(`  ${kind}: ${JSON.stringify(feature[kind])}`)
          }
        }
      }
      return 0
    }
    const csv = (key) => opts[key]?.split(',').filter(Boolean)
    const plan = buildRunPlan(registry, {
      root,
      kinds: csv('--kinds'),
      features: csv('--features'),
      with: csv('--with')
    })
    if (opts['--dry-run']) {
      console.log(JSON.stringify(plan, null, 2))
      return 0
    }
    const report = executeRunPlan(plan)
    if (opts['--json-out']) {
      writeRunReport(root, opts['--json-out'], report)
    }
    return report.results.some(({ status }) => status === 'failed') ? 1 : 0
  } catch (cause) {
    console.error(cause.message)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
