import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'

vi.mock('@/i18n/i18n', () => ({
  i18n: { language: 'en' },
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    Object.entries(values ?? {}).reduce(
      (text, [key, value]) => text.replace(`{{${key}}}`, value),
      fallback
    )
}))
vi.mock('@/lib/agent-catalog', () => ({ AgentIcon: () => null }))
vi.mock('@/hooks/useResetCountdownClock', () => ({ useResetCountdownClock: () => 0 }))
vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { usagePercentageDisplay: 'used' }) => unknown) =>
    selector({ usagePercentageDisplay: 'used' })
}))

import { ProviderSegment } from './StatusBarProviderSegment'
import { UsageRow } from './UsageRosterPanel'
import { getUsageRosterRowState } from './usage-roster-row-state'
import { getCreditOnlyUsageSummary } from './usage-credit-summary'
import { getVisibleUsageProvider } from './status-bar-provider-visibility'

type SpendFields = {
  balance?: number | null
  spent?: number | null
  spendLimit?: number | null
  spentPercent?: number | null
}

function claudeCredits(spend: SpendFields = {}): ProviderRateLimits {
  return {
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
      resetsAt: null,
      ...spend
    },
    updatedAt: Date.now(),
    error: null,
    status: 'ok'
  }
}

describe('getCreditOnlyUsageSummary', () => {
  it('shows spend against the limit when the plan reports a cap', () => {
    expect(getCreditOnlyUsageSummary(claudeCredits())).toEqual({
      text: '$19.60 / $1,000',
      spentPercent: 1.96
    })
  })

  it('falls back to the balance when no cap is reported', () => {
    expect(
      getCreditOnlyUsageSummary(
        claudeCredits({ spent: null, spendLimit: null, spentPercent: null })
      )
    ).toEqual({ text: '$980.40 bal', spentPercent: null })
  })

  it('leaves providers with usage windows to the window meters', () => {
    const withSession: ProviderRateLimits = {
      ...claudeCredits(),
      session: { usedPercent: 10, windowMinutes: 300, resetsAt: null, resetDescription: null }
    }
    expect(getCreditOnlyUsageSummary(withSession)).toBeNull()
  })

  it('has nothing to show without spend or balance', () => {
    expect(
      getCreditOnlyUsageSummary(
        claudeCredits({ balance: null, spent: null, spendLimit: null, spentPercent: null })
      )
    ).toBeNull()
  })
})

describe('credit-only usage in the status bar', () => {
  it('renders the spend in the footer chip', () => {
    const markup = renderToStaticMarkup(
      <ProviderSegment p={claudeCredits()} compact={false} display="used" />
    )
    expect(markup).toContain('$19.60 / $1,000')
    expect(markup).toContain('data-usage-bar')
  })

  it('keeps the spend visible while a refresh is in flight', () => {
    const refreshing: ProviderRateLimits = { ...claudeCredits(), status: 'fetching' }
    expect(getVisibleUsageProvider('claude', refreshing, {})).toBe(refreshing)
    expect(
      renderToStaticMarkup(<ProviderSegment p={refreshing} compact={false} display="used" />)
    ).toContain('$19.60 / $1,000')
  })

  it('replaces "No usage data" with the spend in the usage popover row', () => {
    const p = claudeCredits()
    const state = getUsageRosterRowState(p, getCreditOnlyUsageSummary(p) !== null)
    const markup = renderToStaticMarkup(
      <UsageRow p={p} display="used" state={state} showSignInAction={false} now={0} />
    )
    expect(markup).not.toContain('No usage data')
    expect(markup).toContain('$19.60 / $1,000')
    expect(markup).toContain('credits')
    expect(markup).toContain('2%')
  })
})
