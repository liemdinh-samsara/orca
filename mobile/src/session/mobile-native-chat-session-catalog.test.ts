import { describe, expect, it } from 'vitest'
import type { AgentSessionSlashCommand } from '../../../src/shared/agent-session-wire'
import {
  mobileSessionSlashSuggestions,
  mobileSlashCommands
} from './mobile-native-chat-session-catalog'

const reported: AgentSessionSlashCommand[] = [
  { name: 'compact', kind: 'command' },
  { name: 'liem-upload-report', kind: 'skill', description: 'Publish a report' },
  { name: 'review', kind: 'skill', argumentHint: '<pr>' },
  { name: 'compact', kind: 'skill', description: 'shadowed by the command' }
]

describe('mobileSessionSlashSuggestions', () => {
  it('lists the reported commands first, then the reported skills', () => {
    expect(mobileSessionSlashSuggestions('claude', reported).map((row) => row.name)).toEqual([
      'compact',
      'liem-upload-report',
      'review'
    ])
  })

  it('keeps a skill row description and argument hint', () => {
    const rows = mobileSessionSlashSuggestions('claude', reported)

    expect(rows.find((row) => row.name === 'liem-upload-report')).toEqual({
      name: 'liem-upload-report',
      description: 'Publish a report'
    })
    expect(rows.find((row) => row.name === 'review')).toEqual({
      name: 'review',
      argumentHint: '<pr>'
    })
  })

  it('offers nothing for an empty report', () => {
    expect(mobileSessionSlashSuggestions('claude', [])).toEqual([])
  })
})

describe('mobileSlashCommands', () => {
  it('prefers the session report, skills included, in a structured chat', () => {
    const names = mobileSlashCommands({
      agent: 'claude',
      structuredCommands: [],
      sessionCommands: reported
    }).map((row) => row.name)

    expect(names).toContain('liem-upload-report')
  })

  it('falls back to the structured catalog until the host reports one', () => {
    const names = mobileSlashCommands({ agent: 'claude', structuredCommands: ['clear'] }).map(
      (row) => row.name
    )

    expect(names).toContain('clear')
    expect(names).not.toContain('liem-upload-report')
  })

  it('offers nothing without an agent', () => {
    expect(mobileSlashCommands({ agent: null })).toEqual([])
  })
})

describe('mobileSlashCommands in a terminal-backed chat', () => {
  const hostSkills: AgentSessionSlashCommand[] = [
    { name: 'liem-upload-report', kind: 'skill', description: 'Publish a report' },
    { name: 'clear', kind: 'skill', description: 'shadowed by the built-in' }
  ]

  it('lists the curated commands first, then the host skills', () => {
    const rows = mobileSlashCommands({ agent: 'claude', sessionCommands: hostSkills })
    const names = rows.map((row) => row.name)

    expect(names.indexOf('liem-upload-report')).toBeGreaterThan(names.indexOf('clear'))
    expect(rows.find((row) => row.name === 'liem-upload-report')).toEqual({
      name: 'liem-upload-report',
      description: 'Publish a report'
    })
  })

  it('lets a built-in command keep its name over a skill', () => {
    const names = mobileSlashCommands({ agent: 'claude', sessionCommands: hostSkills }).map(
      (row) => row.name
    )

    expect(names.filter((name) => name === 'clear')).toHaveLength(1)
  })

  it('offers no skills before the host has named any', () => {
    expect(
      mobileSlashCommands({ agent: 'claude' }).some((row) => row.name === 'liem-upload-report')
    ).toBe(false)
  })
})
