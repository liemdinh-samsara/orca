/** Share localized major-unit display across usage/status surfaces; malformed provider currency codes fall back to CODE amount instead of throwing into the status bar. */
export function formatCurrencyAmount(
  amount: number,
  currencyCode: string,
  options: { dropWholeCents?: boolean } = {}
): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0
  const code = currencyCode.trim() || 'USD'
  // Why: a status-bar chip reads "$1,000" more easily than "$1,000.00".
  const wholeUnits = options.dropWholeCents === true && Number.isInteger(safeAmount)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      ...(wholeUnits ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {})
    }).format(safeAmount)
  } catch {
    return `${code} ${safeAmount.toFixed(2)}`
  }
}
