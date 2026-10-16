import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import { addPushTokenListener, getDevicePushToken } from './push-token'

vi.mock('expo-notifications', () => ({
  getDevicePushTokenAsync: vi.fn(),
  addPushTokenListener: vi.fn()
}))

const constantsMock = vi.hoisted(() => {
  const constants: { expoConfig: unknown } = { expoConfig: undefined }
  return constants
})
vi.mock('expo-constants', () => ({ default: constantsMock }))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  constantsMock.expoConfig = undefined
})

describe('getDevicePushToken', () => {
  it.each([
    [true, 'sandbox'],
    [false, 'production']
  ])('reports apnsEnvironment for a __DEV__=%s iOS build as %s', async (isDev, environment) => {
    vi.stubGlobal('__DEV__', isDev)
    vi.mocked(Notifications.getDevicePushTokenAsync).mockResolvedValue({
      type: 'ios',
      data: 'a'.repeat(64)
    })

    await expect(getDevicePushToken()).resolves.toEqual({
      platform: 'ios',
      token: 'a'.repeat(64),
      apnsEnvironment: environment
    })
  })

  it.each([
    ['production', false, 'production'],
    ['development', false, 'sandbox'],
    ['production', true, 'production'],
    ['development', true, 'sandbox']
  ])(
    'follows the build-time aps-environment %s over __DEV__=%s: %s',
    async (apsEnvironment, isDev, environment) => {
      vi.stubGlobal('__DEV__', isDev)
      constantsMock.expoConfig = { extra: { apsEnvironment } }
      vi.mocked(Notifications.getDevicePushTokenAsync).mockResolvedValue({
        type: 'ios',
        data: 'a'.repeat(64)
      })

      await expect(getDevicePushToken()).resolves.toMatchObject({ apnsEnvironment: environment })
    }
  )

  describe.each([
    [true, 'sandbox'],
    [false, 'production']
  ] as const)('fallback with __DEV__=%s', (isDev, environment) => {
    beforeEach(() => {
      vi.stubGlobal('__DEV__', isDev)
      vi.mocked(Notifications.getDevicePushTokenAsync).mockResolvedValue({
        type: 'ios',
        data: 'a'.repeat(64)
      })
    })

    it.each(['staging', '', 1, null])(
      'ignores unrecognised apsEnvironment %j and uses the runtime fallback',
      async (apsEnvironment) => {
        constantsMock.expoConfig = { extra: { apsEnvironment } }

        await expect(getDevicePushToken()).resolves.toEqual({
          platform: 'ios',
          token: 'a'.repeat(64),
          apnsEnvironment: environment
        })
      }
    )

    it('uses the runtime fallback when extra has no apsEnvironment', async () => {
      constantsMock.expoConfig = { extra: { eas: { projectId: 'p' } } }

      await expect(getDevicePushToken()).resolves.toMatchObject({ apnsEnvironment: environment })
    })
  })

  it('omits apnsEnvironment for Android, where FCM has no environment split', async () => {
    vi.mocked(Notifications.getDevicePushTokenAsync).mockResolvedValue({
      type: 'android',
      data: 'fcm-registration-token'
    })

    await expect(getDevicePushToken()).resolves.toEqual({
      platform: 'android',
      token: 'fcm-registration-token'
    })
  })

  it.each([
    ['a web push subscription', { type: 'web', data: { endpoint: 'https://example.test' } }],
    ['an empty token', { type: 'ios', data: '' }]
  ] as const)('returns null for %s', async (_label, raw) => {
    vi.mocked(Notifications.getDevicePushTokenAsync).mockResolvedValue(raw)

    await expect(getDevicePushToken()).resolves.toBeNull()
  })

  it('returns null when the shell cannot mint a token at all', async () => {
    vi.mocked(Notifications.getDevicePushTokenAsync).mockRejectedValue(new Error('no entitlement'))

    await expect(getDevicePushToken()).resolves.toBeNull()
  })
})

describe('addPushTokenListener', () => {
  it('forwards a rolled native token and removes the subscription on teardown', () => {
    const remove = vi.fn()
    let emit: Notifications.PushTokenListener = () => {
      throw new Error('token listener was not registered')
    }
    vi.mocked(Notifications.addPushTokenListener).mockImplementation((listener) => {
      emit = listener
      return { remove }
    })
    const seen: unknown[] = []

    const stop = addPushTokenListener((token) => seen.push(token))
    emit({ type: 'android', data: 'rolled' })
    emit({ type: 'web', data: {} })
    stop()

    expect(seen).toEqual([{ platform: 'android', token: 'rolled' }])
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])(
    'reports the build-time sandbox environment for a rolled iOS token with __DEV__=%s',
    (isDev) => {
      vi.stubGlobal('__DEV__', isDev)
      constantsMock.expoConfig = { extra: { apsEnvironment: 'development' } }
      const remove = vi.fn()
      let emit: Notifications.PushTokenListener = () => {
        throw new Error('token listener was not registered')
      }
      vi.mocked(Notifications.addPushTokenListener).mockImplementation((listener) => {
        emit = listener
        return { remove }
      })
      const seen: unknown[] = []

      const stop = addPushTokenListener((token) => seen.push(token))
      emit({ type: 'ios', data: 'b'.repeat(64) })
      stop()

      expect(seen).toEqual([{ platform: 'ios', token: 'b'.repeat(64), apnsEnvironment: 'sandbox' }])
      expect(remove).toHaveBeenCalledTimes(1)
    }
  )

  it('degrades to a no-op on a shell that cannot subscribe to token changes', () => {
    vi.mocked(Notifications.addPushTokenListener).mockImplementation(() => {
      throw new Error('no push support')
    })

    expect(() => addPushTokenListener(() => {})()).not.toThrow()
  })
})
