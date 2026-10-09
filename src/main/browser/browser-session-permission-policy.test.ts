import { describe, expect, it } from 'vitest'
import { isMutedSiteNotification } from './browser-session-permission-policy'

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
