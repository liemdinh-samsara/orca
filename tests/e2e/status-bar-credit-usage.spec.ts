/**
 * Spend-billed accounts (Claude usage credits, a Codex Business monthly credit limit) report no
 * 5h/weekly windows; the status bar must still show their usage instead of "No usage data".
 */

import type { Page } from '@stablyai/playwright-test'
import type { ProviderRateLimits } from '../../src/shared/rate-limit-types'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'

const claude: ProviderRateLimits = {
  provider: 'claude',
  session: null,
  weekly: null,
  extraUsage: {
    unit: 'currency',
    balance: 980.4,
    currencyCode: 'USD',
    enabled: true,
    disabledReason: null,
    spent: 19.6,
    spendLimit: 1000,
    spentPercent: 1.96,
    resetsAt: null
  },
  updatedAt: Date.now(),
  error: null,
  status: 'ok'
}

const codex: ProviderRateLimits = {
  provider: 'codex',
  session: null,
  weekly: null,
  monthly: {
    usedPercent: 2.11,
    windowMinutes: 43_200,
    resetsAt: Date.now() + 16 * 24 * 60 * 60 * 1000,
    resetDescription: null
  },
  updatedAt: Date.now(),
  error: null,
  status: 'ok'
}

async function pushUsage(page: Page): Promise<void> {
  await page.evaluate(
    ({ claude, codex }) => {
      const state = window.__store!.getState()
      state.setRateLimitsFromPush({ ...state.rateLimits, claude, codex })
    },
    { claude, codex }
  )
}

test('shows credit-only usage in the status bar and usage popover', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await pushUsage(orcaPage)

  const footer = orcaPage.locator('.status-bar-usage-cluster')
  await expect(footer.locator('[data-usage-chip="claude"]')).toContainText('$19.60 / $1,000')
  await expect(footer.locator('[data-usage-chip="codex"]')).toContainText('2%')

  await orcaPage.getByRole('button', { name: 'Usage', exact: true }).click()
  const rows = orcaPage.locator('[role="menu"] [role="menuitem"]')
  await expect(rows.filter({ hasText: 'Claude' })).toContainText('$19.60 / $1,000')
  await expect(rows.filter({ hasText: 'Codex' })).toContainText('2%')
  await expect(orcaPage.getByText('No usage data')).toHaveCount(0)
})
