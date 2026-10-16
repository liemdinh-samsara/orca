// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountMarkdownViewer } from './markdown-viewer-mount'
import { MARKDOWN_VIEWER_STYLES } from './markdown-viewer-styles'

// Why: DOMPurify misbehaves under happy-dom (drops headings, keeps handlers); the e2e spec checks
// sanitization in Chromium, so these cases cover mounting only.
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }))

const LABELS = { showSource: 'Show source', showRendered: 'Show rendered' }
// Mirrors MAX_MARKDOWN_SOURCE_LENGTH in the mount module, which is not exported.
const FIVE_MIB = 5 * 1024 * 1024

// Why: Chromium shows a text document as a lone <pre> holding the file's text.
// The viewer reads only the path and hash, so a same-origin URL stands in for any host.
function loadTextDocument(pathAndHash: string, contentType: string, text: string): void {
  history.replaceState(null, '', pathAndHash)
  Object.defineProperty(document, 'contentType', { value: contentType, configurable: true })
  document.head.replaceChildren()
  const pre = document.createElement('pre')
  pre.textContent = text
  document.body.replaceChildren(pre)
}

afterEach(() => {
  vi.restoreAllMocks()
  delete document.documentElement.dataset.orcaMarkdownView
  Reflect.deleteProperty(document, 'contentType')
})

describe('mountMarkdownViewer', () => {
  it('renders a plain-text .md file and keeps the source a click away', () => {
    loadTextDocument('/README.md', 'text/plain', '# Title\n\nSome *text*.')

    expect(mountMarkdownViewer(document, LABELS)).toBe('rendered')
    expect(document.querySelector('.orca-markdown-body h1')?.id).toBe('title')
    expect(document.querySelector('.orca-markdown-body em')?.textContent).toBe('text')
    expect(document.documentElement.dataset.orcaMarkdownView).toBe('rendered')
    expect(document.querySelector('body > pre')?.textContent).toBe('# Title\n\nSome *text*.')

    const toggle = document.querySelector<HTMLButtonElement>('.orca-markdown-toggle')
    toggle?.click()
    expect(document.documentElement.dataset.orcaMarkdownView).toBe('source')
    expect(toggle?.textContent).toBe('Show rendered')
    toggle?.click()
    expect(document.documentElement.dataset.orcaMarkdownView).toBe('rendered')
    expect(toggle?.textContent).toBe('Show source')
  })

  it('renders text/markdown whatever the path, and only once per document', () => {
    loadTextDocument('/notes/README', 'text/markdown', '# Notes')

    expect(mountMarkdownViewer(document, LABELS)).toBe('rendered')
    expect(mountMarkdownViewer(document, LABELS)).toBe('already-mounted')
    expect(document.querySelectorAll('.orca-markdown-body')).toHaveLength(1)
  })

  it('leaves real pages and non-markdown text alone', () => {
    loadTextDocument('/notes.txt', 'text/plain', '# Not markdown')
    expect(mountMarkdownViewer(document, LABELS)).toBe('not-markdown')

    loadTextDocument('/o/r/blob/main/README.md', 'text/html', '# Page')
    expect(mountMarkdownViewer(document, LABELS)).toBe('not-markdown')
    expect(document.querySelector('.orca-markdown-body')).toBeNull()
  })

  it('scrolls to the anchor named in the URL once the headings exist', () => {
    loadTextDocument('/README.md#usage', 'text/plain', '# Intro\n\n## Usage')
    let scrolledTo: string | null = null
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolledTo = this.id
    }

    mountMarkdownViewer(document, LABELS)
    expect(scrolledTo).toBe('usage')
  })

  it('renders text/x-markdown like text/markdown', () => {
    loadTextDocument('/notes/README', 'text/x-markdown', '# Legacy type')

    expect(mountMarkdownViewer(document, LABELS)).toBe('rendered')
    expect(document.querySelector('.orca-markdown-body h1')?.textContent).toBe('Legacy type')
  })

  it('leaves a document over 5 MiB as raw text', () => {
    loadTextDocument('/README.md', 'text/plain', 'a'.repeat(FIVE_MIB + 1))

    expect(mountMarkdownViewer(document, LABELS)).toBe('too-large')
    expect(document.querySelector('.orca-markdown-body')).toBeNull()
    expect(document.querySelector('.orca-markdown-toggle')).toBeNull()
    expect(document.documentElement.dataset.orcaMarkdownView).toBeUndefined()
  })

  it('still renders a document of exactly 5 MiB', () => {
    loadTextDocument('/README.md', 'text/plain', 'a'.repeat(FIVE_MIB))

    expect(mountMarkdownViewer(document, LABELS)).toBe('rendered')
  })

  it('ignores a malformed escape in the hash instead of failing the mount', () => {
    loadTextDocument('/README.md#%E0%A4%A', 'text/plain', '# Intro\n\n## Usage')
    expect(document.location.hash).toBe('#%E0%A4%A')
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})

    expect(mountMarkdownViewer(document, LABELS)).toBe('rendered')
    expect(scroll).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.orcaMarkdownView).toBe('rendered')
  })

  it('decodes an escaped hash before looking for its heading', () => {
    loadTextDocument('/README.md#caf%C3%A9', 'text/plain', '# Café')
    const scrolledTo: string[] = []
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (
      this: HTMLElement
    ) {
      scrolledTo.push(this.id)
    })

    mountMarkdownViewer(document, LABELS)
    expect(scrolledTo).toEqual(['café'])
  })

  it('puts the toggle beside the article and the stylesheet in the head', () => {
    loadTextDocument('/README.md', 'text/plain', '# Title')

    mountMarkdownViewer(document, LABELS)
    const article = document.querySelector('.orca-markdown-body')
    const toggle = document.querySelector('.orca-markdown-toggle')
    expect(toggle?.parentElement).toBe(document.body)
    expect(article?.parentElement).toBe(document.body)
    expect(article?.contains(toggle)).toBe(false)
    expect(toggle?.textContent).toBe('Show source')
    expect(document.head.querySelectorAll('style')).toHaveLength(1)
    expect(document.head.querySelector('style')?.textContent).toBe(MARKDOWN_VIEWER_STYLES)
    expect(document.body.querySelector('style')).toBeNull()
  })
})
