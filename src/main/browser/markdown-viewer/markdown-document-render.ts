import { Marked } from 'marked'
import hljs from 'highlight.js/lib/common'

const FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderCodeBlock(text: string, lang: string | undefined): string {
  const language = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (language !== '' && hljs.getLanguage(language)) {
    const highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value
    return `<pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>\n`
  }
  return `<pre><code class="hljs">${escapeHtml(text)}</code></pre>\n`
}

const markdown = new Marked({
  gfm: true,
  renderer: {
    code: ({ text, lang }) => renderCodeBlock(text, lang)
  }
})

/** GitHub-flavored HTML for a markdown source. Unsanitized: the caller must sanitize it. */
export function renderMarkdownDocument(source: string): string {
  const frontMatter = FRONT_MATTER_PATTERN.exec(source)
  if (!frontMatter) {
    return markdown.parse(source, { async: false })
  }
  // Why: like GitHub, show front matter as YAML instead of letting `---` become rules and text.
  const body = source.slice(frontMatter[0].length)
  return renderCodeBlock(frontMatter[1] ?? '', 'yaml') + markdown.parse(body, { async: false })
}

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to dashes. */
export function githubHeadingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-')
}

export function assignHeadingIds(root: ParentNode): void {
  const seen = new Map<string, number>()
  for (const heading of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (heading.id) {
      continue
    }
    const slug = githubHeadingSlug(heading.textContent ?? '')
    if (slug === '') {
      continue
    }
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    heading.id = count === 0 ? slug : `${slug}-${count}`
  }
}
