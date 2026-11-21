// Shared kit for phone QA scripts. Usage in a script: import { run } from './lib.mjs'; await run('name', async (t) => {...});
import { chromium, devices } from 'playwright';
import fs from 'fs';
const BASE = process.env.QA_BASE || 'http://localhost:3100';
const LONG = 'A 58-year-old man with a 30-pack-year smoking history presents with progressive exertional dyspnoea, productive cough for three months, and unintentional weight loss of 6 kg. On examination he has clubbing, a blood pressure of 150/90 mmHg, and reduced breath sounds over the right lower zone with dullness to percussion. Serum calcium is 12.8 mg/dL, phosphate 2.1 mg/dL and PTH is suppressed. Chest CT shows a 5 cm centrally located cavitating mass in the right hilum with mediastinal lymphadenopathy. Biopsy shows keratin pearls and intercellular bridges. Which of the following is the most likely mechanism of his hypercalcaemia?';
const OPTS = ['Ectopic secretion of parathyroid hormone-related peptide by the tumour','Ectopic secretion of parathyroid hormone by the tumour cells','Osteolytic metastases releasing calcium directly from bone','Increased 1-alpha hydroxylase activity in tumour-associated macrophages','Vitamin D intoxication from over-the-counter supplements'];
const mk = (i, stem, n) => ({ id: 'phone-test-' + i, examType: 'INI-CET', subject: 'Medicine', subtopic: 'Oncology', cognitiveTier: 'Clinical 2-Step', stem, questionText: stem.slice(-60), options: OPTS.slice(0, n).map((t, k) => ({ id: 'ABCDE'[k], text: t })), correctOption: 'A', boardPearl: 'Squamous cell lung cancer -> PTHrP -> hypercalcaemia.', explanation: 'Squamous cell carcinoma of lung secretes PTHrP causing humoral hypercalcaemia of malignancy. PTH is suppressed.' });
export const QUESTIONS = [mk(1, 'Which hormone is raised in humoral hypercalcaemia of malignancy?', 4), mk(2, 'A 45-year-old man presents with crushing chest pain radiating to the left arm for 30 minutes, with diaphoresis and ST elevation in II, III and aVF. Which artery is most likely occluded?', 4), mk(3, LONG, 5), mk(4, LONG, 5), mk(5, 'Drug of choice for hypercalcaemia of malignancy?', 5), mk(6, LONG + ' ' + LONG, 5)];
export async function run(name, fn, opts = {}) {
  const results = []; const t = {
    results,
    rec(id, pass, detail = '') { results.push({ id, pass: !!pass, detail: String(detail).slice(0, 400) }); console.log((pass ? 'PASS ' : 'FAIL ') + id + (detail ? ' :: ' + String(detail).slice(0, 200) : '')); },
    async step(id, f) { try { const r = await f(); return r; } catch (e) { t.rec(id, false, 'EXCEPTION ' + (e.message || e).toString().split('\n')[0]); } },
  };
  const browser = await chromium.launch();
  const ctx = await browser.newContext(opts.viewport ? { ...devices['Pixel 7'], viewport: opts.viewport, screen: opts.viewport } : { ...devices['Pixel 7'] });
  await ctx.addInitScript(() => { const W = window.WebSocket; window.WebSocket = function (u, p) { if (String(u).includes('24678')) return { close() {}, send() {}, addEventListener() {}, removeEventListener() {} }; return new W(u, p); }; window.WebSocket.prototype = W.prototype; });
  const page = await ctx.newPage(); t.page = page; t.browser = browser;
  const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200))); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(1500);
  const skip = page.getByRole('button', { name: 'Skip guide' }); if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(400); }
  t.seed = async () => { await page.evaluate(async (qs) => { const m = await import('/src/utils/moduleStore.ts'); await m.saveModule({ id: 'phone-test', exam: 'INI-CET', mode: 'TUTOR', questions: qs }); }, QUESTIONS); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1200); };
  // go to a screen by its sidebar label (opens the drawer on phones). Labels: Today, Study Plan, Reminders, Practice Builder, Question Bank, Active Test Runner, Image Question Review, Performance Analytics, Test Reviews, Mistakes & Spaced Review, Highlights & Memory, Syllabus Tracker, Clinical AI Tutor, PDF Reader & OCR, Clinical Evidence Browser, QA & Benchmark, Sync & Backup, AI Subscriptions & OCR
  t.nav = async (label) => { await page.getByRole('button', { name: 'Open navigation menu' }).click(); await page.waitForTimeout(450); await page.locator('[aria-label="Navigation menu"] button', { hasText: label }).first().click(); await page.waitForTimeout(1500); };
  // layout metrics of the current screen
  t.metrics = async () => page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight; const all = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; });
    const scroller = [...document.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4).sort((a, b) => b.clientHeight - a.clientHeight)[0];
    let minFont = 99, minEl = ''; for (const e of all) { if (!e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const f = parseFloat(getComputedStyle(e).fontSize); if (f < minFont) { minFont = f; minEl = (e.textContent || '').trim().slice(0, 30); } }
    const clippedRight = all.filter((e) => e.getBoundingClientRect().right > vw + 1 && !e.closest('[aria-hidden="true"]') && !String(e.className).includes('pointer-events-none')).length;
    const smallTargets = [...document.querySelectorAll('button,a,[role=button],input,select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32); }).length;
    const mono = all.filter((e) => /mono/i.test(getComputedStyle(e).fontFamily) && e.textContent.trim()).length;
    return { vw, vh, docScrollW: document.documentElement.scrollWidth, scrollerH: scroller ? scroller.scrollHeight : vh, screens: scroller ? +(scroller.scrollHeight / vh).toFixed(2) : +(document.documentElement.scrollHeight / vh).toFixed(2), minFont, minEl, clippedRight, smallTargets, mono, scrollerClass: scroller ? String(scroller.className).slice(0, 80) : '' };
  });
  // is element fully visible and not covered by another element at its centre
  t.visible = async (locator) => locator.evaluate((e) => { const r = e.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const top = document.elementFromPoint(cx, Math.min(Math.max(cy, 0), innerHeight - 1)); return { inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, covered: !(top && (e === top || e.contains(top))), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; });
  try { await fn(t); } catch (e) { t.rec('SCRIPT', false, 'UNCAUGHT ' + (e.message || e).toString().split('\n')[0]); }
  if (errors.length) t.rec('console-errors', false, errors.slice(0, 3).join(' | '));
  fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true }); fs.writeFileSync(new URL(`./results/${name}.json`, import.meta.url), JSON.stringify(results, null, 1));
  await browser.close(); console.log(`DONE ${name}: ${results.filter((r) => r.pass).length} pass / ${results.filter((r) => !r.pass).length} fail`);
}
