import { spawnSync } from 'node:child_process'

const rawExtraArgs = process.argv.slice(2)
const extraArgs = rawExtraArgs[0] === '--' ? rawExtraArgs.slice(1) : rawExtraArgs
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
// Why: upstream removed the relay client path (#27214); SSH hosts are now orcad-managed, so the
// Docker specs connect through a managed server built from ORCA_E2E_ORCAD_CONVERT_TEMPLATE.
const env = {
  ...process.env,
  ORCA_E2E_SSH_DOCKER: '1',
  ORCA_E2E_ORCAD_CONVERT_HOST: 'docker'
}

if (!process.env.ORCA_E2E_ORCAD_CONVERT_TEMPLATE) {
  console.warn(
    'ORCA_E2E_ORCAD_CONVERT_TEMPLATE is unset, so the managed-host specs will skip. Build one with ' +
      '`pnpm build:orcad-prebuilds && node config/scripts/build-orcad-template.mjs --targets linux-x64-glibc`.'
  )
}

// Why: Node's CVE-2024-27980 hardening rejects .cmd spawns without shell on Windows.
const spawnOptions = {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32'
}

const runtime = spawnSync(pnpm, ['run', 'ensure:electron-runtime'], spawnOptions)

if (runtime.status !== 0) {
  process.exit(runtime.status ?? 1)
}

// The fork's Docker-backed SSH specs, plus the managed browser-routing journey that carries the
// fork's Okta Verify loopback case. Upstream runs every ssh-orcad-* spec in its own CI lane.
const result = spawnSync(
  pnpm,
  [
    'exec',
    'playwright',
    'test',
    'tests/e2e/ssh-orcad-browser-routing.spec.ts',
    'tests/e2e/ssh-cross-host-workspace-nesting.spec.ts',
    'tests/e2e/ssh-project-path-prefix-setup.spec.ts',
    'tests/e2e/ssh-local-terminal-from-remote-workspace.spec.ts',
    '--config',
    'tests/playwright.config.ts',
    '--project',
    'electron-headless',
    '--workers=1',
    ...extraArgs
  ],
  spawnOptions
)

process.exit(result.status ?? 1)
