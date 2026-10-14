import DOMPurify from 'dompurify'
import { isMarkdownPath } from './markdown-document-path'
import { assignHeadingIds, renderMarkdownDocument } from './markdown-document-render'
import { MARKDOWN_VIEWER_STYLES } from './markdown-viewer-styles'

export type MarkdownViewerLabels = { showSource: string; showRendered: string }

export type MarkdownViewerMountResult =
  | 'rendered'
  | 'already-mounted'
  | 'not-markdown'
  | 'too-large'

// Why: past this the parse would stall the tab; a raw view of a huge file is still usable.
const MAX_MARKDOWN_SOURCE_LENGTH = 5 * 1024 * 1024
const MARKDOWN_CONTENT_TYPES = new Set(['text/markdown', 'text/x-markdown'])
// Why: raw HTML in a README must not restyle the page, post forms, or grab focus.
const FORBIDDEN_TAGS = ['style', 'form', 'button', 'select', 'textarea']

function isMarkdownTextDocument(doc: Document): boolean {
  return (
    MARKDOWN_CONTENT_TYPES.has(doc.contentType) ||
    (doc.contentType === 'text/plain' && isMarkdownPath(doc.location.pathname))
  )
}

function revealLocationHash(doc: Document): void {
  if (doc.location.hash.length <= 1) {
    return
  }
  try {
    doc.getElementById(decodeURIComponent(doc.location.hash.slice(1)))?.scrollIntoView()
  } catch {
    // Why: a malformed escape in the hash just means there is no anchor to scroll to.
  }
}

/** Renders the markdown text document Chromium is showing as plain text, keeping the source a click away. */
export function mountMarkdownViewer(
  doc: Document,
  labels: MarkdownViewerLabels
): MarkdownViewerMountResult {
  const root = doc.documentElement
  if (root.dataset.orcaMarkdownView) {
    return 'already-mounted'
  }
  // Why: Chromium shows a text document as a lone <pre>; anything else is a real page ending in .md.
  const source = doc.body?.querySelector(':scope > pre')
  if (!source || !isMarkdownTextDocument(doc)) {
    return 'not-markdown'
  }
  const text = source.textContent ?? ''
  if (text.length > MAX_MARKDOWN_SOURCE_LENGTH) {
    return 'too-large'
  }

  const article = doc.createElement('article')
  article.className = 'orca-markdown-body'
  article.innerHTML = DOMPurify.sanitize(renderMarkdownDocument(text), {
    FORBID_TAGS: FORBIDDEN_TAGS
  })
  assignHeadingIds(article)

  const style = doc.createElement('style')
  style.textContent = MARKDOWN_VIEWER_STYLES
  const toggle = doc.createElement('button')
  toggle.type = 'button'
  toggle.className = 'orca-markdown-toggle'
  toggle.textContent = labels.showSource
  toggle.addEventListener('click', () => {
    const showSource = root.dataset.orcaMarkdownView === 'rendered'
    root.dataset.orcaMarkdownView = showSource ? 'source' : 'rendered'
    toggle.textContent = showSource ? labels.showRendered : labels.showSource
  })

  ;(doc.head ?? root).append(style)
  doc.body.append(article, toggle)
  root.dataset.orcaMarkdownView = 'rendered'
  revealLocationHash(doc)
  return 'rendered'
}
