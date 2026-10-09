import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceStartPath, resolveWorkspaceStartCwd } from './workspace-start-path'

describe('normalizeWorkspaceStartPath', () => {
  it('normalizes separators and drops empty and dot segments', () => {
    expect(normalizeWorkspaceStartPath(' projects//ray\\./api/ ')).toBe('projects/ray/api')
    expect(normalizeWorkspaceStartPath('')).toBe('')
    expect(normalizeWorkspaceStartPath('./')).toBe('')
  })

  it('rejects absolute paths and paths that climb out of the workspace', () => {
    expect(normalizeWorkspaceStartPath('/etc')).toBeNull()
    expect(normalizeWorkspaceStartPath('\\server\\share')).toBeNull()
    expect(normalizeWorkspaceStartPath('C:\\repo')).toBeNull()
    expect(normalizeWorkspaceStartPath('services/../../outside')).toBeNull()
  })
})

describe('resolveWorkspaceStartCwd', () => {
  it('returns the workspace path when no start folder is set', () => {
    expect(resolveWorkspaceStartCwd('/repo', undefined)).toBe('/repo')
    expect(resolveWorkspaceStartCwd('/repo', { workspaceStartPath: '' })).toBe('/repo')
  })

  it('joins the start folder with the separator style of the workspace path', () => {
    expect(resolveWorkspaceStartCwd('/repo/', { workspaceStartPath: 'projects/ray' })).toBe(
      '/repo/projects/ray'
    )
    expect(resolveWorkspaceStartCwd('C:\\repo', { workspaceStartPath: 'projects/ray' })).toBe(
      'C:\\repo\\projects\\ray'
    )
  })

  it('ignores a persisted start folder that escapes the workspace', () => {
    expect(resolveWorkspaceStartCwd('/repo', { workspaceStartPath: '../other' })).toBe('/repo')
  })
})
