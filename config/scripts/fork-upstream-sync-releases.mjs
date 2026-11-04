// Upstream release tags, shared by the sync (which release to merge) and the fork contract
// (which release the fork's own changes are measured from).
export const DEFAULT_RELEASE_TAG_PATTERN = '^v\\d+\\.\\d+\\.\\d+$'

const DAY_MS = 24 * 60 * 60 * 1000

function versionParts(name) {
  return (name.match(/\d+/g) ?? []).map(Number)
}

export function compareReleaseNames(a, b) {
  const left = versionParts(a)
  const right = versionParts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff) {
      return diff
    }
  }
  return 0
}

/** `git` arguments listing tags with their creation time, optionally only those merged into a ref. */
export function releaseTagListingArgs(merged) {
  return [
    'for-each-ref',
    '--format=%(refname:strip=2)%09%(creatordate:unix)',
    ...(merged ? [`--merged=${merged}`] : []),
    'refs/tags/'
  ]
}

export function parseReleaseTags(listing, pattern = DEFAULT_RELEASE_TAG_PATTERN) {
  const matcher = new RegExp(pattern)
  return listing
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, seconds] = line.split('\t')
      return { name, date: Number(seconds) * 1000 }
    })
    .filter((tag) => matcher.test(tag.name))
}

export function newestRelease(tags) {
  return [...tags].sort((a, b) => compareReleaseNames(b.name, a.name))[0] ?? null
}

/** Newest release tag that has been out for at least `minAgeDays`, or null. */
export function pickRelease(tags, { pattern, minAgeDays, now = Date.now() }) {
  const matcher = new RegExp(pattern)
  return newestRelease(
    tags.filter((tag) => matcher.test(tag.name) && now - tag.date >= minAgeDays * DAY_MS)
  )
}

export function releaseAgeDays(tag, now = Date.now()) {
  return Math.floor((now - tag.date) / DAY_MS)
}
