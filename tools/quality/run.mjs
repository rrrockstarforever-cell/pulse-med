// Headless runner for the quality grid. No browser: Node with a localStorage shim and a fetch that points at a private
// app server. Edits made while it runs do not affect it, and the result goes to a JSON file.
//
//   node --import tsx tools/quality/run.mjs --ids a,b,c --out out.json [--parallel 4] [--max 12] [--base http://localhost:3100]
//   node --import tsx tools/quality/run.mjs --grid all --out out.json
import fs from 'node:fs';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const BASE = arg('base', 'http://localhost:3100');
const OUT = arg('out', 'quality-out.json');
const PARALLEL = Number(arg('parallel', '4'));
const MAX = Number(arg('max', '0'));
const PLAN_CACHE = arg('plans', 'quality-plans.json');

// ---- browser shims ----
const store = new Map();
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(PLAN_CACHE, 'utf8')))) store.set(k, v); } catch { /* no cache yet */ }
const mkStorage = (m) => ({
  getItem: (k) => (m.has(k) ? m.get(k) : null),
  setItem: (k, v) => { m.set(k, String(v)); },
  removeItem: (k) => { m.delete(k); },
  key: (i) => [...m.keys()][i] ?? null,
  get length() { return m.size; },
});
globalThis.localStorage = mkStorage(store);
globalThis.sessionStorage = mkStorage(new Map());
store.set('ai.activeProvider', arg('provider', 'deeprelay'));
store.set('ai.model.deeprelay', 'deeprelay/deepseek-v4.1-flash');
if (arg('model', '')) store.set('ai.model.' + arg('provider', 'deeprelay'), arg('model', ''));
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  if (typeof input === 'string' && input.startsWith('/')) input = BASE + input;
  else if (input instanceof URL && input.pathname.startsWith('/') && input.origin === 'null') input = BASE + input.pathname + input.search;
  return realFetch(input, init);
};

const t = await import('./batch-test.mjs');
const grid = await import('./grid.mjs');

const wanted = arg('ids', '');
const cases = (arg('grid', '') === 'all' ? grid.GRID : grid.GRID.filter((c) => wanted.split(',').includes(c.id)));
if (!cases.length) { console.error('No cases selected.'); process.exit(2); }

const savePlans = () => {
  const plans = Object.fromEntries([...store.entries()].filter(([k]) => k.startsWith('pulse.quality.plan')));
  fs.writeFileSync(PLAN_CACHE, JSON.stringify(plans));
};
const started = Date.now();
console.log(`running ${cases.length} cases, ${PARALLEL} at once, base ${BASE}`);
const run = await t.runMatrix(cases, {
  parallel: PARALLEL,
  maxCount: MAX,
  onDone: (r) => {
    savePlans();
    // Save each case the moment it finishes, so its pictures can be checked while the other cases are still running.
    try { fs.writeFileSync(OUT.replace(/\.json$/, '') + `.case-${r.id}.json`, JSON.stringify(r, null, 1)); } catch { /* optional */ }
    console.log(r.error ? `${r.id}: ERROR ${r.error}` : `${r.id}: kept ${r.kept}/${r.target} wrong ${r.wrong} amb ${r.ambiguous} low ${r.lowRelevance} style ${r.styleBad ?? '-'} ${r.seconds}s`);
  },
});
fs.writeFileSync(OUT, JSON.stringify(run, null, 1));
// Time taken by each step of generation (the app keeps it in window.__stageLog), for finding what is slow.
try { fs.writeFileSync(OUT.replace(/\.json$/, '') + '.stages.json', JSON.stringify(globalThis.__stageLog ?? [])); } catch { /* optional */ }
console.log(`done in ${Math.round((Date.now() - started) / 1000)}s -> ${OUT}\n` + t.summarize(run));
process.exit(0);
