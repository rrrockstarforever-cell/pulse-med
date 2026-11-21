// Builds gallery.html: every question that got a picture, shown with its picture, so a person can judge the match.
//   node tools/quality/live/gallery.mjs a.json,b.json   (result files of tools/quality/run.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = (process.argv[2] || '').split(',').filter(Boolean);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const items = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const r of j.results) for (const q of r.questions || []) if (q.image) items.push({ case: r.id, q });
}
const cards = items.map(({ case: c, q }, i) => {
  const right = (q.options.find((o) => o.id === q.correctOption) || {}).text;
  const text = `${q.stem || ''} ${q.questionText || ''}`.trim();
  return `<article id="n${i + 1}"><div class="pic"><img src="http://localhost:3100${q.image}" alt=""></div>
<div class="txt"><b>#${i + 1}</b> <span class="c">${esc(c)}</span><p>${esc(text.slice(0, 330))}</p><p class="a">Answer: ${esc(q.correctOption)}. ${esc(right)}</p>
<p class="m">${esc(q.figureModality || '')} · search: ${esc(q.figureQuery || '')}</p><p class="m">${esc(q.imageCaption || '')}</p></div></article>`;
}).join('\n');
fs.writeFileSync(path.join(here, 'gallery.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Picture review</title>
<style>:root{--bg:#f6f7f9;--card:#fff;--text:#16202a;--muted:#5b6672;--line:#e2e6ea}@media(prefers-color-scheme:dark){:root{--bg:#0f1418;--card:#161d23;--text:#e7edf2;--muted:#98a4af;--line:#27323b}}
body{margin:0;background:var(--bg);color:var(--text);font:13px/1.4 system-ui,sans-serif;padding:14px}h1{font-size:18px;margin:0 0 10px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:10px}article{display:flex;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px}
.pic{flex:0 0 170px}.pic img{width:170px;height:170px;object-fit:contain;background:#0002;border-radius:6px}.txt{min-width:0}.txt p{margin:3px 0}.c{color:var(--muted)}.a{font-weight:600}.m{color:var(--muted);font-size:11px;word-break:break-word}</style></head>
<body><h1>Picture review: ${items.length} questions with a picture</h1><main>${cards}</main></body></html>`);
console.log(`gallery.html with ${items.length} questions`);
