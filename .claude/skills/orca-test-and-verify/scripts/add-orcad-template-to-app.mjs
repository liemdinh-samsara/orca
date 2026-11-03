// Adds the locally built orcad template to a packaged Orca.app, signs its Mach-O files, reseals
// its manifest and verifies the shipped bytes for the targets it carries.
//   node add-orcad-template-to-app.mjs <Orca.app> <templateDir> <signIdentity> <target,target>
// Why after electron-builder: its afterPack verifies the full release matrix, which includes
// Windows and musl slots a Mac cannot build.
import { execFileSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const [appPath, templateDir, identity, targetList] = process.argv.slice(2)
const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(import.meta.url)
const {
  ORCAD_TEMPLATE_RESOURCE_DIR,
  findOrcadTemplateMachOFiles,
  resealOrcadTemplateManifest
} = require(join(repo, 'config/scripts/packaged-orcad-template.cjs'))
const { verifyPackagedOrcadTemplate } = require(
  join(repo, 'config/scripts/verify-packaged-orcad-template.cjs')
)

const resources = join(appPath, 'Contents', 'Resources')
const destination = join(resources, ORCAD_TEMPLATE_RESOURCE_DIR)
rmSync(destination, { recursive: true, force: true })
cpSync(templateDir, destination, { recursive: true, verbatimSymlinks: true })
const machO = findOrcadTemplateMachOFiles(destination)
for (const path of machO) {
  execFileSync('codesign', ['--force', '--sign', identity, join(destination, ...path.split('/'))], {
    stdio: 'ignore'
  })
}
resealOrcadTemplateManifest(destination, machO)
verifyPackagedOrcadTemplate(resources, targetList.split(','))
console.log(`[orcad] added server template (${targetList}) to ${appPath}`)
