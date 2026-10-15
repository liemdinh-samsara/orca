import type { RateLimitWindow } from '../../shared/rate-limit-types'
import {
  CODEX_MONTHLY_WINDOW_MINUTES,
  type CodexIndividualLimitSnapshot,
  type CodexRateWindowSnapshot
} from './codex-rate-limit-window-classification'

function mapCodexReset(
  resetsAtSeconds: unknown
): Pick<RateLimitWindow, 'resetsAt' | 'resetDescription'> {
  if (
    typeof resetsAtSeconds !== 'number' ||
    !Number.isFinite(resetsAtSeconds) ||
    resetsAtSeconds <= 0
  ) {
    return { resetsAt: null, resetDescription: null }
  }
  // Why: Codex returns resetsAt as Unix seconds, not milliseconds.
  const date = new Date(resetsAtSeconds * 1000)
  if (Number.isNaN(date.getTime())) {
    return { resetsAt: null, resetDescription: null }
  }
  const isToday = date.toDateString() === new Date().toDateString()
  return {
    resetsAt: date.getTime(),
    resetDescription: isToday
      ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : date.toLocaleDateString(undefined, {
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit'
        })
  }
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function mapCodexRateLimitWindow(
  raw: CodexRateWindowSnapshot | null | undefined,
  expectedWindowMinutes: number
): RateLimitWindow | null {
  if (!raw || typeof raw.usedPercent !== 'number' || !Number.isFinite(raw.usedPercent)) {
    return null
  }
  return {
    usedPercent: clampPercent(raw.usedPercent),
    // Why: older app-server builds can report canonical bucket lengths off by one minute.
    windowMinutes: expectedWindowMinutes,
    ...mapCodexReset(raw.resetsAt)
  }
}

function parseCreditAmount(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

// Why: Business/Enterprise members are metered by a monthly credit limit instead of 5h/weekly windows.
export function mapCodexIndividualLimit(
  raw: CodexIndividualLimitSnapshot | null | undefined
): RateLimitWindow | null {
  if (!raw) {
    return null
  }
  const limit = parseCreditAmount(raw.limit)
  const used = parseCreditAmount(raw.used)
  const remainingPercent = parseCreditAmount(raw.remainingPercent)
  const usedPercent =
    limit !== null && limit > 0 && used !== null
      ? (used / limit) * 100
      : remainingPercent !== null
        ? 100 - remainingPercent
        : null
  if (usedPercent === null) {
    return null
  }
  return {
    usedPercent: clampPercent(usedPercent),
    windowMinutes: CODEX_MONTHLY_WINDOW_MINUTES,
    ...mapCodexReset(raw.resetsAt)
  }
}
