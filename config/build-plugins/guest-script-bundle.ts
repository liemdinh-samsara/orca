import { build, type Plugin, type Rollup } from 'vite'
import { GUEST_SCRIPT_GLOBAL_NAME } from '../../src/shared/guest-script-bundle'

const GUEST_SCRIPT_QUERY = '?guest-script'

function isRollupOutput(value: unknown): value is Rollup.RollupOutput {
  return typeof value === 'object' && value !== null && 'output' in value
}

/**
 * `import source from './entry.ts?guest-script'` bundles the entry and everything it imports
 * into one IIFE and imports it as a string, so main can inject it into a browser guest's
 * isolated world on demand instead of paying for it in every page's preload.
 */
export function createGuestScriptBundlePlugin(): Plugin {
  return {
    name: 'orca-guest-script-bundle',
    async load(id) {
      if (!id.endsWith(GUEST_SCRIPT_QUERY)) {
        return null
      }
      const entry = id.slice(0, -GUEST_SCRIPT_QUERY.length)
      const result = await build({
        configFile: false,
        logLevel: 'warn',
        publicDir: false,
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        build: {
          write: false,
          minify: 'oxc',
          target: 'es2022',
          lib: {
            entry,
            formats: ['iife'],
            name: GUEST_SCRIPT_GLOBAL_NAME,
            fileName: () => 'guest-script.js'
          }
        }
      })
      const outputs = (Array.isArray(result) ? result : [result]).filter(isRollupOutput)
      const chunk = outputs
        .flatMap((output) => output.output)
        .find((item): item is Rollup.OutputChunk => item.type === 'chunk')
      if (!chunk) {
        throw new Error(`Guest script bundle produced no code for ${entry}`)
      }
      for (const moduleId of chunk.moduleIds) {
        this.addWatchFile(moduleId)
      }
      return `export default ${JSON.stringify(chunk.code)}`
    }
  }
}
