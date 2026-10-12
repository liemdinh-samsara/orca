const PROXY_PROBE_URL = 'http://browser-route-probe.invalid/'

// Why: Okta FastPass signs in by calling Okta Verify on this desktop's loopback. Routed through the
// SSH host those calls find nothing, and Okta falls back to an app launch its policies can reject.
export const OKTA_VERIFY_LOOPBACK_PORTS: readonly number[] = [
  8769, 65111, 65112, 65121, 65122, 65123
]

/** Loopback goes to the SSH host (its dev servers), except the desktop authenticator's ports. */
export const BROWSER_ROUTE_PROXY_BYPASS_RULES = [
  '<-loopback>',
  ...OKTA_VERIFY_LOOPBACK_PORTS.flatMap((port) =>
    ['localhost', '127.0.0.1', '[::1]'].map((host) => `${host}:${port}`)
  )
].join(';')

export type BrowserRouteElectronSession = {
  setProxy(config: {
    mode: 'fixed_servers'
    proxyRules: string
    proxyBypassRules: string
  }): Promise<void>
  closeAllConnections(): Promise<void>
  resolveProxy(url: string): Promise<string>
}

export type BrowserRouteProxyEndpoint = Readonly<{ host: '127.0.0.1'; port: number }>

type BrowserRouteSessionPolicyDependencies = {
  getSession(partition: string): BrowserRouteElectronSession
  setupPolicies(input: {
    partition: string
    browserProfileId: string
    session: BrowserRouteElectronSession
  }): void | Promise<void>
  clearPolicies(input: { partition: string; session: BrowserRouteElectronSession }): void
}

export async function prepareBrowserRouteSessionPolicy(input: {
  partition: string
  browserProfileId: string
  proxyEndpoint: BrowserRouteProxyEndpoint
  dependencies: BrowserRouteSessionPolicyDependencies
}): Promise<BrowserRouteElectronSession> {
  const session = input.dependencies.getSession(input.partition)
  let proxySetup: Promise<void> | null = null
  try {
    proxySetup = session.setProxy({
      mode: 'fixed_servers',
      proxyRules: `socks5://${input.proxyEndpoint.host}:${input.proxyEndpoint.port}`,
      proxyBypassRules: BROWSER_ROUTE_PROXY_BYPASS_RULES
    })
    await input.dependencies.setupPolicies({
      partition: input.partition,
      browserProfileId: input.browserProfileId,
      session
    })
    await proxySetup
    await session.closeAllConnections()
    const resolved = await session.resolveProxy(PROXY_PROBE_URL)
    if (resolved.trim() !== `SOCKS5 ${input.proxyEndpoint.host}:${input.proxyEndpoint.port}`) {
      throw new Error('browser_route_partition_proxy_verification_failed')
    }
  } catch (error) {
    await proxySetup?.catch(() => {})
    try {
      await session.closeAllConnections()
    } catch {
      // The partition remains outside admission even when connection cleanup fails.
    }
    try {
      input.dependencies.clearPolicies({ partition: input.partition, session })
    } catch {
      // The partition remains outside the allowlist even if policy cleanup fails.
    }
    throw error
  }
  return session
}

export function assertBrowserRouteProxyEndpoint(
  endpoint: Readonly<{ host: string; port: number }>
): asserts endpoint is BrowserRouteProxyEndpoint {
  if (
    endpoint.host !== '127.0.0.1' ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65_535
  ) {
    throw new Error('browser_route_partition_proxy_invalid')
  }
}

export function sameBrowserRouteProxyEndpoint(
  left: BrowserRouteProxyEndpoint,
  right: BrowserRouteProxyEndpoint
): boolean {
  return left.host === right.host && left.port === right.port
}
