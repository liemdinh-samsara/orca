import { describe, expect, it } from 'vitest'
import { formatCurrencyAmount } from './currency-format'

describe('formatCurrencyAmount', () => {
  it('formats USD amounts with the dollar symbol', () => {
    // Force a stable locale-independent expectation by asserting substrings.
    const formatted = formatCurrencyAmount(12.4, 'USD')
    expect(formatted).toMatch(/12[.,]40/)
    expect(formatted).toContain('$')
  })

  it('formats EUR amounts with the euro symbol and thousands separator', () => {
    const formatted = formatCurrencyAmount(2000, 'EUR')
    expect(formatted).toContain('€')
    expect(formatted).toMatch(/2[.,]000/)
  })

  it('falls back to code + amount for a malformed currency code', () => {
    // A non-3-letter code makes Intl.NumberFormat throw, exercising the fallback.
    expect(formatCurrencyAmount(9.5, 'ZZ')).toBe('ZZ 9.50')
  })

  it('defaults blank currency codes to USD', () => {
    expect(formatCurrencyAmount(1, '   ')).toContain('$')
  })

  it('treats non-finite amounts as zero', () => {
    expect(formatCurrencyAmount(Number.NaN, 'USD')).toMatch(/0[.,]00/)
  })

  it('drops the cents of whole amounts only when asked', () => {
    expect(formatCurrencyAmount(1000, 'USD', { dropWholeCents: true })).not.toMatch(/[.,]00$/)
    expect(formatCurrencyAmount(19.6, 'USD', { dropWholeCents: true })).toMatch(/19[.,]60/)
    expect(formatCurrencyAmount(1000, 'USD')).toMatch(/[.,]00$/)
  })

  it('drops cents from the zero used for NaN when requested', () => {
    const formatted = formatCurrencyAmount(Number.NaN, 'USD', { dropWholeCents: true })
    expect(formatted).toContain('$')
    expect(formatted.replace(/\D/g, '')).toBe('0')
    expect(formatted).not.toMatch(/[.,]00$/)
  })

  it('keeps cents in the malformed-code fallback even when dropping whole cents', () => {
    expect(formatCurrencyAmount(9, 'ZZ', { dropWholeCents: true })).toBe('ZZ 9.00')
  })

  it('leaves zero-decimal JPY unchanged when dropping whole cents', () => {
    const formatted = formatCurrencyAmount(1234, 'JPY', { dropWholeCents: true })
    expect(formatted).toBe(formatCurrencyAmount(1234, 'JPY'))
    expect(formatted).toMatch(/1[.,]234/)
    expect(formatted).not.toMatch(/[.,]00$/)
  })
})
