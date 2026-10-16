import { mobileNativeChatStreamPreview } from './mobile-native-chat-streaming-gate'
import { useThrottledLatestValue } from './use-throttled-latest-value'

const NATIVE_CHAT_STREAM_THROTTLE_MS = 50

/** The terminal lane's streaming bubble text, throttled: OpenCode emits a status frame per
 *  streamed part, and each one re-renders and re-parses the whole accumulated markdown.
 *  Pass a null status for the structured lane, which streams through its own transcript. */
export function useMobileNativeChatStreamingText(
  status: Parameters<typeof mobileNativeChatStreamPreview>[0],
  working: boolean
): string | undefined {
  return useThrottledLatestValue(
    status ? mobileNativeChatStreamPreview(status, working) : undefined,
    NATIVE_CHAT_STREAM_THROTTLE_MS
  )
}
