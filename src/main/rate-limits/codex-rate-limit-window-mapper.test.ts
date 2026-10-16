import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CODEX_MONTHLY_WINDOW_MINUTES,
  type CodexIndividualLimitSnapshot
} from './codex-rate-limit-window-classification'
import { mapCodexIndividualLimit, mapCodexRateLimitWindow } from './codex-rate-limit-window-mapper'

describe('mapCodexIndividualLimit', () => {
  it.each([null, undefined, {}])('returns null for absent or empty input %s', (raw) => {
    expect(mapCodexIndividualLimit(raw)).toBeNull()
  })

  it.each([
    { limit: 75000, used: 1500.5 },
    { limit: '75000', used: '1500.5' }
  ])('accepts numeric amounts $limit and $used before remainingPercent', (amounts) => {
    const result = mapCodexIndividualLimit({ ...amounts, remainingPercent: 90 })
    expect(result?.usedPercent).toBeCloseTo((1500.5 / 75000) * 100)
    expect(result?.windowMinutes).toBe(CODEX_MONTHLY_WINDOW_MINUTES)
    expect(result?.windowMinutes).toBe(43_200)
  })

  describe.each(['limit', 'used', 'remainingPercent'] as const)('%s parsing', (field) => {
    it.each(['', '   ', Number.NaN, 'n/a', null, undefined, true, {}, Number.POSITIVE_INFINITY])(
      'rejects unparseable value %s',
      (value) => {
        const raw: CodexIndividualLimitSnapshot =
          field === 'remainingPercent'
            ? { remainingPercent: value }
            : { limit: 75000, used: 1500, [field]: value }
        expect(mapCodexIndividualLimit(raw)).toBeNull()
      }
    )
  })

  it.each([
    { limit: 0, used: 1500, remainingPercent: 98 },
    { limit: -75000, used: 1500, remainingPercent: 98 },
    { limit: 75000, used: null, remainingPercent: 98 },
    { limit: 75000, remainingPercent: 98 },
    { remainingPercent: '98' }
  ])('falls back to remainingPercent for %j', (raw) => {
    expect(mapCodexIndividualLimit(raw)?.usedPercent).toBe(2)
  })

  it.each([
    { limit: 'n/a', used: null, remainingPercent: 'n/a' },
    { limit: 0, used: 1500 },
    { limit: 75000, used: null }
  ])('omits the monthly window when neither source is usable: %j', (raw) => {
    expect(mapCodexIndividualLimit(raw)).toBeNull()
  })

  it.each([
    { raw: { limit: 75000, used: 80000 }, expected: 100 },
    { raw: { limit: 75000, used: -10 }, expected: 0 },
    { raw: { remainingPercent: 120 }, expected: 0 },
    { raw: { remainingPercent: -5 }, expected: 100 }
  ])('clamps monthly consumption for $raw to $expected', ({ raw, expected }) => {
    expect(mapCodexIndividualLimit(raw)?.usedPercent).toBe(expected)
  })
})

describe('mapCodexRateLimitWindow', () => {
  it.each([
    { usedPercent: -5, expected: 0 },
    { usedPercent: 30, expected: 30 },
    { usedPercent: 120, expected: 100 }
  ])('clamps $usedPercent to $expected and overrides the reported duration', (testCase) => {
    expect(
      mapCodexRateLimitWindow({ usedPercent: testCase.usedPercent, windowDurationMins: 299 }, 300)
    ).toMatchObject({ usedPercent: testCase.expected, windowMinutes: 300 })
  })
})

describe.each([
  {
    name: 'monthly',
    map: (resetsAt: unknown) => mapCodexIndividualLimit({ limit: 75000, used: 1500, resetsAt })
  },
  {
    name: 'session',
    map: (resetsAt: unknown) => mapCodexRateLimitWindow({ usedPercent: 20, resetsAt }, 300)
  },
  {
    name: 'weekly',
    map: (resetsAt: unknown) => mapCodexRateLimitWindow({ usedPercent: 5, resetsAt }, 10080)
  }
])('$name reset mapping', ({ map }) => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 15, 9, 0))
  })

  afterEach(() => vi.useRealTimers())

  it.each([undefined, null, 0, -1, Number.NaN, '1793491200', Number.POSITIVE_INFINITY, 1e20])(
    'leaves both reset fields null for invalid seconds %s',
    (resetsAt) => {
      expect(map(resetsAt)).toMatchObject({ resetsAt: null, resetDescription: null })
    }
  )

  it('converts seconds to milliseconds with a time-only description for today', () => {
    const reset = new Date(2026, 9, 15, 17, 30)
    expect(map(reset.getTime() / 1000)).toMatchObject({
      resetsAt: reset.getTime(),
      resetDescription: reset.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    })
  })

  it('includes the weekday and time when the reset is on another day', () => {
    const reset = new Date(2026, 9, 16, 17, 30)
    expect(map(reset.getTime() / 1000)).toMatchObject({
      resetsAt: reset.getTime(),
      resetDescription: reset.toLocaleDateString(undefined, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit'
      })
    })
  })
})
