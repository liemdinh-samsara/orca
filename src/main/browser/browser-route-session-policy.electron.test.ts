import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { BROWSER_ROUTE_PROXY_BYPASS_RULES } from './browser-route-session-policy'
import { resolveElectronProbeLaunch } from './electron-probe-display-launch'

const electronBinary = createRequire(import.meta.url)('electron')
const fixtureRoots: string[] = []
const urls = [
  'http://127.0.0.1:8769/',
  'http://localhost:65111/',
  'http://[::1]:65123/',
  'http://127.0.0.1:8770/',
  'http://localhost:3000/'
]

afterAll(() => {
  const failures: unknown[] = []
  for (const root of fixtureRoots) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to clean up session policy fixtures')
  }
})

function probeMain(resultPath: string): string {
  return `
const { app, session } = require('electron')
const { writeFileSync } = require('node:fs')
if (process.platform === 'linux') app.disableHardwareAcceleration()
const timeout = setTimeout(() => {
  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ error: 'Proxy resolution timed out' }))
  app.exit(2)
}, 15000)

async function run() {
  await app.whenReady()
  const routeSession = session.fromPartition('okta-loopback-probe', { cache: false })
  await routeSession.setProxy({
    mode: 'fixed_servers',
    proxyRules: 'socks5://127.0.0.1:1080',
    proxyBypassRules: ${JSON.stringify(BROWSER_ROUTE_PROXY_BYPASS_RULES)}
  })
  await routeSession.closeAllConnections()
  const results = []
  for (const url of ${JSON.stringify(urls)}) {
    results.push({ url, proxy: await routeSession.resolveProxy(url) })
  }
  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(results))
  clearTimeout(timeout)
  app.quit()
}

run().catch((error) => {
  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ error: String(error?.stack || error) }))
  app.exit(1)
})
`
}

describe('browser route session policy under Electron', () => {
  it('bypasses the SSH proxy only for desktop authenticator ports', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-browser-session-policy-'))
    fixtureRoots.push(root)
    const mainPath = join(root, 'main.cjs')
    const resultPath = join(root, 'result.json')
    writeFileSync(mainPath, probeMain(resultPath))
    if (typeof electronBinary !== 'string') {
      throw new Error('Electron did not resolve to an executable path')
    }
    const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...env } = process.env
    const { executable, args } = resolveElectronProbeLaunch({
      electronBinary,
      electronArgs: [mainPath, `--user-data-dir=${join(root, 'profile')}`],
      platform: process.platform,
      display: env.DISPLAY
    })
    const run = spawnSync(executable, args, {
      encoding: 'utf8',
      env: { ...env, ORCA_BACKGROUND_LAUNCH: '1' },
      timeout: 25_000
    })
    const rawResult = existsSync(resultPath) ? readFileSync(resultPath, 'utf8') : 'no result'
    expect(run.error).toBeUndefined()
    expect(run.status, `${rawResult}\nsignal: ${run.signal}\n${run.stdout}\n${run.stderr}`).toBe(0)
    expect(JSON.parse(rawResult)).toEqual([
      { url: urls[0], proxy: 'DIRECT' },
      { url: urls[1], proxy: 'DIRECT' },
      { url: urls[2], proxy: 'DIRECT' },
      { url: urls[3], proxy: 'SOCKS5 127.0.0.1:1080' },
      { url: urls[4], proxy: 'SOCKS5 127.0.0.1:1080' }
    ])
  }, 30_000)
})
