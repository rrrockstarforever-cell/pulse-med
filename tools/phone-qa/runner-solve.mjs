import { run } from './lib.mjs';

await run('runner-solve', async (t) => {
  const page = t.page;
  const wait = (ms) => page.waitForTimeout(ms);
  const opts = () => page.locator('main button[aria-pressed]');
  const isVis = async (loc) => loc.isVisible().catch(() => false);
  const counter = async () => {
    const txt = await page.locator('header').innerText().catch(() => '');
    const m = txt.match(/Q\s*(\d+)\s*\/\s*6/);
    return m ? +m[1] : null;
  };
  const clickTitle = async (title) => {
    const l = page.locator(`button[title="${title}"]`);
    if (await l.count()) { await l.first().click(); await wait(250); return true; }
    return false;
  };
  const measure = async () => page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const hdr = document.querySelector('header');
    const nav = [...document.querySelectorAll('button')].filter((b) => /^(Prev|Skip|Next|Submit)$/.test((b.textContent || '').trim()));
    const top = hdr ? Math.round(hdr.getBoundingClientRect().bottom) : 0;
    const bottom = nav.length ? Math.round(Math.min(...nav.map((b) => b.getBoundingClientRect().top))) : vh;
    const main = document.querySelector('main') || document.body;
    const cand = [...main.querySelectorAll('p,h2')].filter((e) => {
      const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && (e.textContent || '').trim().length > 20;
    });
    const stem = cand.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
    const stemH = stem ? Math.round(stem.getBoundingClientRect().height) : 0;
    const stemFont = stem ? parseFloat(getComputedStyle(stem).fontSize) : 0;
    const os = [...main.querySelectorAll('button[aria-pressed]')];
    const optBottoms = os.map((o) => Math.round(o.getBoundingClientRect().bottom));
    const optHeights = os.map((o) => Math.round(o.getBoundingClientRect().height));
    const fontOf = (el) => {
      let best = el, len = -1;
      for (const e of el.querySelectorAll('*')) {
        const n = (e.textContent || '').trim().length;
        if (n > len) { len = n; best = e; }
      }
      return parseFloat(getComputedStyle(best).fontSize);
    };
    const minOptFont = os.length ? Math.min(...os.map(fontOf)) : 99;
    const last = os[os.length - 1];
    let scroller = null, el = last;
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 4) { scroller = el; break; }
      el = el.parentElement;
    }
    if (!scroller) scroller = document.scrollingElement || document.documentElement;
    const before = scroller ? { sh: scroller.scrollHeight, ch: scroller.clientHeight, st: Math.round(scroller.scrollTop) } : null;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    return {
      vw, vh, docScrollW: document.documentElement.scrollWidth, top, bottom, stemH, stemFont,
      optBottoms, optHeights, minOptFont,
      scroller: scroller ? String(scroller.className || scroller.tagName).slice(0, 80) : '', before,
    };
  });

  await t.step('seed-start', async () => {
    await page.evaluate(() => localStorage.clear());
    await t.seed();
    await t.nav('Question Bank');
    const starts = page.getByRole('button', { name: 'Start', exact: true });
    const n = await starts.count();
    t.rec('bank-start-present', n > 0, `count=${n}`);
    if (n) {
      await starts.last().scrollIntoViewIfNeeded();
      await starts.last().click();
    }
    await wait(1300);
    const txt = await page.locator('header').innerText().catch(() => '');
    t.rec('runner-open', /Q\s*1\s*\/\s*6/.test(txt), txt.slice(0, 120));
  });

  await t.step('immersive', async () => {
    const top = page.getByRole('button', { name: 'Open navigation menu' });
    const more = page.getByRole('button', { name: 'More', exact: true });
    const a = await isVis(top), b = await isVis(more);
    t.rec('runner-immersive', !a && !b, `topVisible=${a} moreVisible=${b}`);
  });

  for (let q = 1; q <= 6; q++) {
    await t.step(`q${q}`, async () => {
      const cur = await counter();
      t.rec(`q${q}-counter-start`, cur === q, `counter=${cur}`);

      const m = await measure();
      await wait(350);
      const vis = await t.visible(opts().last());
      const safePass = vis.inView && !vis.covered && vis.top >= m.top && vis.bottom <= m.bottom;
      t.rec(`q${q}-layout`, safePass, JSON.stringify({
        safeTop: m.top, safeBottom: m.bottom, stemH: m.stemH, optBottoms: m.optBottoms,
        scroller: m.scroller, last: vis, optHeights: m.optHeights, minOptFont: m.minOptFont, stemFont: m.stemFont,
      }));
      t.rec(`q${q}-no-hoverflow`, m.docScrollW <= m.vw, `doc=${m.docScrollW} vw=${m.vw}`);
      t.rec(`q${q}-fonts`, m.minOptFont >= 14 && m.stemFont >= 14, `opt=${m.minOptFont} stem=${m.stemFont}`);
      t.rec(`q${q}-targets`, Math.min(...m.optHeights) >= 40, `minH=${Math.min(...m.optHeights)} heights=${m.optHeights}`);

      const first = opts().first();
      await first.scrollIntoViewIfNeeded();
      await first.tap();
      await wait(650);
      const aria = await first.getAttribute('aria-pressed');
      const text = await first.innerText();
      const disabled = await first.isDisabled();
      const state = /CORRECT!|YOUR PICK|LOCKED IN/i.test(text);
      const fit = await first.evaluate((el) => ({
        sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight,
        h: Math.round(el.getBoundingClientRect().height), txt: el.innerText.slice(0, 100),
      }));
      t.rec(`q${q}-select`, aria === 'true' && state && (disabled || /YOUR PICK|LOCKED IN/i.test(text)), JSON.stringify({ aria, disabled, state, fit }));
      t.rec(`q${q}-select-fit`, fit.sw <= fit.cw + 2, JSON.stringify({ sw: fit.sw, cw: fit.cw, h: fit.h }));

      const panel = page.locator('#reasoning-matrix');
      if (await isVis(panel)) {
        const dims = await panel.evaluate((el) => { const s = { sh: el.scrollHeight, ch: el.clientHeight }; el.scrollTop = el.scrollHeight; return s; });
        await wait(250);
        const closed = await clickTitle('Close reasoning matrix');
        await wait(300);
        t.rec(`q${q}-explain`, closed && !(await isVis(panel)), JSON.stringify({ dims, closed }));
      } else t.rec(`q${q}-explain`, false, 'sheet not visible');

      const flag = page.locator('header button[aria-pressed]').first();
      const fb = await flag.getAttribute('aria-pressed').catch(() => null);
      await flag.click();
      await wait(250);
      const fa = await flag.getAttribute('aria-pressed').catch(() => null);
      t.rec(`q${q}-flag`, fb !== fa, `before=${fb} after=${fa}`);

      if (q === 2) {
        await clickTitle('Open question palette');
        await wait(300);
        const palCount = await page.locator('button[title^="Question "]').evaluateAll((els) => els.filter((e) => {
          const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
        }).length);
        t.rec('palette-count', palCount === 6, `count=${palCount}`);
        const jumped = await page.evaluate(() => {
          const e = [...document.querySelectorAll('button[title^="Question 4"]')].find((b) => {
            const r = b.getBoundingClientRect(); const s = getComputedStyle(b);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
          });
          if (e) { e.click(); return true; }
          return false;
        });
        await wait(450);
        const c4 = await counter();
        t.rec('palette-jump-q4', jumped && c4 === 4, `jumped=${jumped} counter=${c4}`);
        await clickTitle('Close question palette');
        await wait(250);
        await page.getByRole('button', { name: 'Prev', exact: true }).click();
        await wait(450);
        const c3 = await counter();
        t.rec('prev-works', c3 === 3, `counter=${c3}`);
        return;
      }

      if (q === 6) {
        page.once('dialog', (d) => d.accept().catch(() => {}));
        await page.getByRole('button', { name: 'Submit', exact: true }).last().click();
        await wait(1500);
        const body = await page.locator('body').innerText().catch(() => '');
        t.rec('results-screen', /performance|review|score|accuracy|correct|answered/i.test(body), body.slice(0, 160));
        const top = page.getByRole('button', { name: 'Open navigation menu' });
        const more = page.getByRole('button', { name: 'More', exact: true });
        const a = await isVis(top), b = await isVis(more);
        t.rec('results-bars-back', a && b, `top=${a} more=${b}`);
        const rm = await t.metrics();
        t.rec('results-no-overflow', rm.docScrollW <= rm.vw, JSON.stringify(rm));
        return;
      }

      if (q === 3) {
        await page.getByRole('button', { name: 'Skip', exact: true }).click();
        await wait(450);
        const c = await counter();
        t.rec('skip-works', c === 4, `counter=${c}`);
        return;
      }

      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await wait(450);
      const c = await counter();
      t.rec(`q${q}-next`, c === q + 1, `counter=${c}`);
    });
  }
});
