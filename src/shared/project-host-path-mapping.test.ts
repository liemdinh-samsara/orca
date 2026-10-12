import { describe, expect, it } from 'vitest'
import { mapPathBetweenHostPrefixes } from './project-host-path-mapping'

describe('mapPathBetweenHostPrefixes', () => {
  it('swaps the Mac home prefix for the devbox prefix and keeps the suffix', () => {
    expect(
      mapPathBetweenHostPrefixes(
        '/Users/liem.dinh/co/mlcv_projects/projects/ray',
        '/Users/liem.dinh',
        '/home/ubuntu/'
      )
    ).toBe('/home/ubuntu/co/mlcv_projects/projects/ray')
  })

  it('rejects paths outside the prefix, including sibling names that share a stem', () => {
    expect(mapPathBetweenHostPrefixes('/opt/app', '/Users/me', '/home/ubuntu')).toBeNull()
    expect(mapPathBetweenHostPrefixes('/Users/meow/app', '/Users/me', '/home/ubuntu')).toBeNull()
  })

  it('maps the prefix itself and tolerates trailing separators', () => {
    expect(mapPathBetweenHostPrefixes('/Users/me/', '/Users/me/', '/home/ubuntu')).toBe(
      '/home/ubuntu'
    )
  })

  it('maps a Windows checkout onto a POSIX host, ignoring drive and segment case', () => {
    expect(
      mapPathBetweenHostPrefixes('c:\\users\\Me\\co\\app', 'C:\\Users\\me', '/home/ubuntu')
    ).toBe('/home/ubuntu/co/app')
  })
})
