import { useMemo } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileNativeChatVisualSource } from './mobile-native-chat-visual-read'

/** Where a structured chat's images and visuals are read from; null until both are known. */
export function useMobileNativeChatVisualSource(
  client: RpcClient | null,
  sessionId: string | null
): MobileNativeChatVisualSource | null {
  return useMemo(() => (client && sessionId ? { client, sessionId } : null), [client, sessionId])
}
