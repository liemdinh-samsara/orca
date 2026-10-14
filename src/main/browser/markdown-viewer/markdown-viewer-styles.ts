// Why GitHub's palette: this is web content in a browser tab, styled the way a markdown file looks on GitHub.
export const MARKDOWN_VIEWER_STYLES = `
:root {
  color-scheme: light dark;
  --md-fg: #1f2328;
  --md-muted: #59636e;
  --md-border: #d1d9e0;
  --md-canvas: #ffffff;
  --md-subtle: #f6f8fa;
  --md-accent: #0969da;
  --md-code-bg: rgba(129, 139, 152, 0.12);
  --hl-keyword: #cf222e;
  --hl-title: #8250df;
  --hl-constant: #0550ae;
  --hl-string: #0a3069;
  --hl-variable: #953800;
  --hl-comment: #59636e;
  --hl-tag: #116329;
  --hl-added-fg: #116329;
  --hl-added-bg: #dafbe1;
  --hl-removed-fg: #82071e;
  --hl-removed-bg: #ffebe9;
}
@media (prefers-color-scheme: dark) {
  :root {
    --md-fg: #f0f6fc;
    --md-muted: #9198a1;
    --md-border: #3d444d;
    --md-canvas: #0d1117;
    --md-subtle: #151b23;
    --md-accent: #4493f8;
    --md-code-bg: rgba(101, 108, 118, 0.2);
    --hl-keyword: #ff7b72;
    --hl-title: #d2a8ff;
    --hl-constant: #79c0ff;
    --hl-string: #a5d6ff;
    --hl-variable: #ffa657;
    --hl-comment: #9198a1;
    --hl-tag: #7ee787;
    --hl-added-fg: #aff5b4;
    --hl-added-bg: #033a16;
    --hl-removed-fg: #ffdcd7;
    --hl-removed-bg: #67060c;
  }
}
html[data-orca-markdown-view] body {
  margin: 0;
  background: var(--md-canvas);
  color: var(--md-fg);
}
html[data-orca-markdown-view='rendered'] body > pre { display: none; }
html[data-orca-markdown-view='source'] .orca-markdown-body { display: none; }
html[data-orca-markdown-view='source'] body > pre { margin: 0; padding: 16px 20px; }
.orca-markdown-body {
  box-sizing: border-box;
  max-width: 980px;
  margin: 0 auto;
  padding: 32px 48px 64px;
  font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
  word-wrap: break-word;
}
.orca-markdown-body > :first-child { margin-top: 0 !important; }
.orca-markdown-body :is(p, blockquote, ul, ol, dl, table, pre, details) { margin: 0 0 16px; }
.orca-markdown-body :is(h1, h2, h3, h4, h5, h6) {
  margin: 24px 0 16px;
  font-weight: 600;
  line-height: 1.25;
}
.orca-markdown-body :is(h1, h2) { padding-bottom: 0.3em; border-bottom: 1px solid var(--md-border); }
.orca-markdown-body h1 { font-size: 2em; }
.orca-markdown-body h2 { font-size: 1.5em; }
.orca-markdown-body h3 { font-size: 1.25em; }
.orca-markdown-body h4 { font-size: 1em; }
.orca-markdown-body h5 { font-size: 0.875em; }
.orca-markdown-body h6 { font-size: 0.85em; color: var(--md-muted); }
.orca-markdown-body a { color: var(--md-accent); text-decoration: none; }
.orca-markdown-body a:hover { text-decoration: underline; }
.orca-markdown-body :is(ul, ol) { padding-left: 2em; }
.orca-markdown-body li + li { margin-top: 0.25em; }
.orca-markdown-body li:has(> input[type='checkbox']) { list-style: none; }
.orca-markdown-body li > input[type='checkbox'] { margin: 0 0.35em 0.25em -1.4em; vertical-align: middle; }
.orca-markdown-body blockquote {
  padding: 0 1em;
  color: var(--md-muted);
  border-left: 0.25em solid var(--md-border);
}
.orca-markdown-body hr {
  height: 0.25em;
  margin: 24px 0;
  padding: 0;
  border: 0;
  background: var(--md-border);
}
.orca-markdown-body img { max-width: 100%; box-sizing: content-box; }
.orca-markdown-body table { display: block; width: max-content; max-width: 100%; overflow: auto; border-collapse: collapse; }
.orca-markdown-body :is(th, td) { padding: 6px 13px; border: 1px solid var(--md-border); }
.orca-markdown-body th { font-weight: 600; }
.orca-markdown-body tr:nth-child(2n) { background: var(--md-subtle); }
.orca-markdown-body :is(code, kbd, pre) {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 85%;
}
.orca-markdown-body code {
  padding: 0.2em 0.4em;
  border-radius: 6px;
  background: var(--md-code-bg);
}
.orca-markdown-body pre {
  padding: 16px;
  overflow: auto;
  line-height: 1.45;
  border-radius: 6px;
  background: var(--md-subtle);
}
.orca-markdown-body pre code { padding: 0; font-size: 100%; background: transparent; }
.hljs-doctag, .hljs-keyword, .hljs-meta .hljs-keyword, .hljs-template-tag, .hljs-template-variable,
.hljs-type, .hljs-variable.language_ { color: var(--hl-keyword); }
.hljs-title, .hljs-title.class_, .hljs-title.class_.inherited__, .hljs-title.function_ { color: var(--hl-title); }
.hljs-attr, .hljs-attribute, .hljs-literal, .hljs-meta, .hljs-number, .hljs-operator, .hljs-variable,
.hljs-selector-attr, .hljs-selector-class, .hljs-selector-id, .hljs-section { color: var(--hl-constant); }
.hljs-regexp, .hljs-string, .hljs-meta .hljs-string { color: var(--hl-string); }
.hljs-built_in, .hljs-symbol, .hljs-bullet, .hljs-params { color: var(--hl-variable); }
.hljs-comment, .hljs-code, .hljs-formula { color: var(--hl-comment); }
.hljs-name, .hljs-quote, .hljs-selector-tag, .hljs-selector-pseudo { color: var(--hl-tag); }
.hljs-section, .hljs-strong { font-weight: 600; }
.hljs-emphasis { font-style: italic; }
.hljs-addition { color: var(--hl-added-fg); background: var(--hl-added-bg); }
.hljs-deletion { color: var(--hl-removed-fg); background: var(--hl-removed-bg); }
.orca-markdown-toggle {
  position: fixed;
  top: 12px;
  right: 16px;
  padding: 3px 10px;
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: var(--md-muted);
  background: var(--md-subtle);
  border: 1px solid var(--md-border);
  border-radius: 6px;
  cursor: pointer;
  opacity: 0.85;
}
.orca-markdown-toggle:hover { color: var(--md-fg); opacity: 1; }
`
