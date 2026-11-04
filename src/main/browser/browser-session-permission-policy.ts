// Site prompts live in browser-site-permission-prompt.ts; other unlisted permissions are denied.
const AUTO_GRANTED_BROWSER_PERMISSIONS = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  // Chromium requests this even though Electron's permission union omits it.
  'persistent-storage',
  // Chromium still requires user activation for pointer lock.
  'pointerLock',
  // Match Orca's unpartitioned third-party cookie policy; request and check must agree.
  // This also grants unpartitioned localStorage/IndexedDB handles, unlike ambient globals.
  // Revisit if partitioning becomes configurable: Electron does not persist a STORAGE_ACCESS grant.
  'storage-access'
])
// Top-level storage access requires Related Website Sets, which Orca does not supply.

// Why: these sites' desktop apps already notify, so a granted web copy doubles every alert.
const NOTIFICATION_MUTED_SITES = ['slack.com']

export function isAutoGrantedBrowserSessionPermission(permission: string): boolean {
  return AUTO_GRANTED_BROWSER_PERMISSIONS.has(permission)
}

/** True when `url` belongs to a site whose page notifications Orca withholds. */
export function isMutedSiteNotification(
  permission: string,
  url: string | null | undefined
): boolean {
  if (permission !== 'notifications' || !url) {
    return false
  }
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return false
  }
  return NOTIFICATION_MUTED_SITES.some((site) => hostname === site || hostname.endsWith(`.${site}`))
}
