import fs from 'node:fs'
import path from 'node:path'

export const REGISTRY_PATH = 'config/fork/fork-features.json'
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const unitPattern = /\.test\.(ts|tsx|mts|mjs)$/
const mobilePattern = /^mobile\/.+\.test\.(ts|tsx)$/
const e2ePattern = /^tests\/e2e\/(?:[^/]+\/)*[^/]+\.spec\.ts$/

export function loadRegistry(root = process.cwd()) {
  return JSON.parse(fs.readFileSync(path.join(root, REGISTRY_PATH), 'utf8'))
}

export function globToRegExp(glob) {
  let source = '^'
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]
    if (char === '*' && glob[index + 1] === '*') {
      index++
      if (glob[index + 1] === '/') {
        source += '(?:[\\s\\S]*/)?'
        index++
      } else {
        source += '[\\s\\S]*'
      }
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`)
}

function existingFiles(root, patterns) {
  const files = new Set()
  const visited = new Set()
  function walk(directory) {
    if (visited.has(directory)) {
      return
    }
    visited.add(directory)
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') {
          walk(absolute)
        }
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.add(path.relative(root, absolute).split(path.sep).join('/'))
      }
    }
  }
  for (const pattern of patterns) {
    if (!/[*?]/.test(pattern)) {
      if (
        fs.existsSync(path.join(root, pattern)) &&
        fs.statSync(path.join(root, pattern)).isFile()
      ) {
        files.add(pattern)
      }
      continue
    }
    const prefix = pattern
      .split('/')
      .filter((segment, index, segments) =>
        segments.slice(0, index + 1).every((part) => !/[*?]/.test(part))
      )
      .join('/')
    const directory = path.resolve(root, prefix || '.')
    if (fs.existsSync(directory) && fs.statSync(directory).isDirectory()) {
      walk(directory)
    }
  }
  return [...files]
}

function stringList(value) {
  return Array.isArray(value) && value.every(nonempty)
}

export function validateRegistry(
  registry,
  {
    root = process.cwd(),
    exists = (file) => fs.existsSync(path.join(root, file)),
    readFile = (file) => fs.readFileSync(path.join(root, file), 'utf8'),
    forkChangedFiles = [],
    repoFiles
  } = {}
) {
  const errors = []
  if (!record(registry)) {
    return ['Registry must be an object']
  }
  if (registry.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1')
  }
  if (
    !record(registry.upstream) ||
    !['remote', 'url', 'branch'].every((key) => nonempty(registry.upstream[key]))
  ) {
    errors.push('upstream must have remote, url and branch')
  }
  if (!stringList(registry.exempt)) {
    errors.push('exempt must be an array of non-empty patterns')
  }
  if (!Array.isArray(registry.features)) {
    return [...errors, 'features must be an array']
  }
  const patterns = registry.features.flatMap((feature) =>
    record(feature) && stringList(feature.paths) ? feature.paths : []
  )
  const candidates = [...(repoFiles ?? existingFiles(root, patterns)), ...forkChangedFiles]
  const ids = new Set()
  for (const feature of registry.features) {
    if (!record(feature)) {
      errors.push('Feature must be an object')
      continue
    }
    const label = nonempty(feature.id) ? feature.id : '(unnamed feature)'
    const error = (message) => errors.push(`${label}: ${message}`)
    if (!nonempty(feature.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature.id)) {
      error('id must be kebab-case')
    }
    if (ids.has(feature.id)) {
      error('duplicate id')
    }
    ids.add(feature.id)
    if (!nonempty(feature.title)) {
      error('title must be non-empty')
    }
    if (!stringList(feature.paths) || feature.paths.length === 0) {
      error('paths must be a non-empty array of patterns')
    } else {
      for (const pattern of feature.paths) {
        const matcher = globToRegExp(pattern)
        if (
          !candidates.some(
            (file) => matcher.test(file) && (exists(file) || forkChangedFiles.includes(file))
          )
        ) {
          error(`stale pattern: ${pattern}`)
        }
      }
    }
    if (
      !['unit', 'unitSupport', 'mobile', 'e2e', 'checks'].some(
        (key) => Array.isArray(feature[key]) && feature[key].length > 0
      )
    ) {
      error('must register at least one test or check')
    }
    for (const [key, pattern] of [
      ['unit', unitPattern],
      ['mobile', mobilePattern],
      ['e2e', e2ePattern]
    ]) {
      if (!stringList(feature[key])) {
        error(`${key} must be an array of test files`)
        continue
      }
      for (const file of feature[key]) {
        if (!pattern.test(file)) {
          error(`invalid ${key} test file: ${file}`)
        }
        if (!exists(file)) {
          error(`missing ${key} test file: ${file}`)
        }
      }
    }
    if (!Array.isArray(feature.unitSupport)) {
      error('unitSupport must be an array')
    } else {
      for (const support of feature.unitSupport) {
        if (!record(support) || !nonempty(support.file) || !nonempty(support.runner)) {
          error('unitSupport must contain file and runner')
          continue
        }
        if (!exists(support.file)) {
          error(`missing support file: ${support.file}`)
        }
        if (!unitPattern.test(support.runner)) {
          error(`invalid unitSupport runner: ${support.runner}`)
        }
        if (!exists(support.runner)) {
          error(`missing support runner: ${support.runner}`)
        } else {
          try {
            const fragment = path.posix.basename(support.file).replace(/\.ts$/, '')
            if (!readFile(support.runner).includes(fragment)) {
              error(`fragment never runs: ${support.file} is not imported by ${support.runner}`)
            }
          } catch (cause) {
            error(`cannot read support runner ${support.runner}: ${cause.message}`)
          }
        }
      }
    }
    if (!Array.isArray(feature.checks)) {
      error('checks must be an array')
    } else {
      for (const check of feature.checks) {
        if (
          !record(check) ||
          !nonempty(check.name) ||
          !stringList(check.cmd) ||
          check.cmd.length === 0
        ) {
          error('checks must have a name and non-empty string argv')
        } else if (check.requires !== undefined && !stringList(check.requires)) {
          error(`check ${check.name}: requires must be an array of tags`)
        }
      }
    }
    if (!['desktop', 'mobile', 'both', 'none'].includes(feature.appProof?.surface)) {
      error('appProof.surface must be desktop, mobile, both or none')
    }
  }
  return errors
}

function testFiles(feature) {
  return [
    ...(feature.unit ?? []),
    ...(feature.mobile ?? []),
    ...(feature.e2e ?? []),
    ...(feature.unitSupport ?? []).flatMap(({ file, runner }) => [file, runner])
  ]
}

export function ownersForFiles(registry, files) {
  const features = registry.features.map((feature) => ({
    id: feature.id,
    patterns: feature.paths.map(globToRegExp),
    tests: new Set(testFiles(feature))
  }))
  return new Map(
    files.map((file) => [
      file,
      features
        .filter(
          (feature) =>
            feature.tests.has(file) || feature.patterns.some((pattern) => pattern.test(file))
        )
        .map((feature) => feature.id)
    ])
  )
}

export function classifyChangedFiles(
  registry,
  files,
  { exists = (file) => fs.existsSync(path.resolve(file)) } = {}
) {
  const result = {
    owned: {},
    exempt: [],
    tests: [],
    deleted: [],
    unregistered: [],
    unlistedTests: []
  }
  const owners = ownersForFiles(registry, files)
  const exemptions = registry.exempt.map(globToRegExp)
  const listedTests = new Set(registry.features.flatMap(testFiles))
  for (const file of new Set(files)) {
    if (!exists(file)) {
      result.deleted.push(file)
    } else if (exemptions.some((pattern) => pattern.test(file))) {
      result.exempt.push(file)
    } else if (listedTests.has(file)) {
      result.tests.push(file)
    } else if (owners.get(file).length > 0) {
      Object.defineProperty(result.owned, file, { value: owners.get(file), enumerable: true })
    } else if (/(?:\.test\.|\.spec\.)/.test(file) || file.startsWith('tests/')) {
      result.unlistedTests.push(file)
    } else {
      result.unregistered.push(file)
    }
  }
  return result
}
