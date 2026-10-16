import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The weekly sync agent follows these files literally, so a renamed script or subcommand
// would only surface as a failed unattended run.
const root = resolve(import.meta.dirname, '../..')
const skillDir = join(root, '.claude/skills/fork-upstream-sync')
const skillDocs = [
  'SKILL.md',
  ...readdirSync(join(skillDir, 'references')).map((f) => `references/${f}`)
]
const docText = skillDocs.map((file) => readFileSync(join(skillDir, file), 'utf8')).join('\n')

function subcommandsUsed(script) {
  const pattern = new RegExp(`${script.replace('.', '\\.')}\\s+([a-z][a-z-]*)`, 'g')
  return [...new Set([...docText.matchAll(pattern)].map((match) => match[1]))]
}

describe('fork-upstream-sync skill', () => {
  it('has front matter naming the skill after its directory', () => {
    const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    expect(skill).toMatch(/^---\nname: fork-upstream-sync\ndescription: .+\n---\n/)
  })

  it('references only repo files that exist', () => {
    const paths = new Set(
      [
        ...docText.matchAll(
          /(?:^|[\s`(])((?:\.claude|config|tests|mobile)\/[\w./-]+\.(?:mjs|sh|py|ts|json|md))/gm
        )
      ].map((match) => match[1])
    )
    expect(paths.size).toBeGreaterThan(5)
    const missing = [...paths].filter((path) => !existsSync(join(root, path)))
    expect(missing).toEqual([])
  })

  it('links every reference and asset it mentions', () => {
    const local = [...docText.matchAll(/`((?:references|assets)\/[\w.-]+)`/g)].map(
      (match) => match[1]
    )
    expect(local.length).toBeGreaterThan(0)
    expect(local.filter((file) => !existsSync(join(skillDir, file)))).toEqual([])
  })

  it('only calls fork-upstream-sync.mjs subcommands the script implements', () => {
    const source = readFileSync(join(root, 'config/scripts/fork-upstream-sync.mjs'), 'utf8')
    const used = subcommandsUsed('fork-upstream-sync.mjs')
    expect(used).toEqual(expect.arrayContaining(['start', 'summary', 'pr-body', 'publish']))
    for (const command of used) {
      expect(source).toMatch(new RegExp(`['"]?${command}['"]?: \\{`))
    }
  })

  it('only calls fork-contract.mjs subcommands the CLI accepts', () => {
    const source = readFileSync(join(root, 'config/scripts/fork-contract.mjs'), 'utf8')
    const used = subcommandsUsed('fork-contract.mjs')
    expect(used).toEqual(expect.arrayContaining(['check', 'run', 'owners']))
    for (const command of used) {
      expect(source).toMatch(new RegExp(`\\b${command}: \\[`))
    }
  })

  it('never tells the agent to push main, force-push or install into /Applications', () => {
    expect(docText).not.toMatch(/git push[^\n`]*\bmain\b/)
    expect(docText).not.toMatch(/push[^\n`]*(--force|-f\b)/)
    expect(docText).not.toMatch(/package-and-install\.sh\s+--install/)
  })
})
