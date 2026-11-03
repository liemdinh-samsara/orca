import { describe, expect, it, vi } from 'vitest'
import {
  applyAutocomplete,
  detectAutocompleteTrigger,
  rankSlashCommandSuggestions,
  rankSuggestions
} from './mobile-native-chat-autocomplete'

describe('detectAutocompleteTrigger', () => {
  it('detects a slash at the start of the message', () => {
    expect(detectAutocompleteTrigger('/rev', 4)).toEqual({
      kind: 'slash',
      query: 'rev',
      start: 0,
      end: 4
    })
  })

  it('detects a slash after whitespace in the middle of a prompt', () => {
    expect(detectAutocompleteTrigger('fix this then /liem-', 20)).toEqual({
      kind: 'slash',
      query: 'liem-',
      start: 14,
      end: 20
    })
    expect(detectAutocompleteTrigger('line one\n/rev', 13)).toMatchObject({
      kind: 'slash',
      query: 'rev',
      start: 9
    })
    expect(detectAutocompleteTrigger('hi /', 4)).toMatchObject({ kind: 'slash', query: '' })
  })

  it('leaves file paths, URLs and fractions as prose', () => {
    expect(detectAutocompleteTrigger('open src/main', 13)).toBeNull()
    expect(detectAutocompleteTrigger('see https://a.dev/x', 19)).toBeNull()
    expect(detectAutocompleteTrigger('about 3/4 done', 9)).toBeNull()
    expect(detectAutocompleteTrigger('run /usr/bin', 12)).toBeNull()
    expect(detectAutocompleteTrigger('and/or', 6)).toBeNull()
  })

  it('closes a mid-prompt slash token once a space is typed', () => {
    expect(detectAutocompleteTrigger('fix this then /liem-x ', 22)).toBeNull()
  })

  it('detects an @ mention after whitespace or at start', () => {
    expect(detectAutocompleteTrigger('@src', 4)).toMatchObject({ kind: 'file', query: 'src' })
    expect(detectAutocompleteTrigger('look at @comp', 13)).toMatchObject({
      kind: 'file',
      query: 'comp'
    })
  })

  it('does not trigger @ mid-word (email-like)', () => {
    expect(detectAutocompleteTrigger('me@host', 7)).toBeNull()
  })

  it('closes the token once a space is typed', () => {
    expect(detectAutocompleteTrigger('@src ', 5)).toBeNull()
  })

  it('returns empty query right after the trigger char', () => {
    expect(detectAutocompleteTrigger('@', 1)).toMatchObject({ kind: 'file', query: '' })
  })
})

describe('applyAutocomplete', () => {
  it('inserts a skill mid-prompt without touching the text before it', () => {
    const trigger = detectAutocompleteTrigger('fix this then /liem-up', 22)!
    const { text, cursor } = applyAutocomplete(
      'fix this then /liem-up',
      trigger,
      '/liem-upload-report'
    )
    expect(text).toBe('fix this then /liem-upload-report ')
    expect(cursor).toBe(text.length)
  })

  it('replaces the trigger span and leaves a trailing space + cursor', () => {
    const trigger = detectAutocompleteTrigger('look at @comp', 13)!
    const { text, cursor } = applyAutocomplete('look at @comp', trigger, '@src/App.tsx')
    expect(text).toBe('look at @src/App.tsx ')
    expect(cursor).toBe(text.length)
  })
})

describe('rankSuggestions', () => {
  it('prefers prefix matches on the basename', () => {
    const out = rankSuggestions(['src/app/Main.tsx', 'src/AppBar.tsx', 'lib/zapp.ts'], 'app')
    expect(out[0]).toBe('src/AppBar.tsx')
    expect(out).toContain('lib/zapp.ts')
  })

  it('returns the head of the list for an empty query', () => {
    expect(rankSuggestions(['a', 'b', 'c'], '', 2)).toEqual(['a', 'b'])
  })
})

describe('rankSlashCommandSuggestions', () => {
  const commands = [
    { name: 'clear', description: 'Clear conversation history' },
    { name: 'compact', description: 'Summarize and compact' },
    { name: 'mcp', description: 'List MCP tools' }
  ]

  it('shows the whole catalog for a bare slash', () => {
    expect(rankSlashCommandSuggestions(commands, '').map((c) => c.name)).toEqual([
      'clear',
      'compact',
      'mcp'
    ])
  })

  it('ranks prefix matches ahead of substring matches', () => {
    expect(rankSlashCommandSuggestions(commands, 'c').map((c) => c.name)).toEqual([
      'clear',
      'compact',
      'mcp'
    ])
    expect(rankSlashCommandSuggestions(commands, 'm').map((c) => c.name)).toEqual([
      'mcp',
      'compact'
    ])
  })

  it('is case-insensitive and drops non-matches', () => {
    expect(rankSlashCommandSuggestions(commands, 'CLE').map((c) => c.name)).toEqual(['clear'])
    expect(rankSlashCommandSuggestions(commands, 'zzz')).toEqual([])
  })

  it('preserves command identity and metadata for duplicate names', () => {
    const catalog = [
      { name: 'team-review', description: 'First' },
      { name: 'team-review', argumentHint: '<branch>' },
      { name: 'review', kindUnspecified: true as const }
    ]
    const result = rankSlashCommandSuggestions(catalog, 'review', 3)
    expect(result[0]).toBe(catalog[2])
    expect(result[1]).toBe(catalog[0])
    expect(result[2]).toBe(catalog[1])
  })
})

describe.each([
  { name: 'file', rank: rankSuggestions },
  {
    name: 'slash',
    rank: (names: readonly string[], query: string, limit: number): string[] =>
      rankSlashCommandSuggestions(
        names.map((name) => ({ name })),
        query,
        limit
      ).map((command) => command.name)
  }
])('$name suggestion bounds', ({ rank }) => {
  it('keeps later prefixes ahead of the earliest substring matches', () => {
    const candidates = ['team-review', 'team-review', 'pre-review', 'review-a', 'REVIEW-b']
    expect(rank(candidates, 'REVIEW', 4)).toEqual([
      'review-a',
      'REVIEW-b',
      'team-review',
      'team-review'
    ])
  })

  it('stops substring matching once enough fallback suggestions are retained', () => {
    const candidates = Array.from({ length: 10_000 }, (_, index) => `team-review-${index}`)
    candidates.push('review-last', 'review-final')
    const includes = String.prototype.includes
    let substringChecks = 0
    const spy = vi.spyOn(String.prototype, 'includes').mockImplementation(function (
      this: string,
      search: string,
      position?: number
    ) {
      substringChecks += 1
      return includes.call(this, search, position)
    })
    let result: string[]
    try {
      result = rank(candidates, 'review', 8)
    } finally {
      spy.mockRestore()
    }
    expect(result).toEqual(['review-last', 'review-final', ...candidates.slice(0, 6)])
    expect(substringChecks).toBeLessThanOrEqual(8)
  })

  it.each([0, -0, -1, -0.5, -Infinity, Number.NaN])(
    'preserves empty results for limit %s',
    (limit) => {
      expect(rank(['team-review', 'review-a', 'review-b'], 'review', limit)).toEqual([])
    }
  )

  it.each([0.5, 1.5, 2.5, Infinity])('preserves slice truncation for limit %s', (limit) => {
    const candidates = ['team-review', 'pre-review', 'review-a', 'review-b']
    expect(rank(candidates, 'review', limit)).toEqual(
      ['review-a', 'review-b', 'team-review', 'pre-review'].slice(0, limit)
    )
    expect(rank(candidates, '', limit)).toEqual(candidates.slice(0, limit))
  })
})
