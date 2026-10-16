import { createElement, type SetStateAction } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileNativeChatSkill } from './mobile-native-chat-skill-read'

const read = vi.hoisted(() => ({ fn: vi.fn() }))
const stateWrite = vi.hoisted(() => vi.fn())
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState<T>(initial: T | (() => T)) {
      const [value, setValue] = actual.useState(initial)
      return [
        value,
        (next: SetStateAction<T>) => {
          stateWrite(next)
          setValue(next)
        }
      ] as const
    }
  }
})
vi.mock('./mobile-native-chat-skill-read', () => ({ readMobileNativeChatSkills: read.fn }))

import {
  useMobileNativeChatHostSkills,
  useMobileNativeChatSkills
} from './use-mobile-native-chat-skills'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook only hands the client to the mocked read.
const CLIENT = {} as unknown as RpcClient
const REPORT: MobileNativeChatSkill = { name: 'liem-upload-report', description: 'Publish' }

type Args = Parameters<typeof useMobileNativeChatSkills>[0]
const base: Args = { client: CLIENT, worktreeId: 'wt-1', agent: 'claude', wanted: true }

let skills: readonly MobileNativeChatSkill[] = []

// One component identity for the whole test, or every update would remount and drop hook state.
function Harness({ value }: { value: Args }): null {
  skills = useMobileNativeChatSkills(value)
  return null
}

describe('useMobileNativeChatSkills', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    read.fn.mockReset()
    stateWrite.mockClear()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    skills = []
  })

  async function render(args: Args): Promise<void> {
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness, { value: args }))
      } else {
        renderer = create(createElement(Harness, { value: args }))
      }
    })
  }

  it('asks the host while a slash is being typed and returns what it says', async () => {
    read.fn.mockResolvedValue([REPORT])

    await render(base)

    expect(read.fn).toHaveBeenCalledWith(CLIENT, 'wt-1', 'claude')
    expect(skills).toEqual([REPORT])
  })

  it('does not ask while the composer is not on a slash', async () => {
    await render({ ...base, wanted: false })

    expect(read.fn).not.toHaveBeenCalled()
    expect(skills).toEqual([])
  })

  it('asks again each time a new slash starts, so a skill made meanwhile shows up', async () => {
    read.fn.mockResolvedValueOnce([REPORT])
    await render(base)
    await render({ ...base, wanted: false })
    read.fn.mockResolvedValueOnce([REPORT, { name: 'brand-new', description: null }])
    await render(base)

    expect(read.fn).toHaveBeenCalledTimes(2)
    expect(skills.map((skill) => skill.name)).toEqual(['liem-upload-report', 'brand-new'])
  })

  it('keeps the last list when a refresh gets no answer', async () => {
    read.fn.mockResolvedValueOnce([REPORT])
    await render(base)
    await render({ ...base, wanted: false })
    read.fn.mockResolvedValueOnce(null)
    await render(base)

    expect(skills).toEqual([REPORT])
  })

  it('never shows one workspace or agent’s skills in another', async () => {
    read.fn.mockResolvedValueOnce([REPORT])
    await render(base)
    read.fn.mockResolvedValueOnce(null)
    await render({ ...base, worktreeId: 'wt-2' })

    expect(skills).toEqual([])
  })

  it.each([
    ['workspace changed', { ...base, worktreeId: 'wt-2' }],
    ['agent changed', { ...base, agent: 'codex' }],
    ['slash dropped', { ...base, wanted: false }]
  ])('ignores a reply after the %s', async (_label, next) => {
    let resolve!: (value: readonly MobileNativeChatSkill[]) => void
    const pending = new Promise<readonly MobileNativeChatSkill[]>((done) => {
      resolve = done
    })
    read.fn.mockReturnValueOnce(pending).mockResolvedValue(null)
    await render(base)
    await render(next)

    await act(async () => {
      resolve([REPORT])
    })

    expect(stateWrite).not.toHaveBeenCalled()
    expect(skills).toEqual([])
    await render(base)
    expect(skills).toEqual([])
  })

  it('ignores a reply after unmount without writing state or logging an error', async () => {
    let resolve!: (value: readonly MobileNativeChatSkill[]) => void
    read.fn.mockReturnValueOnce(
      new Promise<readonly MobileNativeChatSkill[]>((done) => {
        resolve = done
      })
    )
    await render(base)
    act(() => renderer?.unmount())
    renderer = null
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await act(async () => {
        resolve([REPORT])
      })

      expect(stateWrite).not.toHaveBeenCalled()
      expect(skills).toEqual([])
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('stays quiet without a connection, workspace or agent', async () => {
    await render({ ...base, client: null })
    await render({ ...base, client: CLIENT, worktreeId: null })
    await render({ ...base, worktreeId: 'wt-1', agent: null })

    expect(read.fn).not.toHaveBeenCalled()
  })
})

describe('useMobileNativeChatHostSkills', () => {
  let renderer: ReactTestRenderer | null = null
  let result: ReturnType<typeof useMobileNativeChatHostSkills> | null = null

  function Composite({ text }: { text: string }): null {
    result = useMobileNativeChatHostSkills({
      client: CLIENT,
      worktreeId: 'wt-1',
      agent: 'claude',
      composerText: text
    })
    return null
  }

  async function type(text: string): Promise<void> {
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Composite, { text }))
      } else {
        renderer = create(createElement(Composite, { text }))
      }
    })
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    result = null
  })

  it('asks only while the text is a slash token, and returns them as reported skill entries', async () => {
    read.fn.mockReset()
    read.fn.mockResolvedValue([REPORT])

    await type('hello')
    expect(read.fn).not.toHaveBeenCalled()

    await type('/liem')
    expect(read.fn).toHaveBeenCalledTimes(1)
    expect(result).toEqual([{ name: 'liem-upload-report', kind: 'skill', description: 'Publish' }])

    await type('/liem-upload-report some text')
    expect(read.fn).toHaveBeenCalledTimes(1)
  })

  it('omits the description key when the host skill has no description', async () => {
    read.fn.mockReset()
    read.fn.mockResolvedValue([{ name: 'report', description: null }])

    await type('/report')

    expect(result).toEqual([{ name: 'report', kind: 'skill' }])
    expect(result?.[0]).not.toHaveProperty('description')
  })
})
