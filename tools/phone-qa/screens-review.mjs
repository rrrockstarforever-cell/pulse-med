import { run, QUESTIONS } from './lib.mjs';

// Secret-looking strings that must never be rendered in the clear on Settings.
const SECRET = /(sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|gsk_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|xoxb-[A-Za-z0-9-]{10,})/;
const HEADER_SEL = 'main [aria-expanded]';

/** Fonts / mono / clipped-right measured inside <main> only, so the closed (aria-hidden, off-screen) drawer can never pollute the audit. */
async function scopedMetrics(page) {
  return page.evaluate(() => {
    const vw = innerWidth;
    const main = document.querySelector('main') || document.body;
    const ok = (e) => {
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || s.display === 'none') return false;
      if (parseFloat(s.opacity) === 0) return false;
      if (e.closest('[aria-hidden="true"]')) return false;
      return true;
    };
    let minFont = 99;
    let minEl = '';
    let mono = 0;
    let monoEl = '';
    let clipped = 0;
    const clippedSample = [];
    for (const e of main.querySelectorAll('*')) {
      if (!ok(e)) continue;
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (hasText) {
        const f = parseFloat(s.fontSize);
        if (f < minFont) {
          minFont = f;
          minEl = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 36);
        }
        if (/mono/i.test(s.fontFamily)) {
          mono += 1;
          if (!monoEl) monoEl = (e.textContent || '').trim().slice(0, 30);
        }
      }
      if (r.right > vw + 1 && !String(e.className).includes('pointer-events-none')) {
        clipped += 1;
        if (clippedSample.length < 3) {
          clippedSample.push(((e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22) || e.tagName) + ' right=' + Math.round(r.right));
        }
      }
    }
    return {
      vw,
      docScrollW: document.documentElement.scrollWidth,
      minFont: minFont === 99 ? 0 : minFont,
      minEl,
      mono,
      monoEl,
      clipped,
      clippedSample,
    };
  });
}

/** Tap targets currently on screen, measured against the 40px phone bar. */
async function tapTargets(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    const bad = [];
    for (const e of main.querySelectorAll('button, a, [role="button"], input, select, textarea')) {
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || s.display === 'none') continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      if (r.height < 40) {
        bad.push(((e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26) || e.tagName) + '=' + Math.round(r.height));
      }
    }
    return { count: bad.length, sample: bad.slice(0, 5) };
  });
}

/** Scroll the inner app scroller (or the window) to the very end. */
async function scrollEnd(page) {
  return page.evaluate(() => {
    const s = [...document.querySelectorAll('*')]
      .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4)
      .sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (s) s.scrollTop = s.scrollHeight;
    else window.scrollTo(0, document.documentElement.scrollHeight);
    return s ? String(s.className).slice(0, 60) : 'window';
  });
}

/** Bottom-most rendered glyph vs the top of the fixed bottom tab bar. */
async function endClearance(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Phone navigation"]');
    const navTop = nav && nav.getBoundingClientRect().height > 0 ? Math.round(nav.getBoundingClientRect().top) : innerHeight;
    const main = document.querySelector('main') || document.body;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let worst = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent || !node.textContent.trim()) continue;
      const p = node.parentElement;
      if (!p) continue;
      const s = getComputedStyle(p);
      if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) continue;
      if (p.closest('[aria-hidden="true"]')) continue;
      let fixed = false;
      for (let a = p; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).position === 'fixed') { fixed = true; break; }
      }
      if (fixed) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (!worst || rect.bottom > worst.bottom) {
        worst = { bottom: Math.round(rect.bottom), text: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 36) };
      }
    }
    return { navTop, worstBottom: worst ? worst.bottom : null, worstText: worst ? worst.text : '', vh: innerHeight };
  });
}

