import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parse } from 'yaml'

it('builds iOS releases with the production APNs entitlement', () => {
  const workflow = parse(readFileSync('.github/workflows/mobile-ios-release.yml', 'utf8'))
  const prebuild = workflow.jobs['ios-build'].steps.find((step) =>
    step.run?.includes('expo prebuild --platform ios')
  )

  expect(prebuild?.env?.ORCA_IOS_APS_ENVIRONMENT).toBe('production')
})
