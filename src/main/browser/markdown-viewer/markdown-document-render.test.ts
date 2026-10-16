// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { isMarkdownDocumentUrl, isMarkdownPath } from './markdown-document-path'
import {
  assignHeadingIds,
  githubHeadingSlug,
  renderMarkdownDocument
} from './markdown-document-render'

describe('isMarkdownDocumentUrl', () => {
  it('accepts markdown files on the web and on disk', () => {
    expect(isMarkdownDocumentUrl('https://raw.githubusercontent.com/o/r/main/README.md')).toBe(true)
    expect(isMarkdownDocumentUrl('http://127.0.0.1:3000/docs/guide.markdown?x=1#top')).toBe(true)
    expect(isMarkdownDocumentUrl('file:///Users/me/notes/TODO.MD')).toBe(true)
  })

  it('rejects other files, other schemes and garbage', () => {
    expect(isMarkdownDocumentUrl('https://example.com/README.md.html')).toBe(false)
    expect(isMarkdownDocumentUrl('https://example.com/?file=README.md')).toBe(false)
    expect(isMarkdownDocumentUrl('orca-preview://grant/README.md')).toBe(false)
    expect(isMarkdownDocumentUrl('not a url')).toBe(false)
    expect(isMarkdownPath('/notes.txt')).toBe(false)
  })
})

describe('isMarkdownPath', () => {
  it.each([
    '/a.md',
    '/a.markdown',
    '/a.mdown',
    '/a.mkd',
    '/a.mkdn',
    '/a.mdwn',
    '/a.mdtxt',
    '/a.mdtext',
    '/a.MD',
    '/A.MarkDown',
    '/a.MDTEXT',
    '/dir.with.dots/a.b.md'
  ])('accepts %s', (path) => {
    expect(isMarkdownPath(path)).toBe(true)
  })

  it.each(['/a.mdx', '/a.mdc', '/md', '/a.mdd', '/a.mkdnx', '/docs/', '/a.md/', '/a.md.bak', '/'])(
    'rejects %s',
    (path) => {
      expect(isMarkdownPath(path)).toBe(false)
    }
  )
})

describe('renderMarkdownDocument', () => {
  it('renders GitHub-flavored tables, task lists and strikethrough', () => {
    const html = renderMarkdownDocument(
      '| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~'
    )
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
    expect(html).toMatch(/<input checked="" disabled="" type="checkbox"/)
    expect(html).toContain('<del>old</del>')
  })

  it('highlights fenced code in known languages and escapes the rest', () => {
    const html = renderMarkdownDocument('```ts\nconst a = 1\n```\n\n```nope\n<b>x</b>\n```')
    expect(html).toContain('<code class="hljs language-ts">')
    expect(html).toContain('<span class="hljs-keyword">const</span>')
    expect(html).toContain('<code class="hljs">&lt;b&gt;x&lt;/b&gt;</code>')
  })

  it('shows front matter as a YAML block instead of rules and text', () => {
    const html = renderMarkdownDocument('---\ntitle: Notes\n---\n# Body')
    expect(html).toMatch(/^<pre><code class="hljs language-yaml">/)
    expect(html).not.toContain('<hr>')
    expect(html).toContain('<h1>Body</h1>')
  })

  it('reads CRLF front matter and a ... terminator as YAML', () => {
    for (const source of [
      '---\r\ntitle: Notes\r\n---\r\n# Body',
      '---\ntitle: Notes\n...\n# Body'
    ]) {
      const html = renderMarkdownDocument(source)
      expect(html).toMatch(/^<pre><code class="hljs language-yaml">/)
      expect(html).toContain('title')
      expect(html).not.toContain('<hr>')
      expect(html).toContain('<h1>Body</h1>')
    }
  })

  it('does not treat an unclosed --- block as front matter', () => {
    const html = renderMarkdownDocument('---\ntitle: Notes\n\n# Body')
    expect(html).not.toContain('language-yaml')
    expect(html).toContain('<hr>')
    expect(html).toContain('<h1>Body</h1>')
  })
})

describe('assignHeadingIds', () => {
  it('uses GitHub anchors and numbers repeats', () => {
    expect(githubHeadingSlug(' Getting Started: v2.0! ')).toBe('getting-started-v20')
    const root = document.createElement('div')
    root.innerHTML = '<h2>Setup</h2><h2>Setup</h2><h3 id="kept">Other</h3><h4>?!</h4>'
    assignHeadingIds(root)
    expect(Array.from(root.querySelectorAll('h2, h3, h4'), (heading) => heading.id)).toEqual([
      'setup',
      'setup-1',
      'kept',
      ''
    ])
  })
})

describe('githubHeadingSlug', () => {
  it('keeps unicode letters, underscores and hyphens and drops other punctuation', () => {
    expect(githubHeadingSlug('Café Über')).toBe('café-über')
    expect(githubHeadingSlug('日本語 見出し')).toBe('日本語-見出し')
    expect(githubHeadingSlug('snake_case and well-known')).toBe('snake_case-and-well-known')
    expect(githubHeadingSlug('e\u0301 accent')).toBe('e\u0301-accent')
    expect(githubHeadingSlug('Q&A: "why"? (v2.0) #1 100%')).toBe('qa-why-v20-1-100')
  })
})
