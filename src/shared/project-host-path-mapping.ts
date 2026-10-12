import { isWindowsAbsolutePathLike } from './cross-platform-path'

function splitSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean)
}

/**
 * Re-roots `path` from one host's project prefix onto another's, e.g.
 * `/Users/me/co/app` from `/Users/me` onto `/home/ubuntu` is `/home/ubuntu/co/app`.
 * Null when `path` is not inside `fromPrefix`.
 */
export function mapPathBetweenHostPrefixes(
  path: string,
  fromPrefix: string,
  toPrefix: string
): string | null {
  const caseInsensitive = isWindowsAbsolutePathLike(fromPrefix)
  const normalize = (segment: string): string => (caseInsensitive ? segment.toLowerCase() : segment)
  const prefixSegments = splitSegments(fromPrefix)
  const pathSegments = splitSegments(path)
  if (
    prefixSegments.length > pathSegments.length ||
    prefixSegments.some((segment, index) => normalize(segment) !== normalize(pathSegments[index]))
  ) {
    return null
  }
  const rest = pathSegments.slice(prefixSegments.length)
  const separator = toPrefix.includes('\\') && !toPrefix.includes('/') ? '\\' : '/'
  const base = toPrefix.replace(/[\\/]+$/, '')
  if (rest.length === 0) {
    return base || separator
  }
  return `${base}${separator}${rest.join(separator)}`
}
