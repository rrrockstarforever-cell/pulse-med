import { run, QUESTIONS } from './lib.mjs';

await run('runner-small-and-dark', async (t) => {
  const P = t.page, rec = t.rec;

  const openTo = async (label) => {
    const menu = P.locator('[aria-label="Navigation menu"]');
    if (!(await menu.isVisible().catch(() => false))) {
      await P.getByRole('button', { name: 'Open navigation menu' }).first().click().catch(() => {});
      await P.waitForTimeout(450);
    }
    await P.locator('[aria-label="Navigation menu"] button', { hasText: label }).first().click().catch(() => {});
    await P.waitForTimeout(1200);
  };

  const startRun = async () => {
    await openTo('Question Bank');
    await P.getByRole('button', { name: 'Start', exact: true }).first().click().catch(() => {});
    await P.waitForTimeout(1300);
  };

  const qaudit = (scanEq = false) => P.evaluate((scanEq) => {
    const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const cr = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return +((hi + 0.05) / (lo + 0.05)).toFixed(2); };
    const bgOf = (el) => { let e = el; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; e = e.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
    const tile = (b) => [...b.querySelectorAll('div')].some((d) => d.children.length === 0 && d.textContent.trim().length === 1 && /[A-E]/.test(d.textContent.trim()));
    const textDiv = (b) => { const ds = [...b.querySelectorAll('div')].filter((d) => d.children.length === 0 && d.textContent.trim().length > 8 && !/^[A-E]$/.test(d.textContent.trim())); return ds.sort((x, y) => y.textContent.length - x.textContent.length)[0] || b; };
    const R = (e) => { const r = e.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), h: Math.round(r.height), w: Math.round(r.width) }; };
    const colour = (e) => { const cs = getComputedStyle(e); const col = parse(cs.color); const bg = bgOf(e); return { font: +parseFloat(cs.fontSize).toFixed(1), color: cs.color, bg: `rgb(${bg.r},${bg.g},${bg.b})`, ratio: col ? cr(col, bg) : null }; };
    const vw = innerWidth, vh = innerHeight;
    const optBtns = [...document.querySelectorAll('button')].filter((b) => !b.closest('header') && tile(b));
    let scroller = null;
    if (optBtns[0]) { let e = optBtns[0].parentElement; while (e && e !== document.body) { const st = getComputedStyle(e); if (/(auto|scroll)/.test(st.overflowY) && e.scrollHeight > e.clientHeight + 2) { scroller = e; break; } e = e.parentElement; } }
    const reach = optBtns.map((b) => { b.scrollIntoView({ block: 'nearest' }); const rr = R(b); const top = document.elementFromPoint((rr.l + rr.r) / 2, Math.min(Math.max((rr.t + rr.b) / 2, 0), vh - 1)); return { visible: rr.t >= 0 && rr.b <= vh, covered: !(top && (b === top || b.contains(top))) }; });
    const opts = optBtns.map((b) => { const td = textDiv(b); return { ...R(b), ...colour(td), text: (td.textContent || '').trim().slice(0, 26) }; });
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    let last = null;
    if (optBtns.length) { const b = optBtns[optBtns.length - 1]; const rr = R(b); const top = document.elementFromPoint((rr.l + rr.r) / 2, Math.min(Math.max((rr.t + rr.b) / 2, 0), vh - 1)); last = { ...rr, visible: rr.t >= 0 && rr.b <= vh, covered: !(top && (b === top || b.contains(top))) }; }
    const stemP = [...document.querySelectorAll('p')].filter((e) => e.textContent.trim().length > 40).sort((a, b) => b.textContent.length - a.textContent.length)[0];
    const h2 = [...document.querySelectorAll('h2')].find((e) => e.textContent.trim().length > 8);
    const acts = [...document.querySelectorAll('button')].filter((b) => /^(Prev|Skip|Next|Submit)$/i.test(b.textContent.trim()) && b.offsetParent !== null).map((b) => ({ name: b.textContent.trim(), ...R(b) }));
    let overlaps = 0; for (let i = 0; i < acts.length; i++) for (let j = i + 1; j < acts.length; j++) { const a = acts[i], c = acts[j]; if (a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b) overlaps++; }
    const eq = [];
    if (scanEq) { const all = [...document.querySelectorAll('body *')]; for (const e of all) { const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') continue; if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const col = parse(cs.color); if (!col) continue; const bg = bgOf(e); if (cr(col, bg) < 1.15) eq.push({ color: cs.color, bg: `rgb(${bg.r},${bg.g},${bg.b})`, text: e.textContent.trim().slice(0, 20) }); if (eq.length >= 5) break; } }
    const small40 = [...document.querySelectorAll('button,a,[role=button],input,select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 40 || r.width < 40); }).length;
    return { vw, vh, docScrollW: document.documentElement.scrollWidth, rootH: document.documentElement.scrollHeight, optCount: optBtns.length, opts, reach, last, stem: stemP ? colour(stemP) : null, h2: h2 ? colour(h2) : null, acts, overlaps, eq, small40 };
  }, scanEq);

  await t.seed();

  await t.step('light-today', async () => {
    await openTo('Today');
    const m = await t.metrics();
    rec('today-overflow', m.docScrollW <= m.vw, `docScrollW=${m.docScrollW} vw=${m.vw}`);
    rec('today-min-font', m.minFont >= 11, `minFont=${m.minFont}px on "${m.minEl}"`);
    const s = await qaudit(false);
    rec('today-tap-targets', s.small40 === 0, `${s.small40} controls under 40px`);
    rec('today-fixed-chrome', m.scrollerClass.length > 0 || m.screens >= 1, `scroller="${m.scrollerClass}" screens=${m.screens}`);
  });

  await t.step('runner-light', async () => {
    await startRun();
    const navVis = await P.getByRole('button', { name: 'Open navigation menu' }).first().isVisible().catch(() => false);
    rec('runner-immersive-topbar', !navVis, `app-bar menu visible=${navVis}`);
    const moreVis = await P.getByRole('button', { name: 'More' }).first().isVisible().catch(() => false);
    rec('runner-immersive-tabbar', !moreVis, `bottom tab 'More' visible=${moreVis}`);

    for (let i = 0; i < 6; i++) {
      const a = await qaudit(false);
      const exp = QUESTIONS[i].options.length;
      rec(`q${i + 1}-overflow`, a.docScrollW <= a.vw, `doc=${a.docScrollW} vw=${a.vw}`);
      rec(`q${i + 1}-no-body-scroll`, a.rootH <= a.vh + 2, `rootH=${a.rootH} vh=${a.vh}`);
      rec(`q${i + 1}-option-count`, a.optCount === exp, `${a.optCount}/${exp}`);
      rec(`q${i + 1}-option-heights`, a.opts.length === exp && a.opts.every((o) => o.h >= 40), `heights=${a.opts.map((o) => o.h).join(',')}`);
      rec(`q${i + 1}-option-reachable`, a.reach.length > 0 && a.reach.every((r) => r.visible && !r.covered), a.reach.map((r) => (r.visible && !r.covered ? 'ok' : 'BAD')).join(''));
      rec(`q${i + 1}-last-option-clear`, !!a.last && a.last.visible && !a.last.covered, a.last ? `top=${a.last.t} bot=${a.last.b} vh=${a.vh} vis=${a.last.visible} cov=${a.last.covered}` : 'none');
      rec(`q${i + 1}-stem-font`, !!a.stem && a.stem.font >= 14 && !!a.h2 && a.h2.font >= 14, `vignette=${a.stem && a.stem.font}px prompt=${a.h2 && a.h2.font}px`);
      rec(`q${i + 1}-option-contrast`, a.opts.length > 0 && a.opts.every((o) => o.ratio >= 4.5), `ratios=${a.opts.map((o) => o.ratio).join(',')}`);
      rec(`q${i + 1}-actionbar`, a.acts.length >= 4 && a.acts.every((x) => x.h >= 40) && a.overlaps === 0, `${a.acts.map((x) => x.name + ':' + x.h + 'px').join(' ')} overlaps=${a.overlaps}`);
      if (i < 5) { await P.getByRole('button', { name: 'Next' }).first().click().catch(() => {}); await P.waitForTimeout(400); }
    }
  });

  await t.step('palette-sheet', async () => {
    await P.getByTitle('Open question palette').first().click().catch(() => {});
    await P.waitForTimeout(500);
    const pbtns = P.locator('button[title^="Question "]');
    const pc = await pbtns.count();
    const ph = await pbtns.evaluateAll((es) => es.map((e) => Math.round(e.getBoundingClientRect().height))).catch(() => []);
    rec('palette-count', pc >= 6, `palette buttons=${pc}`);
    rec('palette-targets', ph.length > 0 && ph.every((h) => h >= 40), `heights=${ph.join(',')}`);
    const j = P.locator('button[title="Question 3"]');
    if (await j.count()) { await j.first().click().catch(() => {}); await P.waitForTimeout(500); }
    const hdr = await P.locator('header').first().innerText().catch(() => '');
    rec('palette-jump', /Q\s*3\s*\/\s*6/.test(hdr), `header="${hdr.replace(/\s+/g, ' ').slice(0, 40)}"`);
    const cl = P.getByTitle('Close question palette');
    if (await cl.count()) { await cl.first().click().catch(() => {}); await P.waitForTimeout(300); }
  });

  await t.step('dark-toggle', async () => {
    await P.getByTitle('Return to modules').first().click().catch(() => {});
    await P.waitForTimeout(1000);
    await P.getByRole('button', { name: 'Open navigation menu' }).first().click().catch(() => {});
    await P.waitForTimeout(500);
    let toggled = false;
    const cands = [
      P.getByRole('button', { name: /dark\s*mode|dark\s*theme|appearance|theme/i }),
      P.getByRole('switch', { name: /dark/i }),
      P.locator('button:has(svg.lucide-moon), button:has(svg.lucide-sun)'),
      P.getByText(/^dark mode$/i),
    ];
    for (const c of cands) { if (await c.count()) { await c.first().click({ timeout: 2000 }).catch(() => {}); toggled = true; break; } }
    rec('dark-toggle-found', toggled, toggled ? 'clicked a theme control in drawer' : 'no theme control in drawer');
    await P.waitForTimeout(800);
    await P.keyboard.press('Escape').catch(() => {});
    await P.waitForTimeout(400);
    const st = await P.evaluate(() => {
      const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const bgOf = (el) => { let e = el; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; e = e.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
      const el = document.elementFromPoint(innerWidth / 2, 4) || document.body;
      const bg = bgOf(el);
      return { htmlDark: document.documentElement.classList.contains('dark'), pageLum: +lum(bg).toFixed(3), bg: `rgb(${bg.r},${bg.g},${bg.b})`, cls: document.documentElement.className.slice(0, 60) };
    });
    rec('dark-active', st.htmlDark || st.pageLum < 0.3, `htmlDark=${st.htmlDark} pageLum=${st.pageLum} bg=${st.bg} cls="${st.cls}"`);
  });

  await t.step('runner-dark', async () => {
    await startRun();
    const d = await qaudit(true);
    rec('dark-overflow', d.docScrollW <= d.vw, `doc=${d.docScrollW} vw=${d.vw}`);
    rec('dark-stem-contrast', !!d.stem && d.stem.ratio >= 4.5, d.stem ? `font=${d.stem.font} color=${d.stem.color} bg=${d.stem.bg} ratio=${d.stem.ratio}` : 'no stem');
    rec('dark-prompt-contrast', !!d.h2 && d.h2.ratio >= 4.5, d.h2 ? `font=${d.h2.font} color=${d.h2.color} ratio=${d.h2.ratio}` : 'no h2');
    rec('dark-option-contrast', d.opts.length > 0 && d.opts.every((o) => o.ratio >= 4.5), `ratios=${d.opts.map((o) => o.ratio).join(',')}`);
    rec('dark-white-on-white', d.eq.length === 0, `equal-colour elements=${d.eq.length} ${JSON.stringify(d.eq.slice(0, 3))}`);

    const pick = P.locator('button').filter({ hasText: QUESTIONS[0].options[1].text.slice(0, 22) });
    if (await pick.count()) { await pick.first().click({ timeout: 3000 }).catch(() => {}); await P.waitForTimeout(700); }
    const closeM = P.getByTitle('Close reasoning matrix');
    if (await closeM.count()) { await closeM.first().click().catch(() => {}); await P.waitForTimeout(400); }
    const rev = await qaudit(true);
    const oa = rev.opts[0], ob = rev.opts[1];
    rec('dark-correct-option', !!oa && oa.ratio >= 4.5, oa ? `color=${oa.color} bg=${oa.bg} ratio=${oa.ratio} "${oa.text}"` : 'missing');
    rec('dark-wrong-option', !!ob && ob.ratio >= 4.5, ob ? `color=${ob.color} bg=${ob.bg} ratio=${ob.ratio} "${ob.text}"` : 'missing');
    const badges = await P.getByText('CORRECT!').count();
    rec('dark-reveal-present', badges > 0, `CORRECT! badges=${badges}`);
    rec('dark-white-on-white-after-answer', rev.eq.length === 0, `equal-colour elements=${rev.eq.length} ${JSON.stringify(rev.eq.slice(0, 3))}`);
  });
});
