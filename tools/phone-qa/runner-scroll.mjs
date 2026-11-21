import { run } from './lib.mjs';

await run('runner-scroll', async (t) => {
  const p = t.page;
  const cdp = await p.context().newCDPSession(p);
  const BOX = (k) => p.locator(`[data-qa="${k}"]`);

  const geo = () => p.evaluate(() => {
    const h = document.querySelector('header');
    const prev = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith('Prev'));
    const bar = prev ? prev.closest('div[class*="fixed"]') : null;
    const hb = h ? h.getBoundingClientRect() : null;
    const bb = bar ? bar.getBoundingClientRect() : null;
    return {
      sy: Math.round(window.scrollY), sx: Math.round(window.scrollX),
      docW: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight,
      headerTop: hb ? Math.round(hb.top) : null, headerBot: hb ? Math.round(hb.bottom) : null,
      barTop: bb ? Math.round(bb.top) : null, barBot: bb ? Math.round(bb.bottom) : null,
    };
  });

  const mark = () => p.evaluate(() => {
    document.querySelectorAll('[data-qa]').forEach((e) => e.removeAttribute('data-qa'));
    const cand = [...document.querySelectorAll('*')].filter((e) => {
      const s = getComputedStyle(e); const r = e.getBoundingClientRect();
      return /(auto|scroll)/.test(s.overflowY) && r.height > 20 && e.scrollHeight > e.clientHeight + 4;
    }).map((e) => ({ e, btns: e.querySelectorAll('button').length, len: (e.textContent || '').trim().length }));
    const opts = cand.filter((c) => c.btns >= 3).sort((a, b) => b.btns - a.btns)[0];
    const stem = cand.filter((c) => c !== opts).sort((a, b) => b.len - a.len)[0];
    const out = [{ k: 'root', ovs: getComputedStyle(document.documentElement).overscrollBehaviorY, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }];
    for (const [k, c] of [['stem', stem], ['opts', opts]]) {
      if (!c) continue;
      c.e.setAttribute('data-qa', k);
      out.push({ k, ch: c.e.clientHeight, sh: c.e.scrollHeight, ovs: getComputedStyle(c.e).overscrollBehaviorY, len: c.len, btns: c.btns });
    }
    return out;
  });

  const st = (k) => BOX(k).evaluate((e) => ({ st: Math.round(e.scrollTop), sh: e.scrollHeight, ch: e.clientHeight, top: Math.round(e.getBoundingClientRect().top), bot: Math.round(e.getBoundingClientRect().bottom) }));
  const setTop = (k, y) => BOX(k).evaluate((e, v) => { e.scrollTop = v; }, y);

  async function swipe(k) {
    const b = await BOX(k).boundingBox();
    if (!b) return;
    const x = Math.round(b.x + b.width / 2);
    const y1 = Math.round(b.y + b.height - 10), y2 = Math.round(b.y + 10);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y1 }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.round(y1 + ((y2 - y1) * i) / 6) }] });
      await p.waitForTimeout(25);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(450);
  }

  async function closeSheet() {
    const c = p.getByTitle('Close reasoning matrix');
    if (await c.count()) { await c.first().click().catch(() => {}); await p.waitForTimeout(300); }
  }

  async function auditQ(tag) {
    const m = await mark();
    const has = (k) => m.some((x) => x.k === k);
    t.rec(`${tag}-scrollers`, has('stem') && has('opts'), JSON.stringify(m.map((x) => ({ k: x.k, sh: x.sh, ch: x.ch, ovs: x.ovs, btns: x.btns }))));
    for (const x of m) t.rec(`${tag}-overscroll-${x.k}`, /contain|none/.test(x.ovs || ''), `overscroll-behavior-y=${x.ovs}`);
    const g0 = await geo();
    t.rec(`${tag}-no-doc-overflow`, g0.docW <= g0.vw && g0.sx === 0, `docScrollW=${g0.docW} vw=${g0.vw} scrollX=${g0.sx}`);
    if (has('opts')) {
      const so = await st('opts');
      t.rec(`${tag}-opts-above-bar`, so.bot <= (g0.barTop ?? 0) + 1, `optsBottom=${so.bot} barTop=${g0.barTop} barBot=${g0.barBot}`);
    }
    if (has('stem')) {
      const ss = await st('stem');
      t.rec(`${tag}-stem-below-header`, ss.top >= (g0.headerBot ?? 0) - 1, `stemTop=${ss.top} headerBot=${g0.headerBot}`);
    }
    for (const k of ['stem', 'opts']) {
      if (!has(k)) continue;
      await t.step(`${tag}-${k}-eval`, async () => {
        await setTop(k, 0); await p.waitForTimeout(200);
        const a = await st(k); const ga = await geo();
        await setTop(k, 999999); await p.waitForTimeout(350);
        const b = await st(k); const gb = await geo();
        await setTop(k, 0); await p.waitForTimeout(350);
        const c = await st(k); const gc = await geo();
        t.rec(`${tag}-${k}-eval-scrolls`, b.st > a.st, `scrollTop ${a.st}->${b.st} sh=${a.sh} ch=${a.ch} maxScroll=${a.sh - a.ch}`);
        t.rec(`${tag}-${k}-eval-back`, c.st <= 1, `scrollTop=${c.st}`);
        t.rec(`${tag}-${k}-body-fixed`, gb.sy === 0 && gc.sy === 0, `window.scrollY=${gb.sy},${gc.sy}`);
        t.rec(`${tag}-${k}-bars-fixed`, gb.headerTop === ga.headerTop && gb.barTop === ga.barTop, `headerTop ${ga.headerTop}->${gb.headerTop} barTop ${ga.barTop}->${gb.barTop}`);
      });
      await t.step(`${tag}-${k}-wheel`, async () => {
        const b = await BOX(k).boundingBox();
        if (!b) return;
        await setTop(k, 0); await p.waitForTimeout(150);
        await p.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 20));
        await p.mouse.wheel(0, 900); await p.waitForTimeout(400);
        const s1 = await st(k);
        await p.mouse.wheel(0, -1400); await p.waitForTimeout(400);
        const s2 = await st(k); const g = await geo();
        t.rec(`${tag}-${k}-wheel`, s1.st > 0, `scrollTop=${s1.st} of max=${s1.sh - s1.ch}`);
        t.rec(`${tag}-${k}-wheel-back`, s2.st <= 1 && g.sy === 0, `scrollTop=${s2.st} window.scrollY=${g.sy}`);
      });
      await t.step(`${tag}-${k}-touch`, async () => {
        await setTop(k, 0); await p.waitForTimeout(150);
        await swipe(k);
        const s1 = await st(k); const g = await geo();
        t.rec(`${tag}-${k}-touch`, s1.st > 0, `touchSwiped scrollTop=${s1.st} window.scrollY=${g.sy}`);
      });
      await closeSheet();
    }
    if (has('opts')) {
      await t.step(`${tag}-last-option`, async () => {
        await setTop('opts', 999999); await p.waitForTimeout(400);
        const r = await BOX('opts').locator('button').last().evaluate((e) => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; });
        const g = await geo();
        t.rec(`${tag}-last-option-clear`, r.bottom <= (g.barTop ?? 0), `lastOptBottom=${r.bottom} barTop=${g.barTop} optionH=${r.h}`);
        t.rec(`${tag}-option-taph`, r.h >= 40, `lastOptionHeight=${r.h}`);
        t.rec(`${tag}-no-bounce`, g.sy === 0, `window.scrollY=${g.sy} after overscroll to bottom`);
      });
    }
  }

  await t.step('setup-seed', async () => { await t.seed(); });

  await t.step('open-runner', async () => {
    await t.nav('Question Bank');
    let s = p.locator('button:visible').filter({ hasText: /^\s*Start\s*$/ });
    let n = await s.count();
    if (!n) { s = p.getByRole('button', { name: /^Start\b/ }); n = await s.count(); }
    t.rec('start-button', n > 0, `Start buttons=${n}`);
    if (n) { await s.first().click(); await p.waitForTimeout(1500); }
  });

  await t.step('immersive', async () => {
    const q = await p.getByText('Q 1/6', { exact: true }).count();
    const tab = await p.getByRole('button', { name: 'Today', exact: true }).count();
    const nav = await p.getByRole('button', { name: 'Open navigation menu' }).count();
    const bar = (await geo()).barTop;
    t.rec('immersive-header', q > 0, `Q 1/6 nodes=${q}`);
    t.rec('immersive-tabbar-hidden', tab === 0, `Today tab nodes=${tab}`);
    t.rec('immersive-topbar-hidden', nav === 0, `nav-menu buttons=${nav}`);
    t.rec('immersive-actionbar', bar !== null, `actionBarTop=${bar}`);
  });

  await t.step('goto-q3', async () => {
    const next = p.getByRole('button', { name: 'Next', exact: true });
    for (let i = 0; i < 2; i++) { await next.first().click(); await p.waitForTimeout(650); }
    t.rec('at-q3', (await p.getByText('Q 3/6', { exact: true }).count()) > 0, 'header Q 3/6');
  });
  await auditQ('q3');

  await t.step('goto-q6', async () => {
    const next = p.getByRole('button', { name: 'Next', exact: true });
    for (let i = 0; i < 3; i++) { await next.first().click(); await p.waitForTimeout(650); }
    t.rec('at-q6', (await p.getByText('Q 6/6', { exact: true }).count()) > 0, 'header Q 6/6');
  });
  await auditQ('q6');

  await t.step('small-360x640', async () => {
    await p.setViewportSize({ width: 360, height: 640 });
    await p.waitForTimeout(1000);
    const g = await geo();
    t.rec('small-no-overflow', g.docW <= 360, `docScrollW=${g.docW} vw=${g.vw} vh=${g.vh} scrollY=${g.sy}`);
    await auditQ('small360');
    const reach = await BOX('opts').evaluate((e) => {
      const out = [];
      for (const b of [...e.querySelectorAll('button')]) {
        b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect(); const c = e.getBoundingClientRect();
        out.push({ t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height), vis: r.top >= c.top - 1 && r.bottom <= c.bottom + 1 });
      }
      return { n: out.length, all: out.every((o) => o.vis), hMin: out.length ? Math.min(...out.map((o) => o.h)) : 0, sample: out };
    });
    const g2 = await geo();
    t.rec('small-options-reachable', reach.n >= 4 && reach.all, `options=${reach.n} allInView=${reach.all} minH=${reach.hMin} sample=${JSON.stringify(reach.sample)}`);
    t.rec('small-body-still', g2.sy === 0, `window.scrollY=${g2.sy} docScrollW=${g2.docW}`);
    await setTop('opts', 999999); await p.waitForTimeout(350);
    const last = await BOX('opts').locator('button').last().evaluate((e) => Math.round(e.getBoundingClientRect().bottom));
    const g3 = await geo();
    t.rec('small-last-option-clear', last <= (g3.barTop ?? 0), `lastOptBottom=${last} barTop=${g3.barTop}`);
    t.rec('small-header-border', g3.headerBot !== null && g3.barTop !== null && g3.headerBot < g3.barTop, `headerBot=${g3.headerBot} barTop=${g3.barTop}`);
  });
});
