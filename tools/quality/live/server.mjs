// Live progress window for the quality / image tests. Local only: it reads log files and shows them in a page.
//   node tools/quality/live/server.mjs --log a.log,b.log [--json a.json,b.json] [--port 3199] [--title "..."]
// Several runs can be shown together (comma-separated). Open http://localhost:3199 . It changes nothing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const LOGS = arg('log', '').split(',').filter(Boolean);
const JSONS = arg('json', '').split(',').filter(Boolean);
const PORT = Number(arg('port', '3199'));
const TITLE = arg('title', 'Test progress');
const here = path.dirname(fileURLToPath(import.meta.url));

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// The test processes that are still running (looked up every few seconds, not on every refresh).
let procCache = { at: 0, value: null };
const findProcesses = () => {
  if (Date.now() - procCache.at < 5000) return procCache.value;
  let value = null;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'quality.run.mjs' } | Select-Object ProcessId, CommandLine) | ConvertTo-Json -Compress"],
      { encoding: 'utf8', timeout: 8000 }).trim();
    if (out) {
      const list = [].concat(JSON.parse(out));
      const ps = list.map((o) => {
        const cmd = String(o.CommandLine || '');
        const pick = (n) => (cmd.match(new RegExp(`--${n}\\s+("[^"]+"|\\S+)`)) || [])[1]?.replace(/"/g, '');
        return { provider: pick('provider'), model: pick('model'), parallel: Number(pick('parallel') || 4), ids: (pick('ids') || '').split(',').filter(Boolean) };
      });
      if (ps.length) value = { runs: ps.length, provider: ps[0].provider, model: ps[0].model, parallel: ps.reduce((a, p) => a + p.parallel, 0), ids: ps.flatMap((p) => p.ids) };
    }
  } catch { /* no process or PowerShell not allowed */ }
  procCache = { at: Date.now(), value };
  return value;
};

const parse = () => {
  const lines = LOGS.flatMap((f) => read(f).split(/\r?\n/));
  const cases = new Map();
  let planLines = 0, total = 0, doneRuns = 0;
  for (const line of lines) {
    let m;
    if ((m = line.match(/^running (\d+) cases, (\d+) at once/))) total += Number(m[1]);
    else if (/^\[plan\]/.test(line)) planLines++;
    else if ((m = line.match(/^(\S+): kept (\d+)\/(\d+) wrong (\d+) amb (\d+) low (\d+) style (\S+) (\d+)s/))) {
      cases.set(m[1], { id: m[1], state: 'done', kept: +m[2], target: +m[3], wrong: +m[4], ambiguous: +m[5], low: +m[6], style: m[7], seconds: +m[8] });
    } else if ((m = line.match(/^(\S+): ERROR (.*)/))) {
      cases.set(m[1], { id: m[1], state: 'error', error: m[2].slice(0, 200) });
    } else if (/^done in/.test(line)) doneRuns++;
  }
  const finished = LOGS.length && doneRuns >= LOGS.length ? `All ${doneRuns} run(s) finished` : null;
  // Per-case picture numbers are in the result files, written when each run ends.
  let images = null;
  for (const f of JSONS) {
    const raw = read(f);
    if (!raw) continue;
    try {
      const j = JSON.parse(raw);
      images = images || {};
      for (const r of j.results || []) images[r.id] = { images: r.images, dangling: r.dangling, relevance: r.avgRelevance };
    } catch { /* partial file */ }
  }
  const proc = findProcesses();
  const ids = proc?.ids?.length ? [...new Set([...proc.ids, ...cases.keys()])] : [...cases.keys()];
  const order = ids.map((id) => cases.get(id) || { id, state: 'waiting' });
  // A run starts the next case as soon as one finishes, so the first unfinished cases are the running ones.
  let slots = proc?.parallel || 4;
  for (const c of order) if (c.state === 'waiting' && slots > 0 && proc && !finished) { c.state = 'running'; slots--; }
  for (const c of order) if (images && images[c.id]) Object.assign(c, images[c.id]);
  let mtime = 0;
  for (const f of LOGS) { try { mtime = Math.max(mtime, fs.statSync(f).mtimeMs); } catch { /* no log yet */ } }
  return {
    title: TITLE, now: Date.now(), processAlive: !!proc && !finished, process: proc,
    finished, planCalls: planLines, total: total || order.length, cases: order,
    lastLogChange: mtime, tail: lines.filter(Boolean).slice(-14),
    totals: order.reduce((a, c) => (c.state === 'done' ? { kept: a.kept + c.kept, target: a.target + c.target, wrong: a.wrong + c.wrong, ambiguous: a.ambiguous + c.ambiguous } : a), { kept: 0, target: 0, wrong: 0, ambiguous: 0 }),
  };
};

http.createServer((req, res) => {
  if (req.url.startsWith('/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(parse()));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(read(path.join(here, req.url.startsWith('/gallery') ? 'gallery.html' : 'index.html')));
}).listen(PORT, '127.0.0.1', () => console.log(`Live progress on http://localhost:${PORT}`));
