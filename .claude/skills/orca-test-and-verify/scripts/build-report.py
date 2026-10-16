#!/usr/bin/env python3
"""Builds one self-contained before/after HTML page (images inlined) from a manifest.

    build-report.py <manifest.json> <out.html> [--fragment]

--fragment omits the doctype/html/head/body wrapper; Claude artifacts add their own skeleton.

Manifest (image paths are relative to the manifest file):
{
  "title": "Orca change proof",            # 2-4 words; becomes <title>
  "subtitle": "Build 1.4.x-local... - commits abc123..def456",
  "sections": [
    {
      "title": "New browser tabs open on the right",
      "body": "<p>What changed and why, in plain language. HTML allowed.</p>",
      "before": "before-browser.png", "beforeCaption": "...",
      "after": "after-browser.png", "afterCaption": "...",
      "extra": [{"src": "after-detail.png", "caption": "..."}]
    }
  ],
  "tests": [["Check", "Result"], ["Typecheck + lint gates", "Pass"]],
  "notes": "<p>Anything the reader must check by hand.</p>"
}
"""
# Keeps `str | None` annotations working on macOS's system Python 3.9.
from __future__ import annotations

import base64
import html
import json
import mimetypes
import os
import sys


def data_uri(base_dir: str, rel: str) -> str:
    path = os.path.join(base_dir, rel)
    mime = mimetypes.guess_type(path)[0] or "image/png"
    with open(path, "rb") as handle:
        return f"data:{mime};base64,{base64.b64encode(handle.read()).decode()}"


def figure(base_dir: str, src: str, caption: str, tag: str | None) -> str:
    label = f'<span class="tag {tag}">{tag.title()}</span>' if tag else ""
    return (
        f'<figure>{label}<img src="{data_uri(base_dir, src)}" alt="{html.escape(caption or src)}">'
        f"<figcaption>{caption or ''}</figcaption></figure>"
    )


def section(base_dir: str, item: dict) -> str:
    parts = [f"<section><h2>{html.escape(item['title'])}</h2>", item.get("body", "")]
    pair = [
        figure(base_dir, item[key], item.get(f"{key}Caption", ""), key)
        for key in ("before", "after")
        if item.get(key)
    ]
    if pair:
        parts.append(f'<div class="grid">{"".join(pair)}</div>')
    extra = [figure(base_dir, e["src"], e.get("caption", ""), None) for e in item.get("extra", [])]
    if extra:
        parts.append(f'<div class="grid">{"".join(extra)}</div>')
    parts.append("</section>")
    return "".join(parts)


STYLE = """
:root{--bg:#fafaf9;--card:#fff;--fg:#1c1917;--muted:#57534e;--line:#e7e5e4;--ok:#15803d;--old:#b45309;--code:#f5f5f4}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0c0a09;--card:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--line:#292524;--ok:#4ade80;--old:#fbbf24;--code:#292524}}
:root[data-theme="dark"]{--bg:#0c0a09;--card:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--line:#292524;--ok:#4ade80;--old:#fbbf24;--code:#292524}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:0 0 6px}
.sub{color:var(--muted);margin:0 0 24px}section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin:0 0 20px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px}@media (max-width:760px){.grid{grid-template-columns:1fr}}
figure{margin:0;min-width:0}figure img{width:100%;border:1px solid var(--line);border-radius:8px;display:block;cursor:zoom-in}
figcaption{font-size:13px;color:var(--muted);margin-top:6px}
.tag{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;margin-bottom:6px}
.before{color:var(--old);border:1px solid var(--old)}.after{color:var(--ok);border:1px solid var(--ok)}
code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:13px;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;font-size:14px;margin-top:8px}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.lb{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;padding:16px;cursor:zoom-out}.lb img{max-width:100%;max-height:100%}
"""

SCRIPT = """
const lb=document.getElementById('lb'),li=lb.querySelector('img');
document.querySelectorAll('figure img').forEach(i=>i.addEventListener('click',()=>{li.src=i.src;lb.style.display='flex'}));
lb.addEventListener('click',()=>lb.style.display='none');
"""


def main() -> None:
    manifest_path, out_path = sys.argv[1], sys.argv[2]
    fragment = "--fragment" in sys.argv[3:]
    base_dir = os.path.dirname(os.path.abspath(manifest_path))
    with open(manifest_path) as handle:
        manifest = json.load(handle)
    rows = manifest.get("tests") or []
    table = ""
    if rows:
        head, *body = rows
        table = (
            "<section><h2>How this was tested</h2><table><tr>"
            + "".join(f"<th>{html.escape(c)}</th>" for c in head)
            + "</tr>"
            + "".join("<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in body)
            + "</table></section>"
        )
    notes = f"<section>{manifest['notes']}</section>" if manifest.get("notes") else ""
    head = f"<title>{html.escape(manifest['title'])}</title><style>{STYLE}</style>"
    if not fragment:
        head = (
            '<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f"{head}</head><body>"
        )
    page = (
        f"{head}<main>"
        f"<h1>{html.escape(manifest['title'])}</h1>"
        f'<p class="sub">{manifest.get("subtitle", "")} &middot; click a screenshot to enlarge.</p>'
        + "".join(section(base_dir, item) for item in manifest["sections"])
        + table
        + notes
        + f'</main><div class="lb" id="lb"><img alt=""></div><script>{SCRIPT}</script>'
        + ("" if fragment else "</body></html>")
    )
    with open(out_path, "w") as handle:
        handle.write(page)
    print(f"{out_path} ({len(page) // 1024} KB)")


if __name__ == "__main__":
    main()
