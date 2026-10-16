import { createRequire } from 'node:module'
import type { ExpoConfig } from 'expo/config'
import * as Notifications from 'expo-notifications'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDevicePushToken } from './push-token'

vi.mock('expo-notifications', () => ({ getDevicePushTokenAsync: vi.fn() }))

const constantsMock = vi.hoisted(() => {
  const constants: { expoConfig: unknown } = { expoConfig: undefined }
  return constants
})
vi.mock('expo-constants', () => ({ default: constantsMock }))

const require = createRequire(import.meta.url)
const appConfigPath = require.resolve('../../app.config.js')

function loadConfig(
  environment: string | undefined,
  plugins: ExpoConfig['plugins'] = ['expo-notifications', 'expo-router']
): Partial<ExpoConfig> {
  vi.stubEnv('ORCA_IOS_APS_ENVIRONMENT', environment)
  delete require.cache[appConfigPath]
  const factory: (input: { config: Partial<ExpoConfig> }) => Partial<ExpoConfig> = require(
    appConfigPath
  )
  return factory({
    config: {
      extra: { eas: { projectId: 'p' } },
      ios: { entitlements: { 'com.apple.developer.associated-domains': [] } },
      plugins
    }
  })
}

afterEach(() => {
  delete require.cache[appConfigPath]
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  constantsMock.expoConfig = undefined
})

describe('APNs build configuration', () => {
  it.each([
    [undefined, 'development'],
    ['production', 'production'],
    ['Production', 'development'],
    ['sandbox', 'development'],
    ['', 'development']
  ])('uses %s to configure extra, entitlement and plugin mode as %s', (environment, expected) => {
    const config = loadConfig(environment)

    expect(config.extra?.apsEnvironment).toBe(expected)
    expect(config.ios?.entitlements?.['aps-environment']).toBe(expected)
    expect(config.plugins).toContainEqual([
      'expo-notifications',
      expect.objectContaining({ mode: expected })
    ])
  })

  it('preserves existing extras and iOS entitlements', () => {
    const config = loadConfig('production')

    expect(config.extra).toEqual({ eas: { projectId: 'p' }, apsEnvironment: 'production' })
    expect(config.ios?.entitlements).toEqual({
      'com.apple.developer.associated-domains': [],
      'aps-environment': 'production'
    })
  })

  it('rewrites only the bare notifications plugin and keeps its background and icon options', () => {
    const routerPlugin: [string, Record<string, unknown>] = ['expo-router', { origin: 'orca' }]
    const configuredNotifications: [string, Record<string, unknown>] = [
      'expo-notifications',
      { icon: './custom-icon.png', mode: 'development' }
    ]
    const config = loadConfig('production', [
      'expo-notifications',
      'expo-router',
      routerPlugin,
      configuredNotifications
    ])

    expect(config.plugins).toEqual([
      [
        'expo-notifications',
        {
          enableBackgroundRemoteNotifications: true,
          mode: 'production',
          icon: './assets/notification-icon.png'
        }
      ],
      'expo-router',
      ['expo-router', { origin: 'orca' }],
      ['expo-notifications', { icon: './custom-icon.png', mode: 'development' }]
    ])
  })

  it.each([
    ['development', true, 'sandbox'],
    ['development', false, 'sandbox'],
    ['production', true, 'production'],
    ['production', false, 'production']
  ] as const)(
    'maps a %s build with __DEV__=%s to APNs host %s',
    async (environment, isDev, expectedHost) => {
      const config = loadConfig(environment)
      constantsMock.expoConfig = { extra: config.extra }
      vi.stubGlobal('__DEV__', isDev)
      vi.mocked(Notifications.getDevicePushTokenAsync).mockResolvedValue({
        type: 'ios',
        data: 'a'.repeat(64)
      })

      expect(config.extra?.apsEnvironment).toBe(environment)
      expect(config.ios?.entitlements?.['aps-environment']).toBe(environment)
      expect(config.plugins).toContainEqual([
        'expo-notifications',
        expect.objectContaining({ mode: environment })
      ])
      await expect(getDevicePushToken()).resolves.toEqual({
        platform: 'ios',
        token: 'a'.repeat(64),
        apnsEnvironment: expectedHost
      })
    }
  )
})
