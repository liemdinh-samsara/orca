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

import {
  getUsageTone,
  ProviderLetterBadge,
  ProviderSegment,
  UsageOverflowChip
} from './StatusBarProviderSegment'
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

  it.each([{ spendLimit: 0 }, { spent: null }])(
    'falls back to the balance for unusable spend fields %j',
    (spend) => {
      expect(getCreditOnlyUsageSummary(claudeCredits(spend))).toEqual({
        text: '$980.40 bal',
        spentPercent: null
      })
    }
  )

  it.each([
    { unlimited: false, text: '1,234 credits' },
    { unlimited: true, text: 'Unlimited' }
  ])('shows credit-unit balances as $text', ({ unlimited, text }) => {
    const p: ProviderRateLimits = {
      ...claudeCredits(),
      extraUsage: {
        unit: 'credits',
        balance: 1234,
        unlimited,
        enabled: true,
        disabledReason: null,
        resetsAt: null
      }
    }
    expect(getCreditOnlyUsageSummary(p)).toEqual({ text, spentPercent: null })
  })

  it('returns null when extraUsage is absent', () => {
    const { extraUsage: _extraUsage, ...p } = claudeCredits()
    expect(getCreditOnlyUsageSummary(p)).toBeNull()
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

  it.each([
    { compact: true, mode: 'verbose' },
    { compact: false, mode: 'compact' }
  ] as const)('hides the spend bar with compact=$compact and mode=$mode', ({ compact, mode }) => {
    const markup = renderToStaticMarkup(
      <ProviderSegment p={claudeCredits()} compact={compact} mode={mode} display="used" />
    )
    expect(markup).toContain('$19.60 / $1,000')
    expect(markup).not.toContain('data-usage-bar')
  })

  it('keeps the spend chip with a warning icon after a failed refresh', () => {
    const stale: ProviderRateLimits = {
      ...claudeCredits(),
      status: 'error',
      error: 'temporary failure'
    }
    const markup = renderToStaticMarkup(
      <ProviderSegment p={stale} compact={false} display="used" />
    )
    expect(markup).toContain('$19.60 / $1,000')
    expect(markup).toContain('data-usage-bar')
    expect(markup).toContain('lucide-triangle-alert')
  })

  it('shows the has-data dot on the narrow credit-only provider badge', () => {
    const markup = renderToStaticMarkup(<ProviderLetterBadge p={claudeCredits()} />)
    expect(markup).toContain('bg-muted-foreground/60')
    expect(markup).not.toContain('bg-muted-foreground/30')
  })

  it.each([
    { spentPercent: 59, expected: 'normal' },
    { spentPercent: 60, expected: 'warning' },
    { spentPercent: 79, expected: 'warning' },
    { spentPercent: 80, expected: 'urgent' },
    { spentPercent: 95, expected: 'urgent' }
  ])('uses $expected tone at $spentPercent percent spend', ({ spentPercent, expected }) => {
    expect(getUsageTone(claudeCredits({ spentPercent }))).toBe(expected)
  })

  it.each([
    { spentPercent: 59.5, expected: 'warning' },
    { spentPercent: 79.5, expected: 'urgent' }
  ])('rounds spend $spentPercent before assigning $expected tone', ({ spentPercent, expected }) => {
    expect(getUsageTone(claudeCredits({ spentPercent }))).toBe(expected)
  })

  it('includes a hidden credit-only provider and its spend in the overflow title', () => {
    const markup = renderToStaticMarkup(
      <UsageOverflowChip hidden={[claudeCredits()]} display="used" />
    )
    expect(markup).toContain('title="Also: Claude $19.60 / $1,000"')
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

  it.each(['verbose', 'compact'] as const)(
    'shows a balance-only popover row without a spend bar in %s mode',
    (mode) => {
      const p = claudeCredits({ spent: null, spendLimit: null, spentPercent: null })
      const markup = renderToStaticMarkup(
        <UsageRow
          p={p}
          mode={mode}
          display="used"
          state={getUsageRosterRowState(p, true)}
          showSignInAction={false}
          now={0}
        />
      )
      expect(markup).toContain('$980.40 bal')
      expect(markup).not.toContain('No usage data')
      expect(markup).not.toContain('data-usage-bar')
    }
  )

  it('keeps capped spend text without a bar in a compact popover row', () => {
    const p = claudeCredits()
    const markup = renderToStaticMarkup(
      <UsageRow
        p={p}
        mode="compact"
        display="used"
        state={getUsageRosterRowState(p, true)}
        showSignInAction={false}
        now={0}
      />
    )
    expect(markup).toContain('$19.60 / $1,000')
    expect(markup).not.toContain('data-usage-bar')
  })
})
