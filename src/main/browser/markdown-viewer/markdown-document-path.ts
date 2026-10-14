const MARKDOWN_PATH_PATTERN = /\.(?:md|markdown|mdown|mkdn?|mdwn|mdtxt|mdtext)$/i

export function isMarkdownPath(pathname: string): boolean {
  return MARKDOWN_PATH_PATTERN.test(pathname)
}

/** Only pages Chromium could have shown as text: web and local files, never app-internal schemes. */
export function isMarkdownDocumentUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const isViewableScheme =
    parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:'
  return isViewableScheme && isMarkdownPath(parsed.pathname)
}
