// Connects to a hidden Orca renderer over CDP, optionally waits for a selector, and screenshots it.
// Usage: node packaged-shot.mjs --port <n> --out <png> [--wait-for <css>] [--timeout <ms>]
//          [--report-js <async expression>] [--keep-overlays]
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const port = opt('port')
const out = opt('out')
const waitFor = opt('wait-for')
const timeoutMs = Number(opt('timeout', '45000'))
const reportJs = opt('report-js')
const keepOverlays = args.includes('--keep-overlays')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let browser
for (let i = 0; i < 60 && !browser; i++) {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null)
  if (!browser) {
    await sleep(1000)
  }
}
if (!browser) {
  console.error('CDP connect failed')
  process.exit(1)
}
let page
for (let i = 0; i < 30 && !page; i++) {
  page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => !candidate.url().startsWith('devtools'))
  if (!page) {
    await sleep(1000)
  }
}
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(5000)

let found = null
if (waitFor) {
  const deadline = Date.now() + timeoutMs
  found = false
  while (Date.now() < deadline && !found) {
    found = await page.evaluate((selector) => !!document.querySelector(selector), waitFor)
    if (!found) {
      await page.waitForTimeout(1000)
    }
  }
}
const report = reportJs
  ? await page.evaluate(`(async () => (${reportJs}))()`).catch((error) => String(error))
  : null
if (!keepOverlays) {
  // Why: a hidden window ignores clicks and Escape, so onboarding dialogs and toasts can't be dismissed.
  await page.addStyleTag({
    content:
      '[data-sonner-toaster], [role="dialog"], [data-slot="dialog-overlay"], .fixed.inset-0 { display: none !important }'
  })
  await page.waitForTimeout(800)
}
await page.screenshot({ path: out })
console.log(JSON.stringify({ out, waitFor, found, report }))
await browser.close()
process.exit(0)
