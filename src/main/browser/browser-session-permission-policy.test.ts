import { describe, expect, it } from 'vitest'
import {
  allowsAuthenticatorAppLaunch,
  isAutoGrantedBrowserSessionPermission,
  isMutedSiteNotification
} from './browser-session-permission-policy'

describe('allowsAuthenticatorAppLaunch', () => {
  it.each([
    'com-okta-authenticator:/deviceChallenge?x=1',
    'COM-OKTA-AUTHENTICATOR:/deviceChallenge?x=1'
  ])('allows openExternal for %s', (externalURL) => {
    expect(allowsAuthenticatorAppLaunch('openExternal', { externalURL })).toBe(true)
  })

  it.each(['notifications', 'clipboard-read', 'loopback-network'])(
    'denies an Okta URL for permission %s',
    (permission) => {
      expect(
        allowsAuthenticatorAppLaunch(permission, {
          externalURL: 'com-okta-authenticator:/deviceChallenge?x=1'
        })
      ).toBe(false)
    }
  )

  it.each([
    undefined,
    {},
    { externalURL: undefined },
    { externalURL: null },
    { externalURL: 123 },
    { externalURL: { toString: () => 'com-okta-authenticator:/deviceChallenge?x=1' } }
  ])('denies missing or non-string externalURL in %j', (details) => {
    expect(allowsAuthenticatorAppLaunch('openExternal', details)).toBe(false)
  })

  it.each([
    'not a url',
    'slack://open',
    'com-okta-authenticator-evil:/deviceChallenge?x=1',
    'https://com-okta-authenticator/deviceChallenge?x=1'
  ])('denies openExternal for %s', (externalURL) => {
    expect(allowsAuthenticatorAppLaunch('openExternal', { externalURL })).toBe(false)
  })
})

describe('isAutoGrantedBrowserSessionPermission', () => {
  it.each(['local-network-access', 'local-network', 'loopback-network'])(
    'grants %s',
    (permission) => {
      expect(isAutoGrantedBrowserSessionPermission(permission)).toBe(true)
    }
  )

  it('denies top-level-storage-access', () => {
    expect(isAutoGrantedBrowserSessionPermission('top-level-storage-access')).toBe(false)
  })
})

describe('isMutedSiteNotification', () => {
  it('mutes notifications from Slack and its subdomains', () => {
    expect(isMutedSiteNotification('notifications', 'https://app.slack.com/client/T1/C1')).toBe(
      true
    )
    expect(isMutedSiteNotification('notifications', 'https://acme.enterprise.slack.com/')).toBe(
      true
    )
    expect(isMutedSiteNotification('notifications', 'https://slack.com/')).toBe(true)
  })

  it('leaves other sites and permissions alone', () => {
    expect(isMutedSiteNotification('notifications', 'https://example.com/')).toBe(false)
    expect(isMutedSiteNotification('notifications', 'https://notslack.com/')).toBe(false)
    expect(isMutedSiteNotification('notifications', 'https://slack.com.evil.test/')).toBe(false)
    expect(isMutedSiteNotification('clipboard-read', 'https://app.slack.com/')).toBe(false)
  })

  it('does not mute when the requester is unknown', () => {
    expect(isMutedSiteNotification('notifications', undefined)).toBe(false)
    expect(isMutedSiteNotification('notifications', '')).toBe(false)
    expect(isMutedSiteNotification('notifications', 'not a url')).toBe(false)
  })
})
