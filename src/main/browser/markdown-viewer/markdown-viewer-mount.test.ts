// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountMarkdownViewer } from './markdown-viewer-mount'

// Why: DOMPurify misbehaves under happy-dom (drops headings, keeps handlers); the e2e spec checks
// sanitization in Chromium, so these cases cover mounting only.
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }))

const LABELS = { showSource: 'Show source', showRendered: 'Show rendered' }

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
})
