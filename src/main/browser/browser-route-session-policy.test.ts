import { describe, expect, it } from 'vitest'
import { BROWSER_ROUTE_PROXY_BYPASS_RULES } from './browser-route-session-policy'

describe('BROWSER_ROUTE_PROXY_BYPASS_RULES', () => {
  const rules = BROWSER_ROUTE_PROXY_BYPASS_RULES.split(';')

  it('keeps loopback on the SSH host by default', () => {
    // Why first: in Chromium a later bypass rule wins, so the port exemptions must follow it.
    expect(rules[0]).toBe('<-loopback>')
  })

  it('sends Okta Verify loopback calls to this desktop on every loopback spelling', () => {
    expect(rules).toEqual(
      expect.arrayContaining(['localhost:8769', '127.0.0.1:8769', '[::1]:8769', '127.0.0.1:65111'])
    )
  })

  it('exempts nothing broader than single loopback ports', () => {
    for (const rule of rules.slice(1)) {
      expect(rule).toMatch(/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/)
    }
  })
})
