import { run } from './lib.mjs';
await run('final-check', async (t) => {
  const p = t.page;
  for (const [n, label] of [['syl','Syllabus Tracker'],['tut','Clinical AI Tutor'],['pdf','PDF Reader & OCR']]) {
    await t.step('nav-'+n, async () => { await t.nav(label); await p.screenshot({ path: `tools/phone-qa/results/fc-${n}.png` }); const m = await t.metrics(); t.rec(n+'-no-hscroll', m.docScrollW <= m.vw, JSON.stringify({sw:m.docScrollW, screens:m.screens, minFont:m.minFont, small:m.smallTargets})); });
  }
  await t.seed(); await t.nav('Question Bank');
  await p.locator('button:visible').filter({ hasText: /^\s*Start\s*$/ }).first().click(); await p.waitForTimeout(1500);
  const cdp = await p.context().newCDPSession(p);
  const swipe = async (y1, y2) => { await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y:y1}]}); for(let i=1;i<=8;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:200,y:y1+(y2-y1)*i/8}]}); await p.waitForTimeout(12);} await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await p.waitForTimeout(600); };
  const hdr = async () => (await p.getByText(/^Q \d\/6$/).first().textContent().catch(()=>null));
  for (let i=0;i<5;i++){ await swipe(650,250); }
  t.rec('reached-last', (await hdr())==='Q 6/6', await hdr());
  await swipe(650,250); t.rec('swipe-up-on-last-noop', (await hdr())==='Q 6/6', await hdr());
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.evaluate(()=>{ document.documentElement.classList.add('dark'); try{localStorage.setItem('theme','dark')}catch{} }); await p.waitForTimeout(600);
  await p.screenshot({ path: 'tools/phone-qa/results/fc-dark-q6.png' });
});
