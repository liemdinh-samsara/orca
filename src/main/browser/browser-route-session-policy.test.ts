import { describe, expect, it } from 'vitest'
import {
  BROWSER_ROUTE_PROXY_BYPASS_RULES,
  OKTA_VERIFY_LOOPBACK_PORTS
} from './browser-route-session-policy'

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

  it('pins the exact Okta Verify port list', () => {
    expect(OKTA_VERIFY_LOOPBACK_PORTS).toEqual([8769, 65111, 65112, 65121, 65122, 65123])
  })

  it('exempts all 18 Okta host and port pairs and nothing else', () => {
    const expected = OKTA_VERIFY_LOOPBACK_PORTS.flatMap((port) =>
      ['localhost', '127.0.0.1', '[::1]'].map((host) => `${host}:${port}`)
    )
    expect(rules.slice(1)).toHaveLength(18)
    expect(rules.slice(1).sort()).toEqual(expected.sort())
  })

  it('exempts only ports in the Okta Verify port list', () => {
    for (const rule of rules.slice(1)) {
      const port = Number(rule.slice(rule.lastIndexOf(':') + 1))
      expect(OKTA_VERIFY_LOOPBACK_PORTS).toContain(port)
    }
  })

  it('places the literal Okta exemptions after the loopback subtraction rule', () => {
    expect(
      BROWSER_ROUTE_PROXY_BYPASS_RULES.startsWith(
        '<-loopback>;localhost:8769;127.0.0.1:8769;[::1]:8769'
      )
    ).toBe(true)
  })
})
