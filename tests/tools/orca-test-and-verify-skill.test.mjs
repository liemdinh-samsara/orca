import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanupScratch,
  copyScriptsIntoRepo,
  passed,
  png,
  root,
  run,
  sandbox,
  scratch,
  scripts,
  skill,
  stubExecutable,
  stubNode,
  unix
} from './orca-skill-script-sandbox.mjs'

const skillText = readFileSync(join(skill, 'SKILL.md'), 'utf8')
const shellScripts = readdirSync(scripts).filter((name) => name.endsWith('.sh'))

afterEach(cleanupScratch)

describe('orca-test-and-verify static contracts', () => {
  unix.each(shellScripts)('%s has valid bash syntax', async (name) => {
    passed(await run('bash', ['-n', join(scripts, name)]))
  })

  unix.each(shellScripts)('%s can be invoked directly', (name) => {
    expect(() => accessSync(join(scripts, name), constants.X_OK)).not.toThrow()
  })

  it('packaged-shot.mjs has valid Node syntax', async () => {
    passed(await run(process.execPath, ['--check', join(scripts, 'packaged-shot.mjs')]))
  })

  it('packaged-shot.mjs resolves playwright from the skill directory', () => {
    const resolveFromScript = createRequire(join(scripts, 'packaged-shot.mjs')).resolve
    expect(() => resolveFromScript('playwright')).not.toThrow()
  })

  unix('build-report.py parses on python3 from PATH', async () => {
    passed(
      await run('python3', [
        '-I',
        '-c',
        'import ast,sys; ast.parse(open(sys.argv[1]).read())',
        join(scripts, 'build-report.py')
      ])
    )
  })

  unix.skipIf(!existsSync('/usr/bin/python3'))(
    'build-report.py imports on the system Python, including macOS 3.9',
    async () => {
      passed(
        await run('/usr/bin/python3', [
          '-I',
          '-c',
          'import runpy,sys; m=runpy.run_path(sys.argv[1]); assert callable(m["figure"])',
          join(scripts, 'build-report.py')
        ])
      )
    }
  )
})

