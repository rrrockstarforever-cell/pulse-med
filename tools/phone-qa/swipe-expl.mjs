import { run } from './lib.mjs';
await run('swipe-expl', async (t) => {
  const p = t.page; await t.seed(); await t.nav('Question Bank');
  await p.locator('button:visible').filter({ hasText: /^\s*Start\s*$/ }).first().click(); await p.waitForTimeout(1500);
  const cdp = await p.context().newCDPSession(p);
  const swipe = async (x, y1, y2) => { await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:y1}]}); for(let i=1;i<=8;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y1+(y2-y1)*i/8}]}); await p.waitForTimeout(12);} await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await p.waitForTimeout(600); };
  const hdr = async () => (await p.getByText(/^Q \d\/6$/).first().textContent().catch(()=>null));
  t.rec('start', (await hdr())==='Q 1/6', await hdr());
  // answer Q1 (option A text)
  await p.getByText('Ectopic secretion of parathyroid hormone-related peptide', {exact:false}).first().click().catch(()=>{}); await p.waitForTimeout(500);
  const pill = p.getByRole('button', { name: /See explanation/i });
  t.rec('pill-shown', await pill.count() > 0, 'pill count '+await pill.count());
  t.rec('no-auto-sheet', await p.getByText(/Rationale/i).count() === 0, 'rationale nodes '+await p.getByText(/Rationale/i).count());
  await p.screenshot({ path: 'tools/phone-qa/results/sw-answered.png' });
  if (await pill.count()) { await pill.first().click(); await p.waitForTimeout(600); t.rec('sheet-on-tap', await p.getByText(/Rationale/i).count() > 0, 'after tap'); await p.screenshot({ path: 'tools/phone-qa/results/sw-sheet.png' }); await p.mouse.click(200,60); await p.waitForTimeout(500); }
  await swipe(200, 600, 250); t.rec('swipe-up-next', (await hdr())==='Q 2/6', await hdr());
  await swipe(200, 250, 600); t.rec('swipe-down-prev', (await hdr())==='Q 1/6', await hdr());
  await swipe(200, 250, 600); t.rec('swipe-down-first-noop', (await hdr())==='Q 1/6', await hdr());
});
