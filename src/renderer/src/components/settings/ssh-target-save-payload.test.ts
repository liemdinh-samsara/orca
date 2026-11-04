import { describe, expect, it } from 'vitest'
import { EMPTY_FORM, getEditingTargetForSshTarget, isSshTargetFormDirty } from './ssh-target-draft'
import { buildSshTargetSavePayload } from './ssh-target-save-payload'

describe('buildSshTargetSavePayload', () => {
  it.each(['', '   '])(
    'omits an empty project prefix %j and explicitly clears it on update',
    (projectPathPrefix) => {
      const result = buildSshTargetSavePayload({ ...EMPTY_FORM, host: 'devbox', projectPathPrefix })
      if (!result.ok) {
        throw new Error(result.error)
      }

      expect(result.payload.target).not.toHaveProperty('projectPathPrefix')
      expect(result.payload.updates).toHaveProperty('projectPathPrefix', undefined)
    }
  )

  it.each(['/data/src', '~', '~/code'])(
    'trims and stores project prefix %s',
    (projectPathPrefix) => {
      const result = buildSshTargetSavePayload({
        ...EMPTY_FORM,
        host: 'devbox',
        projectPathPrefix: `  ${projectPathPrefix}  `
      })
      if (!result.ok) {
        throw new Error(result.error)
      }

      expect(result.payload.target.projectPathPrefix).toBe(projectPathPrefix)
      expect(result.payload.updates.projectPathPrefix).toBe(projectPathPrefix)
    }
  )

  it.each(['code', 'C:\\src'])(
    'rejects project prefix %s that is not a remote absolute path',
    (projectPathPrefix) => {
      const result = buildSshTargetSavePayload({ ...EMPTY_FORM, host: 'devbox', projectPathPrefix })

      expect(result.ok).toBe(false)
      if (result.ok) {
        throw new Error('expected an invalid project prefix')
      }
      expect(result.error).toContain('Project path prefix')
    }
  )

  it('round-trips a saved project prefix and detects edits to it', () => {
    const saved = buildSshTargetSavePayload({
      ...EMPTY_FORM,
      host: 'devbox',
      projectPathPrefix: '/data/src'
    })
    if (!saved.ok) {
      throw new Error(saved.error)
    }
    const form = getEditingTargetForSshTarget({ id: 'devbox', ...saved.payload.target })

    expect(form.projectPathPrefix).toBe('/data/src')
    expect(isSshTargetFormDirty(form, form)).toBe(false)
    expect(isSshTargetFormDirty({ ...form, projectPathPrefix: '~/code' }, form)).toBe(true)
    const roundTrip = buildSshTargetSavePayload(form)
    if (!roundTrip.ok) {
      throw new Error(roundTrip.error)
    }
    expect(roundTrip.payload.target.projectPathPrefix).toBe('/data/src')
  })

  it('starts with an empty project prefix for new drafts and targets saved without one', () => {
    const saved = buildSshTargetSavePayload({ ...EMPTY_FORM, host: 'devbox' })
    if (!saved.ok) {
      throw new Error(saved.error)
    }

    expect(EMPTY_FORM.projectPathPrefix).toBe('')
    expect(getEditingTargetForSshTarget({ id: 'devbox', ...saved.payload.target })).toMatchObject({
      projectPathPrefix: ''
    })
  })
})
