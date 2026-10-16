import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect } from 'vitest'
import {
  cleanupScratch,
  copyScriptsIntoRepo,
  mac,
  passed,
  run,
  sandbox,
  scripts,
  stubExecutable,
  unix
} from './orca-skill-script-sandbox.mjs'

afterEach(cleanupScratch)

const identity = { commit: 'abc1234def56', version: '9.9.9-local.1.abc1234def56' }
const defaultSigner = 'Orca Local Signing'
const arch = process.arch === 'x64' ? 'x64' : 'arm64'
const deadPid = '2147483646'
const recorder = (name) => `echo "${name} $*" >> "$CALLS"`

const nodeStub = `case "$*" in
  *versions.node*) echo 24 ;;
  *input-type*) echo '${JSON.stringify(identity)}' ;;
  *.commit*) echo ${identity.commit} ;;
  *.version*) echo ${identity.version} ;;
esac`

const pnpmStub = `echo "pnpm $*" >> "$CALLS"
case "$1" in
  build)
    if [ "$FAIL_BUILD" != 0 ]; then echo 'build exploded'; fi
    exit "$FAIL_BUILD" ;;
  exec)
    echo "builder commit=$ORCA_BUILD_COMMIT version=$ORCA_LOCAL_BUILD_VERSION" >> "$CALLS"
    if [ "$FAIL_PACK" != 0 ]; then echo 'pack exploded'; fi
    exit "$FAIL_PACK" ;;
esac`

const pgrepStub = `if [ -z "$PGREP_PID" ]; then exit 1; fi
if [ "$1" = -fl ]; then echo "$PGREP_PID Orca"; else echo "$PGREP_PID"; fi`

const codesignStub = `${recorder('codesign')}
case "$*" in *"-d -r-"*) echo 'designated => identifier "com.orca"' ;; esac`

const securityStub = `${recorder('security')}
echo "    1) ABCDEF \\"$LISTED_IDENTITY\\""`

async function installSandbox(extraEnv = {}) {
  const box = sandbox({
    FAIL_BUILD: '0',
    FAIL_PACK: '0',
    PGREP_PID: '',
    LISTED_IDENTITY: defaultSigner,
    ...extraEnv
  })
  const { repo, copiedScripts, git } = copyScriptsIntoRepo(box)
  await git(['init'])
  stubExecutable(box.bin, 'node', nodeStub)
  stubExecutable(box.bin, 'pnpm', pnpmStub)
  stubExecutable(box.bin, 'pgrep', pgrepStub)
  stubExecutable(box.bin, 'codesign', codesignStub)
  stubExecutable(box.bin, 'security', securityStub)
  stubExecutable(box.bin, 'defaults', `${recorder('defaults')}\necho ${identity.version}`)
  stubExecutable(box.bin, 'sleep', 'exit 0')
  // Why: the script hardcodes /Applications/Orca.app, so mv, ditto and open must never be real.
  for (const name of ['osascript', 'mv', 'ditto', 'open']) {
    stubExecutable(box.bin, name, recorder(name))
  }
  // Why: fail closed; a real osascript or mv here would quit or trash the owner's installed Orca.
  for (const name of ['osascript', 'mv', 'ditto', 'open', 'codesign', 'security']) {
    const resolved = await run('/bin/sh', ['-c', `command -v ${name}`], { env: box.env })
    if (resolved.stdout.trim() !== join(box.bin, name)) {
      throw new Error(
        `Refusing to run install tests: ${name} resolves to ${resolved.stdout.trim()}`
      )
    }
  }
  return {
    ...box,
    app: join(repo, 'dist', `mac-${arch}`, 'Orca.app'),
    script: join(copiedScripts, 'package-and-install.sh'),
    cwd: repo
  }
}

function install(fixture, args = [], extraEnv = {}) {
  return run('bash', [fixture.script, ...args], {
    cwd: fixture.cwd,
    env: { ...fixture.env, ...extraEnv }
  })
}

function callLog(fixture) {
  return existsSync(fixture.calls)
    ? readFileSync(fixture.calls, 'utf8').split('\n').filter(Boolean)
    : []
}

