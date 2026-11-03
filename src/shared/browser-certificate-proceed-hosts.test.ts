import { describe, expect, it } from 'vitest'

import { isCertificateProceedEligibleHost } from './browser-certificate-proceed-hosts'

describe('isCertificateProceedEligibleHost', () => {
  it('accepts loopback hosts and Samsara devbox hosts', () => {
    for (const hostname of [
      'localhost',
      '127.0.0.1',
      '[::1]',
      'liem.dinh.3.us-west-2.devbox.internal.samsara.com',
      'LIEM.DINH.3.US-WEST-2.DEVBOX.INTERNAL.SAMSARA.COM.'
    ]) {
      expect(isCertificateProceedEligibleHost(hostname), hostname).toBe(true)
    }
  })

  it('rejects public hosts and lookalikes of the devbox domain', () => {
    for (const hostname of [
      'example.com',
      'cloud.samsara.com',
      'devbox.internal.samsara.com',
      'evil-devbox.internal.samsara.com',
      'box.devbox.internal.samsara.com.evil.com',
      '192.168.1.1'
    ]) {
      expect(isCertificateProceedEligibleHost(hostname), hostname).toBe(false)
    }
  })
})
