import { translate } from '@/i18n/i18n'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { formatCreditCount } from '../../../../shared/credit-count-format'
import { formatCurrencyAmount } from '../../../../shared/currency-format'

export type UsageCreditSummary = {
  text: string
  /** Share of the spend limit used, when the plan reports a cap. */
  spentPercent: number | null
}

export function hasUsageWindowData(p: ProviderRateLimits): boolean {
  return Boolean(p.session || p.weekly || p.fableWeekly || p.monthly || p.buckets?.length)
}

export function formatCompactExtraUsage(balance: ProviderRateLimits['extraUsage']): string {
  if (!balance) {
    return ''
  }
  if (balance.unit === 'credits') {
    return balance.unlimited
      ? translate('auto.components.status.bar.StatusBar.4025a6f62f', 'Unlimited')
      : translate('auto.components.status.bar.StatusBar.a95969101f', '{{value0}} credits', {
          value0: formatCreditCount(balance.balance)
        })
  }
  return balance.balance === null
    ? ''
    : translate('auto.components.status.bar.StatusBar.4fba7dc1e7', '{{value0}} bal', {
        value0: formatCurrencyAmount(balance.balance, balance.currencyCode)
      })
}

/**
 * Why: spend-billed plans (Claude Enterprise usage credits) report no 5h/weekly
 * windows, so their spend is the only meter the footer can show.
 */
export function getCreditOnlyUsageSummary(p: ProviderRateLimits): UsageCreditSummary | null {
  const balance = p.extraUsage
  if (!balance || hasUsageWindowData(p)) {
    return null
  }
  if (
    balance.unit === 'currency' &&
    balance.spent !== null &&
    balance.spendLimit !== null &&
    balance.spendLimit > 0
  ) {
    const options = { dropWholeCents: true }
    return {
      text: translate(
        'components.status.bar.usageCreditSummary.spentOfLimit',
        '{{spent}} / {{limit}}',
        {
          spent: formatCurrencyAmount(balance.spent, balance.currencyCode, options),
          limit: formatCurrencyAmount(balance.spendLimit, balance.currencyCode, options)
        }
      ),
      spentPercent: balance.spentPercent
    }
  }
  const text = formatCompactExtraUsage(balance)
  return text ? { text, spentPercent: null } : null
}
