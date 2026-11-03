// Copies one orcad node-pty slot between prebuild dirs and merges its manifest entry.
//   node orcad-slot-cache.mjs <fromDir> <toDir> <slot>
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [fromDir, toDir, slot] = process.argv.slice(2)
const from = JSON.parse(readFileSync(join(fromDir, 'manifest.json'), 'utf8'))
const entry = from.slots?.[slot]
if (!entry) {
  throw new Error(`${fromDir} has no ${slot} slot`)
}
const toManifest = join(toDir, 'manifest.json')
const to = existsSync(toManifest)
  ? JSON.parse(readFileSync(toManifest, 'utf8'))
  : { ...from, slots: {} }
for (const key of ['schemaVersion', 'module', 'version', 'napi', 'nodeHeaders']) {
  if (to[key] !== from[key]) {
    throw new Error(`${slot}: ${key} ${from[key]} does not match ${to[key]} in ${toDir}`)
  }
}
mkdirSync(toDir, { recursive: true })
cpSync(join(fromDir, slot), join(toDir, slot), { recursive: true })
to.slots = Object.fromEntries(
  Object.entries({ ...to.slots, [slot]: entry }).sort(([a], [b]) => a.localeCompare(b))
)
writeFileSync(toManifest, `${JSON.stringify(to, null, 2)}\n`)
