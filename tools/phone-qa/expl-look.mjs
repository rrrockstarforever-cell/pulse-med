import { run } from './lib.mjs';
await run('expl-look', async (t) => {
  const p = t.page; await t.seed(); await t.nav('Question Bank');
  await p.locator('button:visible').filter({ hasText: /^\s*Start\s*$/ }).first().click(); await p.waitForTimeout(1500);
  const cdp = await p.context().newCDPSession(p);
  const swipe = async (y1, y2, steps = 10) => { await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y:y1}]}); for(let i=1;i<=steps;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:200,y:y1+(y2-y1)*i/steps}]}); await p.waitForTimeout(14);} await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await p.waitForTimeout(600); };
  const hdr = async () => (await p.getByText(/^Q \d\/6$/).first().textContent().catch(()=>null));
  await swipe(600, 520); t.rec('short-swipe-ignored', (await hdr())==='Q 1/6', await hdr());
  await swipe(650, 200); t.rec('long-swipe-next', (await hdr())==='Q 2/6', await hdr());
  await swipe(250, 700); t.rec('long-swipe-prev', (await hdr())==='Q 1/6', await hdr());
  // go to Q3 (long vignette + 5 options) by buttons, answer, scroll options to explanation pill with a long drag
  const next = p.getByRole('button', { name: 'Next', exact: true }); for (let i=0;i<2;i++){ await next.first().click(); await p.waitForTimeout(500); }
  await p.getByText('Ectopic secretion of parathyroid hormone-related peptide', { exact: false }).first().click(); await p.waitForTimeout(500);
  await swipe(650, 250, 12); const h = await hdr(); t.rec('scroll-drag-no-question-change', h==='Q 3/6', h);
  const pill = p.getByRole('button', { name: /See explanation/i }); t.rec('pill-reachable', await pill.count()>0, 'pill');
  await pill.first().scrollIntoViewIfNeeded(); await pill.first().click(); await p.waitForTimeout(700);
  await p.screenshot({ path: 'tools/phone-qa/results/ex-light-rationale.png' });
  for (const [n,label] of [['pearl',/High-Yield/i],['evidence',/Evidence/i]]) { await p.getByRole('button', { name: label }).first().click().catch(()=>{}); await p.waitForTimeout(400); await p.screenshot({ path: `tools/phone-qa/results/ex-light-${n}.png` }); }
  await p.getByRole('button', { name: /Rationale/i }).first().click().catch(()=>{});
  await p.evaluate(()=>document.documentElement.classList.add('dark')); await p.waitForTimeout(500);
  await p.screenshot({ path: 'tools/phone-qa/results/ex-dark-rationale.png' });
  const sheet = await p.locator('#reasoning-matrix').evaluate(e=>{const r=e.getBoundingClientRect(); return {top:Math.round(r.top),bottom:Math.round(r.bottom),vh:innerHeight, minFont:Math.min(...[...e.querySelectorAll('*')].filter(x=>[...x.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(x=>parseFloat(getComputedStyle(x).fontSize)))}});
  t.rec('sheet-geometry', sheet.top < sheet.vh*0.2, JSON.stringify(sheet));
});