/** If the immersive runner is still up (no top bar / no drawer button), back out of it. */
async function ensureShell(t) {
  const page = t.page;
  const menu = page.getByRole('button', { name: 'Open navigation menu' });
  if ((await menu.count()) > 0 && (await menu.first().isVisible().catch(() => false))) return true;
  for (const rx of [/^back$/i, /back to/i, /^exit/i, /^close$/i]) {
    const b = page.getByRole('button', { name: rx }).first();
    if ((await b.count()) > 0 && (await b.isVisible().catch(() => false))) {
      await b.click().catch(() => {});
      await page.waitForTimeout(1000);
      break;
    }
  }
  const menu2 = page.getByRole('button', { name: 'Open navigation menu' });
  return (await menu2.count()) > 0 && (await menu2.first().isVisible().catch(() => false));
}

/** Expanded/collapsed state + panel geometry for one tagged accordion header. */
async function panelState(page, idx) {
  return page.evaluate((i) => {
    const btn = document.querySelector('[data-qa-acc="' + i + '"]');
    if (!btn) return { expanded: null, panelH: -1, panelW: -1, text: '' };
    const expanded = btn.getAttribute('aria-expanded');
    const id = btn.getAttribute('aria-controls');
    let panel = id ? document.getElementById(id) : null;
    if (!panel) {
      const cands = [];
      let n = btn.nextElementSibling;
      while (n) { cands.push(n); n = n.nextElementSibling; }
      const p = btn.parentElement;
      let m = p ? p.nextElementSibling : null;
      while (m) { cands.push(m); m = m.nextElementSibling; }
      panel = cands.find((c) => (c.innerText || '').trim().length > 0) || cands[0] || null;
    }
    if (!panel) return { expanded, panelH: -1, panelW: -1, text: '' };
    const r = panel.getBoundingClientRect();
    return {
      expanded,
      panelH: Math.round(r.height),
      panelW: Math.round(r.width),
      text: (panel.innerText || panel.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    };
  }, idx);
}

/** Standard screen audit: overflow / clipping / font / mono / length / tap targets / end-of-list clearance. */
async function auditScreen(t, key, label, opts = {}) {
  const page = t.page;
  await t.step(key + '-nav', async () => {
    await ensureShell(t);
    await t.nav(label);
    await page.waitForTimeout(600);
  });

  await t.step(key + '-metrics', async () => {
    await page.evaluate(() => {
      const s = [...document.querySelectorAll('*')]
        .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4)
        .sort((a, b) => b.clientHeight - a.clientHeight)[0];
      if (s) s.scrollTop = 0;
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(350);
    const base = await t.metrics();
    const m = await scopedMetrics(page);
    t.rec(key + '-noHScroll', m.docScrollW <= m.vw && base.docScrollW <= m.vw, `docScrollW=${m.docScrollW} vw=${m.vw}`);
    t.rec(key + '-clippedRight', m.clipped === 0, `clipped=${m.clipped}${m.clippedSample.length ? ' :: ' + m.clippedSample.join(' | ') : ''}`);
    t.rec(key + '-minFont', m.minFont >= 11, `minFont=${m.minFont}px on "${m.minEl}"`);
    t.rec(key + '-mono', m.mono === 0, `mono=${m.mono}${m.monoEl ? ' on "' + m.monoEl + '"' : ''}`);
    t.rec(key + '-screens', opts.allowTall ? true : base.screens <= 3, `screens=${base.screens} scroller="${base.scrollerClass}"${opts.allowTall ? ' (tall screen allowed here)' : ''}`);
    const taps = await tapTargets(page);
    t.rec(key + '-tap40', taps.count === 0, `under40=${taps.count}${taps.count ? ' :: ' + taps.sample.join(' | ') : ''}`);
    const txt = await page.evaluate(() => {
      const mm = document.querySelector('main');
      return ((mm && mm.innerText) || '').replace(/\s+/g, ' ').trim();
    });
    t.rec(key + '-rendered', txt.length > 20, `visibleText=${txt.length} chars :: "${txt.slice(0, 70)}"`);
  });

  await t.step(key + '-endClearance', async () => {
    const scroller = await scrollEnd(page);
    await page.waitForTimeout(600);
    const c = await endClearance(page);
    const pass = c.worstBottom === null || c.worstBottom <= c.navTop + 1;
    t.rec(key + '-endClearance', pass, `navTop=${c.navTop} worstTextBottom=${c.worstBottom} "${c.worstText}" scroller=${scroller}`);
  });
}

/** Open and close every accordion header; content must appear when open and no key material title be shown. */
async function auditAccordions(t, key) {
  const page = t.page;
  await t.step(key + '-accordions', async () => {
    const total = await page.locator(HEADER_SEL).count();
    if (!total) {
      t.rec(key + '-accHeaders', false, 'no [aria-expanded] accordion headers found in <main>');
      return;
    }
    const snap = await page.evaluate((sel) => {
      const nodes = [...document.querySelectorAll(sel)];
      nodes.forEach((n, i) => n.setAttribute('data-qa-acc', String(i)));
      return nodes.map((n, i) => ({
        i,
        text: (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        expanded: n.getAttribute('aria-expanded'),
      }));
    }, HEADER_SEL);
    t.rec(key + '-accHeaders', true, `headers=${total} :: ${snap.map((s) => s.text.slice(0, 14) || '#' + s.i).join(' / ')}`);

    const locate = (h) => {
      const tagged = page.locator('[data-qa-acc="' + h.i + '"]').first();
      return { tagged, byText: h.text ? page.locator(HEADER_SEL, { hasText: h.text.slice(0, 24) }).first() : null };
    };
    let okOpen = 0;
    let okClose = 0;
    const leaks = [];

    for (const h of snap) {
      const id = key + '-acc' + h.i;
      let btn = locate(h).tagged;
      if ((await btn.count()) === 0) {
        const alt = locate(h).byText;
        if (!alt || (await alt.count()) === 0) {
          t.rec(id, false, 'header not reachable: "' + h.text + '"');
          continue;
        }
        btn = alt;
      }

      // --- open ---
      await btn.click({ timeout: 5000 });
      await page.waitForTimeout(450);
      const opened = await panelState(page, h.i);
      const visible = opened.expanded === 'true' && opened.panelH > 8 && (opened.text || '').length > 0;
      if (visible) okOpen += 1;
      t.rec(
        id + '-open',
        visible,
        `"${h.text.slice(0, 24)}" expanded=${opened.expanded} panelH=${opened.panelH} panelW=${opened.panelW} text="${(opened.text || '').slice(0, 60)}"`,
      );
      if (SECRET.test(opened.text || '')) leaks.push(h.text.slice(0, 20));

      // --- close ---
      let btn2 = locate(h).tagged;
      if ((await btn2.count()) === 0) btn2 = locate(h).byText || btn;
      await btn2.click({ timeout: 5000 });
      await page.waitForTimeout(400);
      const closed = await panelState(page, h.i);
      const hidden = closed.expanded === 'false' || (closed.expanded === null && closed.panelH <= 2);
      if (hidden) okClose += 1;
      t.rec(id + '-close', hidden, `"${h.text.slice(0, 24)}" expanded=${closed.expanded} panelH=${closed.panelH}`);
    }

    t.rec(key + '-accSummary', okOpen === snap.length && okClose === snap.length, `opened=${okOpen}/${snap.length} closed=${okClose}/${snap.length}`);
    t.rec(key + '-accSecrets', leaks.length === 0, `secret-looking panel text=${leaks.length}${leaks.length ? ' :: ' + leaks.join(', ') : ''}`);
  });

  // Belt and braces: no secret anywhere on the screen, and no non-password input holding one.
  await t.step(key + '-secretScan', async () => {
    const scan = await page.evaluate(() => {
      const main = document.querySelector('main');
      const text = ((main && main.innerText) || '').replace(/\s+/g, ' ');
      const inputs = [...document.querySelectorAll('main input')]
        .filter((i) => {
          const r = i.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((i) => ({ type: i.type, value: String(i.value || '') }));
      return { text: text.slice(0, 6000), inputs };
    });
    const hit = SECRET.test(scan.text);
    const exposed = scan.inputs.filter((i) => i.type !== 'password' && SECRET.test(i.value)).length;
    t.rec(key + '-noKeyText', !hit && exposed === 0, `secretInText=${hit} exposedInputs=${exposed} inputs=${scan.inputs.length}`);
  });
}

await run('screens-review', async (t) => {
  const page = t.page;

  // 0. App-shell sanity: five 40px+ tabs on the fixed bottom bar.
  await t.step('shell-tabs', async () => {
    const nav = page.locator('nav[aria-label="Phone navigation"]');
    const buttons = nav.locator('button');
    const n = await buttons.count();
    const heights = await buttons.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    t.rec('shell-tabs', n === 5 && heights.length === 5 && heights.every((h) => h >= 40), `tabs=${n} heights=${heights.join(',')}`);
  });

  // 1. Seed the 6-question saved bank.
  await t.step('seed', async () => {
    await t.seed();
    t.rec('seed', true, `saved bank phone-test with ${QUESTIONS.length} questions`);
  });

  // 2. Best-effort real attempt so Performance / Test Reviews have data (empty states are acceptable if this fails).
  await t.step('attempt', async () => {
    await ensureShell(t);
    await t.nav('Question Bank');
    const start = page.getByRole('button', { name: 'Start', exact: true }).first();
    if ((await start.count()) === 0) {
      t.rec('attempt-start', false, 'saved-bank "Start" button not found');
      return;
    }
    await start.click();
    await page.waitForTimeout(1400);
    const nextBtn = page.getByRole('button', { name: /^Next/i }).first();
    const prevBtn = page.getByRole('button', { name: /^Prev/i }).first();
    const submitBtn = page.getByRole('button', { name: /^Submit/i }).first();
    const nNext = await nextBtn.count();
    const nPrev = await prevBtn.count();
    const nSubmit = await submitBtn.count();
    const inRunner = nNext + nPrev + nSubmit > 0;
    t.rec('attempt-start', inRunner, `runner controls next=${nNext} prev=${nPrev} submit=${nSubmit}`);
    if (!inRunner) return;

    for (const qi of [0, 1]) {
      const opt = page.getByText(QUESTIONS[qi].options[0].text, { exact: false }).first();
      if ((await opt.count()) > 0) {
        await opt.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(350);
      }
      if (qi === 0) {
        const n = page.getByRole('button', { name: /^Next/i }).first();
        if ((await n.count()) > 0) {
          await n.click().catch(() => {});
          await page.waitForTimeout(600);
        }
      }
    }
    const chars = await page.evaluate(() => (document.body.innerText || '').length);
    t.rec('attempt-answered', chars > 0, `body text after answering 2 questions = ${chars} chars`);

    const sub = page.getByRole('button', { name: /^Submit/i }).first();
    if ((await sub.count()) > 0) {
      await sub.click().catch(() => {});
      await page.waitForTimeout(900);
      const dlg = page.getByRole('dialog');
      let confirmed = 0;
      if ((await dlg.count()) > 0) {
        const b = dlg.getByRole('button', { name: /submit|confirm|yes|finish/i }).last();
        if ((await b.count()) > 0) {
          await b.click().catch(() => {});
          confirmed = 1;
        }
      } else {
        const b = page.getByRole('button', { name: /^(Confirm|Yes|Finish)/i }).last();
        if ((await b.count()) > 0) {
          await b.click().catch(() => {});
          confirmed = 1;
        }
      }
      await page.waitForTimeout(1500);
      t.rec('attempt-submit', true, `submit clicked, confirmButtons=${confirmed}`);
    }
  });

  await t.step('attempt-exit', async () => {
    const ok = await ensureShell(t);
    t.rec('attempt-exit', ok, ok ? 'back in app shell, drawer button reachable' : 'still immersive: navigation menu button missing');
  });

  // 3. Screens under audit.
  await auditScreen(t, 'analytics', 'Performance Analytics');
  await auditScreen(t, 'reviews', 'Test Reviews');
  await auditScreen(t, 'mistakes', 'Mistakes & Spaced Review');

  // Settings ("AI Subscriptions & OCR") may legitimately be taller than 3 screens.
  await auditScreen(t, 'settings', 'AI Subscriptions & OCR', { allowTall: true });
  await auditAccordions(t, 'settings');

  await auditScreen(t, 'highlights', 'Highlights & Memory');
});
