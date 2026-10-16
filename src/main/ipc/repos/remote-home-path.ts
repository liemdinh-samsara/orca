import { getSshConnectionManager } from '../../ssh/ssh-target-registry'
import { resolveRemoteDirectory } from '../ssh-browse'

/** Expands a leading `~` against the SSH host's home; returns `path` unchanged when it can't. */
export async function resolveRemoteHomePath(connectionId: string, path: string): Promise<string> {
  if (path !== '~' && path !== '~/' && !path.startsWith('~/')) {
    return path
  }
  const conn = getSshConnectionManager()?.getConnection(connectionId)
  if (!conn) {
    return path
  }
  try {
    // Why: upstream removed the relay's session.resolveHome, so ask the host's shell over SSH exec.
    const home = await resolveRemoteDirectory(conn, '~')
    if (!home) {
      return path
    }
    const rest = path.slice(2)
    return rest ? `${home.replace(/\/+$/, '')}/${rest}` : home
  } catch {
    // Why: callers treat an unexpanded `~` as "not connected" and surface their own message.
    return path
  }
}
