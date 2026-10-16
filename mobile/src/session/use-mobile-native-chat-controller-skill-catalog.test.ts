import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

const sessionCommands = [{ name: 'liem-upload-report', kind: 'skill' as const }]
const optionSurface = {
  getSnapshot: () => [],
  setOption: async () => ({ snapshot: [] }),
  invokeAction: async () => ({ snapshot: [] }),
  subscribe: () => () => {}
}

// The controller composes many session hooks; each is mocked to the minimal shape it reads.
vi.mock('./use-mobile-session-view-mode', () => ({
  useMobileSessionViewMode: () => ({ isTabChatView: () => true, toggleTabChatView: vi.fn() })
}))
vi.mock('./use-mobile-native-chat-session', () => ({
  useMobileNativeChatSession: () => ({ messages: [], status: 'ready', transcriptLoading: false })
}))
vi.mock('./use-mobile-structured-agent-session', () => ({
  useMobileStructuredAgentSession: () => ({
    session: {
      messages: [],
      status: 'ready',
      transcriptLoading: false,
      error: undefined,
      hasMore: false,
      loadingEarlier: false,
      loadEarlier: vi.fn()
    },
    sessionCommands,
    isWorking: false,
    turnId: null,
    queued: { cards: [], send: vi.fn(), delete: vi.fn(), edit: vi.fn() },
    sendWithOutcome: vi.fn(),
    acceptsImages: false,
    cancel: vi.fn(),
    cancelPrompt: vi.fn(),
    permission: null,
    question: null,
    optionSnapshot: [],
    optionSurface,
    pendingOptionId: null,
    respondPermission: vi.fn(),
    respondQuestion: vi.fn(),
    setStructuredOption: vi.fn(),
    invokeStructuredOption: vi.fn()
  })
}))
vi.mock('./use-mobile-native-chat-drafts', () => ({
  useMobileNativeChatDrafts: () => ({
    composerText: '',
    setComposerText: vi.fn(),
    pending: [],
    imagePreviewsByMessageId: {},
    captureSendOrigin: vi.fn(),
    readSeededLaunchDraft: () => null,
    readSeededLaunchDraftSeed: () => null,
    clearDraftForSend: vi.fn(),
    restoreRejectedDraft: vi.fn(),
    acceptSend: vi.fn(),
    holdUnconfirmedSend: vi.fn()
  })
}))
vi.mock('./use-mobile-native-chat-prompts', () => ({
  useMobileNativeChatPrompts: () => ({
    permission: null,
    question: null,
    detectedAsk: null,
    ask: null
  })
}))
vi.mock('./use-mobile-native-chat-answer-send', () => ({
  useMobileNativeChatAnswerSend: () => ({ answerAsk: vi.fn(), cancelPending: vi.fn() })
}))
vi.mock('./mobile-native-chat-permission-send', () => ({
  useMobileNativeChatPermissionSend: () => vi.fn()
}))
vi.mock('./use-mobile-native-chat-stop', () => ({
  useMobileNativeChatStop: () => vi.fn()
}))
vi.mock('./use-mobile-native-chat-file-search', () => ({
  useMobileNativeChatFileSearch: () => ({ nativeChatFilePaths: [], loadNativeChatFiles: vi.fn() })
}))
vi.mock('./mobile-native-chat-send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-send')>()),
  sendMobileNativeChatMessageWithOutcome: vi.fn()
}))

import {
  useMobileNativeChatController,
  type MobileNativeChatController
} from './use-mobile-native-chat-controller'

describe('useMobileNativeChatController skill catalog', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController | null = null
  const clientStub = { sendRequest: vi.fn() }

  function Harness(): null {
    controller = useMobileNativeChatController({
      client: clientStub as unknown as RpcClient,
      connState: 'connected',
      hostId: 'h',
      worktreeId: 'w',
      activeSessionTab: {
        type: 'agent-session',
        id: 'agent-tab-1',
        title: 'Chat',
        sessionId: 'session-structured',
        agent: 'codex',
        isActive: true
      } as never,
      activeSessionTabId: 'agent-tab-1',
      activeHandleRef: { current: null },
      deviceTokenRef: { current: null },
      nativeChatTranscriptIsLocalReadable: true,
      nativeChatInputLeaseReady: false,
      agentSessionHostSupport: null,
      onSendError: vi.fn(),
      onSendResolved: vi.fn()
    })
    return null
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
  })

  it('exposes the client, workspace and structured session slash catalog', () => {
    act(() => {
      renderer = create(createElement(Harness))
    })
    expect(controller?.client).toBe(clientStub)
    expect(controller?.worktreeId).toBe('w')
    expect(controller?.nativeChatSessionCommands).toBe(sessionCommands)
  })
})