describe('package-and-install.sh build, sign and verify', () => {
  mac('packages with the local version, signs with the stable identity and verifies', async () => {
    const f = await installSandbox()
    const result = await install(f)
    passed(result)
    expect(callLog(f)).toEqual([
      'pnpm run --silent ensure:electron-runtime',
      'pnpm build',
      `pnpm exec electron-builder --config config/electron-builder.config.cjs --mac --dir --${arch}`,
      `builder commit=${identity.commit} version=${identity.version}`,
      'security find-identity -p codesigning',
      `codesign --force --deep --sign ${defaultSigner} --entitlements resources/build/entitlements.mac.plist ${f.app}`,
      `codesign --verify --deep ${f.app}`,
      `defaults read ${f.app}/Contents/Info.plist CFBundleShortVersionString`,
      `codesign -d -r- ${f.app}`
    ])
    expect(result.stdout).toContain(`[package] ${f.app}`)
    expect(result.stdout).toContain(`[package] version ${identity.version}`)
    expect(result.stdout).toContain(`signing identity present: ${defaultSigner}`)
  })

  mac('never touches /Applications without --install', async () => {
    const f = await installSandbox()
    passed(await install(f))
    const touched = callLog(f).filter((line) => /^(osascript|mv|ditto|open) /.test(line))
    expect(touched).toEqual([])
  })

  mac('signs with ORCA_LOCAL_SIGN_IDENTITY when it is set', async () => {
    const f = await installSandbox({
      ORCA_LOCAL_SIGN_IDENTITY: 'Fork Signer',
      LISTED_IDENTITY: 'Fork Signer'
    })
    passed(await install(f))
    const signing = callLog(f).find((line) => line.startsWith('codesign --force'))
    expect(signing).toContain('--sign Fork Signer --entitlements')
  })

  mac('never signs ad-hoc', async () => {
    const f = await installSandbox()
    passed(await install(f))
    const signing = callLog(f).filter((line) => line.startsWith('codesign --force'))
    expect(signing).toHaveLength(1)
    expect(signing[0]).not.toMatch(/--sign -(?:\s|$)/)
  })

  mac('stops with the build log tail when pnpm build fails', async () => {
    const f = await installSandbox({ FAIL_BUILD: '1' })
    const result = await install(f)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('build exploded')
    expect(callLog(f).some((line) => line.includes('electron-builder'))).toBe(false)
    expect(callLog(f).some((line) => line.startsWith('codesign'))).toBe(false)
  })

  mac('stops before signing when electron-builder fails', async () => {
    const f = await installSandbox({ FAIL_PACK: '1' })
    const result = await install(f, ['--install'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('pack exploded')
    expect(callLog(f).some((line) => /^(codesign|osascript|mv|ditto) /.test(line))).toBe(false)
  })
})

describe('package-and-install.sh --install', () => {
  mac('quits Orca, swaps the app bundle and relaunches when it is not running', async () => {
    const f = await installSandbox()
    const result = await install(f, ['--install'])
    passed(result)
    const swap = callLog(f).filter((line) => /^(osascript|mv|ditto|open) /.test(line))
    const backup = /^mv \/Applications\/Orca\.app .+\/\.Trash\/Orca-prev-\d{8}-\d{6}\.app$/
    expect(swap[0]).toBe('osascript -e tell application "Orca" to quit')
    expect(swap.filter((line) => line.startsWith('mv '))).toHaveLength(
      existsSync('/Applications/Orca.app') ? 1 : 0
    )
    for (const line of swap.filter((entry) => entry.startsWith('mv '))) {
      expect(line).toMatch(backup)
      expect(line).toContain(`${f.home}/.Trash/`)
    }
    expect(swap.slice(-2)).toEqual([
      `ditto ${f.app} /Applications/Orca.app`,
      'open -g /Applications/Orca.app'
    ])
    expect(result.stdout).toContain(`[install] installed ${identity.version}`)
    expect(result.stdout).toContain('[install] Orca not running yet')
    expect(result.stderr).not.toContain('WARNING')
  })

  mac('warns on stderr when the previous Orca process is still alive', async () => {
    const f = await installSandbox({ PGREP_PID: String(process.pid) })
    const result = await install(f, ['--install'])
    passed(result)
    expect(result.stderr).toContain(`WARNING: Orca (pid ${process.pid}) did not quit`)
    expect(result.stderr).toContain('Ask the user to quit Orca (Cmd+Q')
    expect(result.stdout).not.toContain('WARNING')
  })

  mac('neither warns nor relaunches when the previous Orca process has exited', async () => {
    const f = await installSandbox({ PGREP_PID: deadPid })
    const result = await install(f, ['--install'])
    passed(result)
    expect(result.stderr).not.toContain('WARNING')
    expect(callLog(f).some((line) => line.startsWith('open '))).toBe(false)
  })
})

// Why: ensure-signing-identity.sh talks to the login keychain, so security and openssl are stubs.
const opensslStub = `echo "openssl $*" >> "$CALLS"
out=; keyout=; config=
while [ $# -gt 0 ]; do
  case "$1" in -out) out="$2" ;; -keyout) keyout="$2" ;; -config) config="$2" ;; esac
  shift
done
if [ -n "$config" ]; then cp "$config" "$CALLS.config"; fi
if [ -n "$keyout" ]; then echo key > "$keyout"; fi
if [ -n "$out" ]; then echo data > "$out"; fi`

const randomPassword = '0123456789abcdef0123456789abcdef'

async function signingSandbox({ listed, extraEnv = {} }) {
  const box = sandbox(extraEnv)
  stubExecutable(
    box.bin,
    'security',
    `${recorder('security')}\nif [ "$1" = find-identity ]; then echo '${listed}'; fi`
  )
  stubExecutable(
    box.bin,
    'openssl',
    `if [ "$1" = rand ]; then echo ${randomPassword}; exit 0; fi\n${opensslStub}`
  )
  return box
}

function ensureIdentity(box) {
  return run('bash', [join(scripts, 'ensure-signing-identity.sh')], { env: box.env })
}

describe('ensure-signing-identity.sh', () => {
  unix('reports the identity as present without creating one', async () => {
    const box = await signingSandbox({ listed: `  1) ABCDEF "${defaultSigner}"` })
    const result = await ensureIdentity(box)
    passed(result)
    expect(result.stdout.trim()).toBe(`signing identity present: ${defaultSigner}`)
    expect(readFileSync(box.calls, 'utf8')).toBe('security find-identity -p codesigning\n')
  })

  unix('creates and imports an identity when only a similarly named one exists', async () => {
    const box = await signingSandbox({ listed: `  1) ABCDEF "${defaultSigner} Old"` })
    const result = await ensureIdentity(box)
    passed(result)
    expect(result.stdout).toContain(`created signing identity: ${defaultSigner}`)
    const calls = readFileSync(box.calls, 'utf8')
    const keychain = join(box.home, 'Library/Keychains/login.keychain-db')
    expect(calls).toContain(`security import `)
    expect(calls).toContain(`-k ${keychain} -P ${randomPassword} -T /usr/bin/codesign`)
    expect(calls).toContain('-passout env:P12PASS')
    const config = readFileSync(`${box.calls}.config`, 'utf8')
    expect(config).toContain(`CN = ${defaultSigner}`)
    expect(config).toContain('extendedKeyUsage = critical,codeSigning')
    expect(config).toContain('basicConstraints = critical,CA:false')
  })

  unix('creates the identity named by ORCA_LOCAL_SIGN_IDENTITY', async () => {
    const box = await signingSandbox({
      listed: `  1) ABCDEF "${defaultSigner}"`,
      extraEnv: { ORCA_LOCAL_SIGN_IDENTITY: 'Fork Signer' }
    })
    const result = await ensureIdentity(box)
    passed(result)
    expect(result.stdout).toContain('created signing identity: Fork Signer')
    expect(readFileSync(`${box.calls}.config`, 'utf8')).toContain('CN = Fork Signer')
  })

  unix('never prints the p12 password and deletes the key material', async () => {
    const box = await signingSandbox({ listed: '' })
    const result = await ensureIdentity(box)
    passed(result)
    expect(result.stdout + result.stderr).not.toContain(randomPassword)
    const workDirs = readdirSync(box.tmp).filter((name) => name.startsWith('orca-signing.'))
    expect(workDirs).toHaveLength(1)
    const kept = readdirSync(join(box.tmp, workDirs[0]))
    expect(kept).not.toContain('key.pem')
    expect(kept).not.toContain('id.p12')
  })
})

// Why: packaged-proof.sh launches a real app binary, so a stub that records and then idles stands in.
const appStub = `port=
for arg in "$@"; do case "$arg" in --remote-debugging-port=*) port="\${arg#*=}" ;; esac; done
{
  echo "pid=$$"
  echo "port=$port"
  echo "args=$*"
  echo "home=$HOME"
  echo "background=$ORCA_BACKGROUND_LAUNCH"
  echo "userdata=$ORCA_E2E_USER_DATA_DIR"
  echo "e2ehome=$ORCA_E2E_HOME_DIR"
} > "$APP_RECORD"
exec /bin/sleep 300`

const shotNodeStub = `if [ "$1" = -p ]; then echo 24; exit 0; fi
for _ in $(seq 100); do [ -e "$APP_RECORD" ] && break; /bin/sleep 0.1; done
echo "node $*" >> "$CALLS"
exit "$SHOT_EXIT"`

async function proofSandbox(shotExit = '0') {
  const box = sandbox({ SHOT_EXIT: shotExit })
  const record = join(box.dir, 'app-record')
  const macos = join(box.dir, 'Orca.app/Contents/MacOS')
  mkdirSync(macos, { recursive: true })
  stubExecutable(box.bin, 'node', shotNodeStub)
  stubExecutable(box.bin, 'pnpm', 'exit 0')
  stubExecutable(macos, 'Orca', appStub)
  return {
    ...box,
    env: { ...box.env, APP_RECORD: record },
    record,
    app: join(box.dir, 'Orca.app'),
    out: join(box.dir, 'shot.png')
  }
}

function recordField(box, name) {
  return readFileSync(box.record, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]
}

async function expectProcessGone(pid) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  expect.fail(`process ${pid} is still running`)
}

describe('packaged-proof.sh', () => {
  unix('launches the app hidden with a throwaway profile and a random CDP port', async () => {
    const box = await proofSandbox()
    const result = await run(
      'bash',
      [
        join(scripts, 'packaged-proof.sh'),
        box.app,
        box.out,
        '--wait-for',
        '#ready',
        '--keep-overlays'
      ],
      { env: box.env }
    )
    passed(result)
    const port = Number(recordField(box, 'port'))
    expect(port).toBeGreaterThanOrEqual(20000)
    expect(port).toBeLessThan(40000)
    expect(recordField(box, 'args')).toBe(
      `--password-store=basic --use-mock-keychain --remote-debugging-port=${port}`
    )
    const profile = recordField(box, 'userdata')
    expect(profile.startsWith(join(box.tmp, 'orca-packaged-proof.'))).toBe(true)
    expect(recordField(box, 'e2ehome')).toBe(`${profile}/home`)
    expect(recordField(box, 'home')).toBe(`${profile}/home`)
    expect(recordField(box, 'background')).toBe('1')
    expect(readFileSync(box.calls, 'utf8')).toBe(
      `node ${join(scripts, 'packaged-shot.mjs')} --port ${port} --out ${box.out} --wait-for #ready --keep-overlays\n`
    )
  })

  unix('stops the app process once the screenshot step succeeds', async () => {
    const box = await proofSandbox()
    passed(
      await run('bash', [join(scripts, 'packaged-proof.sh'), box.app, box.out], { env: box.env })
    )
    await expectProcessGone(Number(recordField(box, 'pid')))
  })

  unix(
    'stops the app process and keeps the exit status when the screenshot step fails',
    async () => {
      const box = await proofSandbox('3')
      const result = await run('bash', [join(scripts, 'packaged-proof.sh'), box.app, box.out], {
        env: box.env
      })
      expect(result.code).toBe(3)
      await expectProcessGone(Number(recordField(box, 'pid')))
    }
  )

  unix.each([
    [[], 'path to Orca.app'],
    [['Orca.app'], 'output png']
  ])('requires the app and output arguments: %j', async (args, message) => {
    const box = await proofSandbox()
    const result = await run('bash', [join(scripts, 'packaged-proof.sh'), ...args], {
      env: box.env
    })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain(message)
    expect(existsSync(box.record)).toBe(false)
  })
})
