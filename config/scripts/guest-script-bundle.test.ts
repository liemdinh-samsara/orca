import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGuestScriptBundlePlugin } from '../build-plugins/guest-script-bundle'
import { GUEST_SCRIPT_GLOBAL_NAME } from '../../src/shared/guest-script-bundle'

const EXPORT_DEFAULT_PREFIX = 'export default '
// Why generous: each load runs a real nested vite build.
const BUILD_TIMEOUT_MS = 20_000

let fixtureDir: string | undefined

afterEach(() => {
  if (fixtureDir) {
    rmSync(fixtureDir, { recursive: true, force: true })
    fixtureDir = undefined
  }
})

type GuestScriptApi = {
  mount: (name: string) => string
  mode: () => string | undefined
}

/** Writes a two-module guest script: an entry that imports a dependency. */
function writeGuestScriptFixture(): { entryPath: string; dependencyPath: string } {
  // Why realpath: macOS tmpdir is a symlink, and the bundler reports resolved module ids.
  fixtureDir = realpathSync(mkdtempSync(join(tmpdir(), 'orca-guest-script-bundle-')))
  const dependencyPath = join(fixtureDir, 'greeting.ts')
  const entryPath = join(fixtureDir, 'entry.ts')
  writeFileSync(
    dependencyPath,
    "export function greet(name: string): string {\n  return 'hello ' + name\n}\n"
  )
  writeFileSync(
    entryPath,
    [
      "import { greet } from './greeting'",
      'export function mount(name: string): string {',
      '  return greet(name)',
      '}',
      'export function mode(): string | undefined {',
      '  return process.env.NODE_ENV',
      '}',
      ''
    ].join('\n')
  )
  return { entryPath, dependencyPath }
}

async function loadGuestScript(id: string, addWatchFile = vi.fn()): Promise<unknown> {
  const hook = createGuestScriptBundlePlugin().load
  if (typeof hook !== 'function') {
    throw new Error('Expected load hook')
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the plugin's load only calls this.addWatchFile.
  return hook.call({ addWatchFile } as never, id)
}

function bundledSource(loaded: unknown): string {
  if (typeof loaded !== 'string' || !loaded.startsWith(EXPORT_DEFAULT_PREFIX)) {
    throw new Error('Expected an `export default` module')
  }
  const source: unknown = JSON.parse(loaded.slice(EXPORT_DEFAULT_PREFIX.length))
  if (typeof source !== 'string') {
    throw new Error('Expected the default export to be a string')
  }
  return source
}

function isGuestScriptApi(value: unknown): value is GuestScriptApi {
  return typeof value === 'object' && value !== null && 'mount' in value && 'mode' in value
}

/** Runs the bundle in a bare context and returns the API it leaves on the guest global. */
function runInGuestWorld(source: string): GuestScriptApi {
  // Why a bare context: the guest world has no module loader and no `process`, so a leftover
  // import or an un-inlined env read would throw here.
  const guestWorld: Record<string, unknown> = {}
  runInNewContext(source, guestWorld)
  const api = guestWorld[GUEST_SCRIPT_GLOBAL_NAME]
  if (!isGuestScriptApi(api)) {
    throw new Error(`The bundle did not define ${GUEST_SCRIPT_GLOBAL_NAME}`)
  }
  return api
}

describe('guest script bundle plugin', () => {
  it('ignores ids without the ?guest-script query', async () => {
    expect(await loadGuestScript('/src/entry.ts')).toBeNull()
    expect(await loadGuestScript('/src/entry.ts?raw')).toBeNull()
    expect(await loadGuestScript('/src/entry.ts?guest-script&x=1')).toBeNull()
  })

  it(
    'bundles an entry and its import into one self-contained IIFE string',
    async () => {
      const { entryPath } = writeGuestScriptFixture()

      const source = bundledSource(await loadGuestScript(`${entryPath}?guest-script`))

      const api = runInGuestWorld(source)
      expect(typeof api.mount).toBe('function')
      expect(api.mount('guest')).toBe('hello guest')
    },
    BUILD_TIMEOUT_MS
  )

  it(
    'watches every bundled module so editing a dependency rebuilds the chunk',
    async () => {
      const { entryPath, dependencyPath } = writeGuestScriptFixture()
      const addWatchFile = vi.fn()

      await loadGuestScript(`${entryPath}?guest-script`, addWatchFile)

      const watched = addWatchFile.mock.calls.map(([moduleId]) => resolve(String(moduleId)))
      expect(watched).toContain(resolve(entryPath))
      expect(watched).toContain(resolve(dependencyPath))
    },
    BUILD_TIMEOUT_MS
  )

  it(
    'inlines process.env.NODE_ENV as production',
    async () => {
      const { entryPath } = writeGuestScriptFixture()

      const source = bundledSource(await loadGuestScript(`${entryPath}?guest-script`))

      expect(source).not.toContain('process.env')
      expect(runInGuestWorld(source).mode()).toBe('production')
    },
    BUILD_TIMEOUT_MS
  )
})
