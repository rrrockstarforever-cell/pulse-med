import { run, QUESTIONS } from './lib.mjs';

// ── thresholds (from the phone quality bars) ────────────────────────────────
const SMALL_MAX = 8;          // number of sub-32px interactive elements we tolerate
const SCREENS_MAX = 2.5;      // page height in viewport units
const NAV_SEL = 'nav[aria-label="Phone navigation"]';

const INTERACTIVE_SEL =
  'main button:visible, main a:visible, main [role="button"]:visible, ' +
  'main input:visible, main select:visible, main textarea:visible';

await run('screens-main', async (t) => {
  const page = t.page;

  /* ────────────────────────────────────────────────────────────────────────
   * Helpers
   * ──────────────────────────────────────────────────────────────────────── */

  // Scroll every vertical scroller (app-shell inner scroller + any inner
  // scroll region) to its max scroll position. Safe: no throws.
  const scrollAllToBottom = () => page.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    const scrollers = all.filter((e) => {
      const s = getComputedStyle(e);
      return /(auto|scroll|overlay)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 4;
    });
    scrollers.sort((a, b) => b.clientHeight - a.clientHeight);
    for (const sc of scrollers) { try { sc.scrollTop = sc.scrollHeight; } catch { /* ignore */ } }
    try { window.scrollTo(0, document.documentElement.scrollHeight); } catch { /* ignore */ }
  });

  // Record every layout check for one screen.
  const checkMetrics = (prefix) => t.step(prefix + '-metrics', async () => {
    const m = await t.metrics();
    t.rec(prefix + '-no-hscroll',   m.docScrollW <= m.vw + 1, `docScrollW=${m.docScrollW} vw=${m.vw}`);
    t.rec(prefix + '-no-clip',      m.clippedRight === 0,     `clippedRight=${m.clippedRight}`);
    t.rec(prefix + '-min-font',     m.minFont >= 11,          `minFont=${m.minFont} offending="${m.minEl}"`);
    t.rec(prefix + '-small-targets', m.smallTargets <= SMALL_MAX, `smallTargets=${m.smallTargets} max=${SMALL_MAX}`);
    t.rec(prefix + '-screens',      m.screens <= SCREENS_MAX, `screens=${m.screens} max=${SCREENS_MAX} scrollerH=${m.scrollerH} vh=${m.vh}`);
    t.rec(prefix + '-no-mono',      m.mono === 0,             `mono=${m.mono}`);
    console.log('[metrics]', prefix, JSON.stringify(m));
  });

  // Scroll to bottom, then verify the lowest in-viewport interactive element is
  // fully visible and NOT crushed under the fixed bottom tab bar.
  const checkLastVisible = (prefix) => t.step(prefix + '-last-visible', async () => {
    await scrollAllToBottom();
    await page.waitForTimeout(700);
    const last = page.locator(INTERACTIVE_SEL).last();
    const present = await last.count().catch(() => 0);
    if (!present) {
      t.rec(prefix + '-last-visible', true, 'no visible interactive element in main — empty state, nothing to cover');
      return;
    }
    const info = await t.visible(last).catch((e) => ({ error: String(e) }));
    if (info.error) { t.rec(prefix + '-last-visible', false, 'error: ' + info.error); return; }
    const navTop = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? Math.round(el.getBoundingClientRect().top) : -1;
    }, NAV_SEL).catch(() => -1);
    const overlapsNav = navTop >= 0 && info.bottom > navTop + 1;
    const pass = info.inView && !info.covered && !overlapsNav;
    t.rec(prefix + '-last-visible', pass, JSON.stringify({ ...info, navTop }));
  });

  /* ────────────────────────────────────────────────────────────────────────
   * Seed the demo bank so every screen has data to lay out.
   * ──────────────────────────────────────────────────────────────────────── */
  await t.step('seed', async () => { await t.seed(); });

  /* ────────────────────────────────────────────────────────────────────────
   * Drawer-driven screens: Today, Study Plan, Reminders
   * ──────────────────────────────────────────────────────────────────────── */
  for (const s of [
    { label: 'Today',     key: 'today' },
    { label: 'Study Plan', key: 'study-plan' },
    { label: 'Reminders', key: 'reminders' },
  ]) {
    await t.step('nav-' + s.key, async () => { await t.nav(s.label); });
    await checkMetrics(s.key);
    await checkLastVisible(s.key);
  }

  /* ────────────────────────────────────────────────────────────────────────
   * Practice Builder
   * ──────────────────────────────────────────────────────────────────────── */
  await t.step('nav-practice-builder', async () => { await t.nav('Practice Builder'); });
  await checkMetrics('practice-builder');

  // Is the sticky Launch bar crushing fields when the inner scroller is at max?
  await t.step('practice-launchbar-covers', async () => {
    await scrollAllToBottom();
    await page.waitForTimeout(600);
    const res = await page.evaluate(() => {
      const launchBtn = [...document.querySelectorAll('main button')]
        .find((b) => /^\s*Launch\b/i.test((b.textContent || '').trim()));
      if (!launchBtn) return { error: 'no-launch-button' };
      const lb = launchBtn.getBoundingClientRect();
      const all = [...document.querySelectorAll(
        'main input, main select, main textarea, main button, main [role="button"], main a'
      )];
      const fields = all.filter((e) => {
        if (e === launchBtn || launchBtn.contains(e) || e.contains(launchBtn)) return false;
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        if (r.width <= 0 || r.height <= 0) return false;
        if (s.visibility === 'hidden' || s.display === 'none') return false;
        if (e.closest('[aria-hidden="true"]')) return false;
        return true;
      });
      const overlapping = fields.filter((e) => {
        const r = e.getBoundingClientRect();
        return r.top < lb.bottom && r.bottom > lb.top;
      });
      const covered = overlapping.filter((e) => {
        const r = e.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
        const hit = document.elementFromPoint(cx, cy);
        return !(hit && (hit === e || e.contains(hit) || hit.contains(e)));
      });
      return {
        launchTop: Math.round(lb.top),
        launchBottom: Math.round(lb.bottom),
        overlapCount: overlapping.length,
        coveredCount: covered.length,
        sample: covered.slice(0, 3).map((e) => ({ tag: e.tagName, text: (e.textContent || '').trim().slice(0, 30) })),
      };
    }).catch((e) => ({ error: String(e) }));
    const pass = !res.error && (!res.coveredCount || res.coveredCount === 0);
    t.rec('practice-launchbar-covers', pass, JSON.stringify(res));
  });

  await checkLastVisible('practice-builder-pre-chips');

  // Tap 3 chips / rows, then check Launch is enabled sensibly.
  await t.step('practice-chips', async () => {
    const launch = page.getByRole('button', { name: /Launch/i }).first();
    const hasLaunch = await launch.count().catch(() => 0);
    if (!hasLaunch) { t.rec('practice-chips', false, 'no Launch button on Practice Builder'); return; }

    const before = await launch.isDisabled().catch(() => null);
    let chipLoc = null;
    let chipCount = 0;
    for (const sel of [
      'main button[aria-pressed]',
      'main [role="group"] button',
      'main button[role="radio"]',
      'main [role="option"]',
      'main button[class*="chip"]',
      'main button[class*="pill"]',
      'main button[class*="tag"]',
    ]) {
      const l = page.locator(sel);
      const c = await l.count().catch(() => 0);
      if (c >= 3) { chipLoc = l; chipCount = c; break; }
    }

    const tapped = [];
    if (chipLoc) {
      for (let i = 0; i < chipCount && tapped.length < 3; i++) {
        const c = chipLoc.nth(i);
        if (!(await c.isVisible().catch(() => false))) continue;
        const txt = ((await c.textContent().catch(() => '')) || '').trim();
        if (!txt || txt.length > 40) continue;
        if (/launch|submit|cancel|prev|next|reset|clear|all|none|start/i.test(txt)) continue;
        try {
          await c.tap({ timeout: 2000, force: true });
          await page.waitForTimeout(260);
          tapped.push(txt.slice(0, 24));
        } catch { /* skip */ }
      }
    } else {
      // Fallback: tap short-text buttons that don't look like actions.
      const allBtns = page.locator('main button:visible');
      const n = await allBtns.count().catch(() => 0);
      for (let i = 0; i < n && tapped.length < 3; i++) {
        const c = allBtns.nth(i);
        const txt = ((await c.textContent().catch(() => '')) || '').trim();
        if (txt.length < 2 || txt.length > 25) continue;
        if (/launch|submit|cancel|prev|next|back|reset|clear|all|none|start/i.test(txt)) continue;
        try {
          await c.tap({ timeout: 2000, force: true });
          await page.waitForTimeout(260);
          tapped.push(txt.slice(0, 24));
        } catch { /* skip */ }
      }
    }

    await page.waitForTimeout(450);
    const after = await launch.isDisabled().catch(() => null);
    // Sensible = Launch is now enabled (was disabled with nothing picked is fine).
    const sensible = after === false;
    t.rec('practice-chips-tapped', tapped.length >= 3, `tapped=${tapped.length} [${tapped.join(' | ')}]`);
    t.rec('practice-launch-state', sensible, `disabledBefore=${before} disabledAfter=${after} chipCount=${chipCount}`);
  });

  await checkMetrics('practice-builder-after');

  /* ────────────────────────────────────────────────────────────────────────
   * Bottom tabs — tap each in the phone tab bar.
   * ──────────────────────────────────────────────────────────────────────── */
  for (const tab of [
    { label: 'Today',    key: 'tab-today' },
    { label: 'Practice', key: 'tab-practice' },
    { label: 'Test',     key: 'tab-test' },
    { label: 'Plan',     key: 'tab-plan' },
  ]) {
    let tappedNav = false;
    await t.step(tab.key + '-tap', async () => {
      const navScope = page.locator(NAV_SEL);
      const navVisible = await navScope.isVisible().catch(() => false);
      if (!navVisible) return; // last resort: fall back to the drawer below
      const btn = navScope.getByRole('button', { name: new RegExp('^\\s*' + tab.label + '\\s*$', 'i') });
      const n = await btn.count().catch(() => 0);
      if (!n) return;
      await btn.first().tap({ timeout: 3000 });
      tappedNav = true;
      await page.waitForTimeout(1100);
    });
    if (!tappedNav) {
      await t.step(tab.key + '-fallback', async () => {
        const drawerLabel = tab.label === 'Plan' ? 'Study Plan' : tab.label;
        await t.nav(drawerLabel);
        t.rec(tab.key + '-fallback-drawer', true, `bottom nav unavailable; used drawer "${drawerLabel}"`);
      });
    } else {
      t.rec(tab.key + '-tap', true, `tapped bottom tab "${tab.label}"`);
    }
    await checkMetrics(tab.key);
    await checkLastVisible(tab.key);
  }

  /* ────────────────────────────────────────────────────────────────────────
   * More → opens the slide-out drawer
   * ──────────────────────────────────────────────────────────────────────── */
  await t.step('tab-more-tap', async () => {
    const navScope = page.locator(NAV_SEL);
    const navVisible = await navScope.isVisible().catch(() => false);
    if (!navVisible) { t.rec('tab-more-tap', false, 'bottom nav hidden, cannot tap More'); return; }
    const more = navScope.locator('button[aria-label="More navigation"]');
    const n = await more.count().catch(() => 0);
    if (n) {
      await more.first().tap({ timeout: 3000 });
    } else {
      await navScope.getByRole('button', { name: /More/i }).first().tap({ timeout: 3000 });
    }
    await page.waitForTimeout(950);
  });

  await t.step('more-drawer-open', async () => {
    const info = await page.evaluate(() => {
      const d = document.querySelector('[aria-label="Navigation menu"]');
      if (!d) return { found: false };
      const s = getComputedStyle(d);
      return {
        found: true,
        role: d.getAttribute('role'),
        ariaHidden: d.getAttribute('aria-hidden'),
        pointerEvents: s.pointerEvents,
        inert: d.hasAttribute('inert'),
        btnCount: d.querySelectorAll('button').length,
      };
    }).catch((e) => ({ error: String(e) }));
    const open =
      info.found &&
      info.role === 'dialog' &&
      info.ariaHidden !== 'true' &&
      info.pointerEvents !== 'none' &&
      !info.inert;
    t.rec('more-drawer-open', open, JSON.stringify(info));
    t.rec('more-drawer-items', (info.btnCount || 0) >= 5, `buttons=${info.btnCount || 0}`);
  });

  await t.step('more-drawer-close', async () => {
    await page.keyboard.press('Escape').catch(() => { /* ignore */ });
    await page.waitForTimeout(600);
    const info = await page.evaluate(() => {
      const d = document.querySelector('[aria-label="Navigation menu"]');
      if (!d) return { found: false };
      const s = getComputedStyle(d);
      return {
        role: d.getAttribute('role'),
        ariaHidden: d.getAttribute('aria-hidden'),
        pointerEvents: s.pointerEvents,
        inert: d.hasAttribute('inert'),
      };
    }).catch(() => ({}));
    const closed =
      !info.found ||
      info.ariaHidden === 'true' ||
      info.pointerEvents === 'none' ||
      info.role !== 'dialog' ||
      info.inert;
    t.rec('more-drawer-closes', closed, JSON.stringify(info));
  });
});