describe('SKILL.md stays in sync with the repo', () => {
  const skillPrefix = '\\.claude\\/skills\\/orca-test-and-verify\\/'
  const bundledPath = '((?:scripts|assets)\\/[\\w-]+(?:\\.[\\w-]+)*)'

  it('has front matter that names its own directory', () => {
    const front = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    expect(front).not.toBeNull()
    expect(front[1].match(/^name:\s*(.+)$/m)?.[1].trim()).toBe(basename(skill))
    expect(front[1].match(/^description:\s*(.+)$/m)?.[1].trim().length).toBeGreaterThan(0)
  })

  it('only references scripts and assets that exist', () => {
    // Why: the lookbehind skips repo paths such as config/scripts/*.mjs that live outside the skill.
    const pattern = new RegExp(`(?:${skillPrefix}|(?<![\\w./-]))${bundledPath}`, 'g')
    const references = new Set([...skillText.matchAll(pattern)].map((match) => match[1]))
    expect(references).toContain('scripts/capture-before-after.sh')
    expect(references).toContain('scripts/package-and-install.sh')
    expect(references).toContain('scripts/packaged-proof.sh')
    expect(references).toContain('scripts/build-report.py')
    expect(references).toContain('assets/proof-shots.spec.template.ts')
    for (const reference of references) {
      expect(existsSync(join(skill, reference)), reference).toBe(true)
    }
  })

  it('documents the packaged-shot flags that packaged-shot.mjs handles', () => {
    const shot = readFileSync(join(scripts, 'packaged-shot.mjs'), 'utf8')
    for (const flag of ['wait-for', 'timeout', 'report-js', 'keep-overlays']) {
      expect(skillText, flag).toContain(`--${flag}`)
      expect(shot, flag).toContain(flag)
    }
  })

  it('tells people to run pnpm scripts that exist', () => {
    const pnpmRun = /\bpnpm\s+run\s+(?:--silent\s+)?([\w:-]+)/g
    const pnpmShort = /\bpnpm\s+(tc[\w:-]*|build[\w:-]*)/g
    const sources = [skillText, ...shellScripts.map((n) => readFileSync(join(scripts, n), 'utf8'))]
    const names = sources.flatMap((text) => [
      ...[...text.matchAll(pnpmRun)].map((match) => match[1]),
      ...[...text.matchAll(pnpmShort)].map((match) => match[1])
    ])
    expect(names).toEqual(
      expect.arrayContaining([
        'tc',
        'build',
        'ensure:electron-runtime',
        'sync:localization-catalog',
        'check:code-quality:changed'
      ])
    )
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    for (const name of new Set(names)) {
      expect(pkg.scripts[name], name).toBeTypeOf('string')
    }
  })

  it.each([
    ['capture-before-after.sh', 'tests/playwright.config.ts'],
    ['package-and-install.sh', 'config/electron-builder.config.cjs'],
    ['package-and-install.sh', 'resources/build/entitlements.mac.plist'],
    ['package-and-install.sh', 'config/scripts/build-mac-local.mjs']
  ])('%s relies on %s, which exists in the repo', (script, repoFile) => {
    expect(readFileSync(join(scripts, script), 'utf8')).toContain(repoFile)
    expect(existsSync(join(root, repoFile))).toBe(true)
  })

  it('selects the electron-headless Playwright project the capture script runs', () => {
    expect(readFileSync(join(scripts, 'capture-before-after.sh'), 'utf8')).toContain(
      '--project electron-headless'
    )
    expect(readFileSync(join(root, 'tests/playwright.config.ts'), 'utf8')).toMatch(
      /name:\s*['"]electron-headless['"]/
    )
  })

  it('gets the local build identity shape that package-and-install.sh reads', async () => {
    const build = await import(pathToFileURL(join(root, 'config/scripts/build-mac-local.mjs')).href)
    const identity = build.getLocalBuildIdentity()
    expect(identity.commit).toMatch(/^[0-9a-f]{7,12}$/)
    expect(identity.version).toMatch(new RegExp(`-local\\.\\d+\\.${identity.commit}$`))
  })

  it('keeps the proof template imports available in the e2e store', () => {
    const template = readFileSync(join(skill, 'assets/proof-shots.spec.template.ts'), 'utf8')
    const imports = template.match(/import\s*\{([^}]+)\}\s*from ['"]\.\/helpers\/store['"]/)
    expect(imports).not.toBeNull()
    const names = imports[1].split(',').map((name) => name.trim())
    expect(names.length).toBeGreaterThan(0)
    const store = readFileSync(join(root, 'tests/e2e/helpers/store.ts'), 'utf8')
    for (const name of names) {
      expect(store, name).toMatch(new RegExp(`export (?:async )?function ${name}\\b`))
    }
    expect(template).toMatch(/from ['"]\.\/helpers\/orca-app['"]/)
    expect(existsSync(join(root, 'tests/e2e/helpers/orca-app.ts'))).toBe(true)
  })
})

function reportManifest(overrides = {}) {
  return {
    title: 'Orca proof',
    subtitle: 'Build under test',
    sections: [
      {
        title: 'Pane placement',
        body: '<p>Body <em>HTML</em></p>',
        before: 'pixel.png',
        beforeCaption: 'Old pane',
        after: 'pixel.png',
        afterCaption: 'New pane',
        extra: [{ src: 'pixel.png', caption: '<strong>Detail</strong>' }]
      }
    ],
    tests: [
      ['Check & result', 'Status'],
      ['Unit tests', '<b>Pass</b>']
    ],
    notes: '<p>Manual <em>notes</em></p>',
    ...overrides
  }
}

async function buildReport(manifest, args = [], python = 'python3') {
  const dir = scratch()
  writeFileSync(join(dir, 'pixel.png'), Buffer.from(png, 'base64'))
  const manifestPath = join(dir, 'manifest.json')
  const out = join(dir, 'proof.html')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  const result = await run(python, [join(scripts, 'build-report.py'), manifestPath, out, ...args])
  return { ...result, html: existsSync(out) ? readFileSync(out, 'utf8') : '', out }
}

function expectReportContent(html) {
  for (const content of [
    '<style>',
    '<main>',
    '<h1>Orca proof</h1>',
    'Build under test',
    '<h2>Pane placement</h2>',
    '<p>Body <em>HTML</em></p>',
    '<span class="tag before">Before</span>',
    '<span class="tag after">After</span>',
    '<figcaption>Old pane</figcaption>',
    '<figcaption><strong>Detail</strong></figcaption>',
    'How this was tested',
    '<tr><th>Check &amp; result</th><th>Status</th></tr>',
    '<tr><td>Unit tests</td><td><b>Pass</b></td></tr>',
    '<p>Manual <em>notes</em></p>',
    '<div class="lb" id="lb">',
    '<script>',
    "querySelectorAll('figure img')",
    "lb.addEventListener('click'"
  ]) {
    expect(html).toContain(content)
  }
  const inlined = html.match(
    new RegExp(`src="data:image/png;base64,${png.replace('+', '\\+')}"`, 'g')
  )
  expect(inlined).toHaveLength(3)
  expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=["'](?:https?:|pixel\.png)/)
}

describe('proof report generation', () => {
  unix('writes a complete self-contained document and prints its output size', async () => {
    const result = await buildReport(reportManifest())
    passed(result)
    expect(result.html.startsWith('<!doctype html>')).toBe(true)
    expect(result.html).toContain('<html lang="en"><head><meta charset="utf-8">')
    expect(result.html).toContain(
      '<meta name="viewport" content="width=device-width,initial-scale=1">'
    )
    expect(result.html).toContain('<title>Orca proof</title>')
    expect(result.html.endsWith('</body></html>')).toBe(true)
    expectReportContent(result.html)
    expect(result.stdout.trim()).toMatch(/ \(\d+ KB\)$/)
    expect(result.stdout.startsWith(result.out)).toBe(true)
  })

  unix.skipIf(!existsSync('/usr/bin/python3'))(
    'builds the full page on the system Python, including macOS 3.9',
    async () => {
      const result = await buildReport(reportManifest(), [], '/usr/bin/python3')
      passed(result)
      expectReportContent(result.html)
    }
  )

  unix('fragment keeps title, styles, content and lightbox but drops the wrapper', async () => {
    const result = await buildReport(reportManifest(), ['--fragment'])
    passed(result)
    expect(result.html.startsWith('<title>Orca proof</title><style>')).toBe(true)
    expect(result.html).not.toMatch(/<!doctype|<\/?(?:html|head|body)\b/i)
    expectReportContent(result.html)
  })

  unix('escapes titles and alt text while keeping authored body, captions and notes', async () => {
    const sections = [
      {
        ...reportManifest().sections[0],
        title: '<b>section</b>',
        beforeCaption: '<b>x</b> "&"'
      }
    ]
    const result = await buildReport(reportManifest({ title: '<b>x</b>', sections }))
    passed(result)
    expect(result.html).toContain('<title>&lt;b&gt;x&lt;/b&gt;</title>')
    expect(result.html).toContain('<h1>&lt;b&gt;x&lt;/b&gt;</h1>')
    expect(result.html).toContain('<h2>&lt;b&gt;section&lt;/b&gt;</h2>')
    expect(result.html).toContain('alt="&lt;b&gt;x&lt;/b&gt; &quot;&amp;&quot;"')
    expect(result.html).toContain('<figcaption><b>x</b> "&"</figcaption>')
    expect(result.html).toContain('<p>Body <em>HTML</em></p>')
    expect(result.html).toContain('<p>Manual <em>notes</em></p>')
    expect(result.html).not.toContain('<h1><b>')
    expect(result.html).not.toContain('<title><b>')
  })

  unix('omits the tests table and notes sections when absent', async () => {
    const { tests: _tests, notes: _notes, ...manifest } = reportManifest()
    const result = await buildReport(manifest)
    passed(result)
    expect(result.html).not.toContain('How this was tested')
    expect(result.html).not.toContain('<table>')
    expect(result.html).not.toContain('Manual')
    expect(result.html.match(/<section>/g)).toHaveLength(1)
  })

  unix('fails and names the file when a manifest image is missing', async () => {
    const section = { ...reportManifest().sections[0], before: 'missing-before.png' }
    const result = await buildReport(reportManifest({ sections: [section] }))
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('missing-before.png')
    expect(existsSync(result.out)).toBe(false)
  })

  unix.each(['title', 'sections'])('rejects a manifest without %s', async (key) => {
    const { [key]: _removed, ...manifest } = reportManifest()
    const result = await buildReport(manifest)
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain(key)
    expect(existsSync(result.out)).toBe(false)
  })
})

const homebrewCandidate = /^\s*echo \/(?:opt\/homebrew|usr\/local)\/opt\/node@24\/bin$/

// Why: env.sh hardcodes the Homebrew node@24 candidates, so a copy without them keeps a host
// Node 24 install from satisfying the "not found" cases.
async function envBox({ major = '24', pnpm = true } = {}) {
  const box = sandbox()
  const { repo, copiedScripts, git } = copyScriptsIntoRepo(box)
  await git(['init'])
  const envScript = join(copiedScripts, 'env.sh')
  const lines = readFileSync(envScript, 'utf8').split('\n')
  const kept = lines.filter((line) => !homebrewCandidate.test(line))
  expect(lines.length - kept.length).toBe(2)
  writeFileSync(envScript, kept.join('\n'))
  stubNode(box.bin, major)
  stubExecutable(box.bin, 'corepack', 'echo "corepack $*" >> "$CALLS"')
  if (pnpm) {
    stubExecutable(box.bin, 'pnpm', 'echo fake-pnpm')
  }
  return { ...box, repo, envScript }
}

function nodeCandidate(home, relativeDir, major) {
  const dir = join(home, relativeDir)
  mkdirSync(dir, { recursive: true })
  stubExecutable(dir, 'node', `echo ${major}`)
  return dir
}

const sourceThenContinue = 'source "$1" || exit $?; echo CONTINUED'
const shellsAvailable = ['bash', 'zsh'].filter((name) =>
  ['/bin', '/usr/bin'].some((dir) => existsSync(join(dir, name)))
)

describe('Node environment bootstrap', () => {
  for (const shell of shellsAvailable) {
    unix(`${shell} exports the repo, keeps Node 24 and pnpm, and continues`, async () => {
      const box = await envBox()
      // Why: printenv in a child proves ORCA_REPO is exported, not just set in the sourcing shell.
      const script =
        'source "$1" || exit $?; printf "REPO=%s\\nNODE=%s\\nPNPM=%s\\nPROMPT=%s\\nCONTINUED\\n" ' +
        '"$(printenv ORCA_REPO)" "$(node -p x)" "$(pnpm)" "$(printenv COREPACK_ENABLE_DOWNLOAD_PROMPT)"'
      const result = await run(shell, ['-c', script, shell, box.envScript], { env: box.env })
      passed(result)
      expect(result.stdout).toBe(`REPO=${box.repo}\nNODE=24\nPNPM=fake-pnpm\nPROMPT=0\nCONTINUED\n`)
      expect(existsSync(box.calls)).toBe(false)
    })

    unix(`${shell} enables pnpm through corepack when it is missing`, async () => {
      const box = await envBox({ pnpm: false })
      const result = await run(shell, ['-c', sourceThenContinue, shell, box.envScript], {
        env: box.env
      })
      passed(result)
      expect(readFileSync(box.calls, 'utf8')).toBe('corepack enable pnpm\n')
    })

    unix(`${shell} returns 1 when Node 24 cannot be found`, async () => {
      const box = await envBox({ major: '23' })
      const result = await run(shell, ['-c', sourceThenContinue, shell, box.envScript], {
        env: box.env
      })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('Node 24 not found (have v23.0.0)')
      expect(result.stdout).not.toContain('CONTINUED')
    })
  }

  unix('exits 1 with the install hint when executed, not sourced', async () => {
    const box = await envBox({ major: '23' })
    const result = await run('bash', [box.envScript], { env: box.env })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Install it to ~/.local/opt/node24 or 'nvm install 24'")
  })

  unix('prepends a working Node 24 candidate when PATH has Node 23', async () => {
    const box = await envBox({ major: '23' })
    const nodeDir = nodeCandidate(box.home, '.local/opt/node24/bin', 24)
    const script = `${sourceThenContinue}; command -v node; node -p x`
    const result = await run('bash', ['-c', script, 'bash', box.envScript], { env: box.env })
    passed(result)
    expect(result.stdout).toBe(`CONTINUED\n${join(nodeDir, 'node')}\n24\n`)
  })

  unix('finds an nvm Node 24 install', async () => {
    const box = await envBox({ major: '23' })
    const nodeDir = nodeCandidate(box.home, '.nvm/versions/node/v24.3.0/bin', 24)
    const script = `${sourceThenContinue}; command -v node`
    const result = await run('bash', ['-c', script, 'bash', box.envScript], { env: box.env })
    passed(result)
    expect(result.stdout).toBe(`CONTINUED\n${join(nodeDir, 'node')}\n`)
  })

  unix('skips a candidate whose real version is not 24 and uses the next one', async () => {
    const box = await envBox({ major: '23' })
    nodeCandidate(box.home, '.local/opt/node24/bin', 25)
    const nodeDir = nodeCandidate(box.home, '.nvm/versions/node/v24.3.0/bin', 24)
    const script = `${sourceThenContinue}; command -v node`
    const result = await run('bash', ['-c', script, 'bash', box.envScript], { env: box.env })
    passed(result)
    expect(result.stdout).toBe(`CONTINUED\n${join(nodeDir, 'node')}\n`)
  })

  unix('fails when the only candidate reports a different major', async () => {
    const box = await envBox({ major: '23' })
    nodeCandidate(box.home, '.local/opt/node24/bin', 25)
    const result = await run('bash', ['-c', sourceThenContinue, 'bash', box.envScript], {
      env: box.env
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Node 24 not found')
  })
})
