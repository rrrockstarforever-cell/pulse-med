import { run } from './lib.mjs';

/**
 * app-feel-audit — does every phone screen feel like an app or like a website?
 *
 * For each reachable screen (4 bottom tabs + More drawer overlay + all 18 drawer labels
 * + the live Active Test Runner) it measures: distinct font sizes, presence of :active CSS,
 * user-selectable buttons, the -webkit-tap-highlight-color, long text blocks (>160 chars),
 * tables, cards nested inside cards, fixed/sticky chrome share of the viewport, distinct
 * card radii, distinct card paddings, distinct filled-button colours, horizontal overflow,
 * body-scroll usage and whether inner scrolling works.
 *
 * Read-only: it never edits app code, never screenshots, and every risky step is wrapped
 * in t.step() so a broken screen can never crash the run.
 */

const NAV_LABELS = [
  'Today',
  'Study Plan',
  'Reminders',
  'Practice Builder',
  'Question Bank',
  'Image Question Review',
  'Performance Analytics',
  'Test Reviews',
  'Mistakes & Spaced Review',
  'Highlights & Memory',
  'Syllabus Tracker',
  'Clinical AI Tutor',
  'PDF Reader & OCR',
  'Clinical Evidence Browser',
  'QA & Benchmark',
  'Sync & Backup',
  'AI Subscriptions & OCR',
  // audited last: while a test is live the top bar + bottom nav are meant to disappear,
  // which would make the drawer (t.nav) unreachable for any screen after it.
  'Active Test Runner',
];

const TABS = ['Today', 'Practice', 'Test', 'Plan'];
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Runs in the page. Pure DOM/CSSOM inspection, no app imports, no state mutation
// (the only writes are scrollTop/scrollY values that are restored immediately).
const AUDIT = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const alphaOf = (v) => {
    if (!v) return -1;
    if (/transparent/i.test(v)) return 0;
    const m = /rgba?\(([^)]+)\)/.exec(v);
    if (!m) return -1;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return p.length === 4 ? p[3] : 1;
  };

  const isVisible = (e) => {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
      if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  };

  const ownText = (e) => {
    let t = '';
    for (const n of e.childNodes) if (n.nodeType === 3) t += ' ' + n.textContent;
    return t.replace(/\s+/g, ' ').trim();
  };

  const all = Array.from(document.querySelectorAll('body *')).filter(isVisible);

  // ---------- typography ----------
  const fontSet = new Set();
  let minFont = 999;
  let minFontText = '';
  for (const e of all) {
    const txt = ownText(e);
    if (!txt) continue;
    const f = Math.round(parseFloat(getComputedStyle(e).fontSize) * 10) / 10;
    fontSet.add(f);
    if (f < minFont) { minFont = f; minFontText = txt.slice(0, 26); }
  }
  const fontList = Array.from(fontSet).sort((a, b) => a - b);

  // ---------- :active feedback rules present anywhere in the CSSOM ----------
  let activeRules = 0;
  let styleRules = 0;
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try { rules = sheet.cssRules; } catch (e) { continue; } // cross-origin sheet
    if (!rules) continue;
    const walk = (list) => {
      for (const rule of Array.from(list)) {
        styleRules++;
        try { if (rule.selectorText && rule.selectorText.indexOf(':active') >= 0) activeRules++; } catch (e) { /* ignore */ }
        try { if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules); } catch (e) { /* ignore */ }
      }
    };
    try { walk(rules); } catch (e) { /* ignore */ }
  }

  // ---------- buttons: touch feedback hygiene ----------
  const BTN = 'button, a[href], [role="button"], input[type="button"], input[type="submit"]';
  const buttons = all.filter((e) => e.matches(BTN));
  let selectableButtons = 0;
  for (const b of buttons) {
    const s = getComputedStyle(b);
    const u = s.userSelect || s.webkitUserSelect || '';
    if (u !== 'none') selectableButtons++;
  }

  let tapHighlight = '';
  try {
    const s = getComputedStyle(document.body);
    tapHighlight = s.webkitTapHighlightColor || s.getPropertyValue('-webkit-tap-highlight-color') || '';
  } catch (e) { /* ignore */ }

  // ---------- long text blocks ----------
  const longBlocks = [];
  for (const e of all) {
    const txt = ownText(e);
    if (txt.length > 160) longBlocks.push({ tag: e.tagName.toLowerCase(), n: txt.length });
  }

  // ---------- tables ----------
  const tables = Array.from(document.querySelectorAll('table')).filter(isVisible).length;

  // ---------- card geometry ----------
  const cards = [];
  for (const e of all) {
    if (e.ownerSVGElement) continue;
    const tag = e.tagName.toLowerCase();
    if (['button', 'a', 'input', 'select', 'textarea', 'img', 'svg', 'label', 'table', 'td', 'th', 'hr'].indexOf(tag) >= 0) continue;
    if (e.getAttribute('role') === 'button') continue;
    const r = e.getBoundingClientRect();
    if (r.width < 80 || r.height < 32) continue;
    const s = getComputedStyle(e);
    const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some(
      (side) => parseFloat(s['border' + side + 'Width']) > 0 && s['border' + side + 'Style'] !== 'none',
    );
    const rad = parseFloat(s.borderTopLeftRadius) || 0;
    if (!hasBorder || rad < 6) continue;
    cards.push({
      el: e,
      rad,
      pad: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].join(' '),
    });
  }

  const cardEls = new Set(cards.map((c) => c.el));
  let nestedCards = 0;
  const nestedSample = [];
  for (const c of cards) {
    const p = c.el.parentElement;
    if (p && cardEls.has(p)) {
      nestedCards++;
      if (nestedSample.length < 3) {
        const cls = typeof c.el.className === 'string' ? c.el.className : '';
        nestedSample.push((cls.split(/\s+/).filter(Boolean).slice(0, 3).join('.') || c.el.tagName).slice(0, 36));
      }
    }
  }

  const radii = Array.from(new Set(cards.map((c) => (c.rad >= 100 ? 'full' : Math.round(c.rad)))));
  const paddings = Array.from(new Set(cards.map((c) => c.pad)));

  const bgSet = new Set();
  let filled = 0;
  for (const b of buttons) {
    const bg = getComputedStyle(b).backgroundColor;
    if (!bg || alphaOf(bg) <= 0.05) continue;
    bgSet.add(bg);
    filled++;
    if (filled >= 10) break;
  }

  // ---------- fixed / sticky chrome (top + bottom bars) ----------
  const bars = [];
  for (const e of document.querySelectorAll('body *')) {
    const s = getComputedStyle(e);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    if (!isVisible(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < vw * 0.6) continue;
    if (r.height > vh * 0.45) continue; // full-screen overlays / drawers are not "chrome"
    const atTop = r.top <= 2 && r.bottom > 0;
    const atBottom = r.bottom >= vh - 2 && r.top < vh;
    if (!atTop && !atBottom) continue;
    bars.push({ top: Math.max(0, r.top), bottom: Math.min(vh, r.bottom) });
  }
  bars.sort((a, b) => a.top - b.top);
  let chromePx = 0;
  let start = -1;
  let end = -1;
  for (const b of bars) {
    if (b.top > end) {
      if (end > 0) chromePx += end - start;
      start = b.top;
      end = b.bottom;
    } else if (b.bottom > end) {
      end = b.bottom;
    }
  }
  if (end > 0) chromePx += end - start;
  const chromeShare = Math.round((chromePx / vh) * 1000) / 10;

  // ---------- scrolling model ----------
  const sc = Array.from(document.querySelectorAll('*'))
    .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4)
    .sort((a, b) => b.clientHeight - a.clientHeight)[0];

  let scrollWorks = true;
  if (sc) {
    const t0 = sc.scrollTop;
    sc.scrollTop = Math.min(250, sc.scrollHeight - sc.clientHeight);
    scrollWorks = sc.scrollTop > 0;
    sc.scrollTop = t0;
  }

  const docH = document.documentElement.scrollHeight;
  const docScrollable = docH > vh + 2;
  const bodyScrollY = window.scrollY;

  return {
    vw: vw,
    vh: vh,
    docScrollW: document.documentElement.scrollWidth,
    docH: docH,
    docScrollable: docScrollable,
    bodyScrollY: bodyScrollY,
    fontSizes: fontList,
    minFont: minFont,
    minFontText: minFontText,
    activeRules: activeRules,
    styleRules: styleRules,
    buttons: buttons.length,
    selectableButtons: selectableButtons,
    tapHighlight: tapHighlight,
    tapAlpha: alphaOf(tapHighlight),
    longBlocks: longBlocks.length,
    longSample: longBlocks.slice(0, 3),
    tables: tables,
    cards: cards.length,
    nestedCards: nestedCards,
    nestedSample: nestedSample,
    radii: radii,
    paddings: paddings,
    btnColors: Array.from(bgSet),
    chromePx: chromePx,
    chromeShare: chromeShare,
    bars: bars.length,
    hasScroller: !!sc,
    scrollerClass: sc ? String(sc.className).slice(0, 48) : '',
    scrollWorks: scrollWorks,
  };
};

await run('app-feel-audit', async (t) => {
  const page = t.page;
  const screens = [];
  const metricFails = {};
  const metricTotal = {};

  // ---------- grading ----------
  const grade = (id, m) => {
    const checks = [];
    const chk = (key, ok, detail) => {
      t.rec(`${id}/${key}`, ok, detail);
      metricTotal[key] = (metricTotal[key] || 0) + 1;
      if (!ok) metricFails[key] = (metricFails[key] || 0) + 1;
      checks.push(!!ok);
    };

    chk('font-sizes', m.fontSizes.length <= 7, `distinct=${m.fontSizes.length} [${m.fontSizes.join(',')}]`);
    chk('font-floor', m.minFont >= 11, `min=${m.minFont}px "${m.minFontText}"`);
    chk('active-css', m.activeRules > 0, `:active rules=${m.activeRules}/${m.styleRules}`);
    chk('user-select', m.selectableButtons === 0, `selectable buttons=${m.selectableButtons}/${m.buttons}`);
    chk('tap-highlight', m.tapAlpha === 0, `-webkit-tap-highlight-color=${m.tapHighlight || 'n/a'} alpha=${m.tapAlpha}`);
    chk('long-text', m.longBlocks <= 3, `blocks>160ch=${m.longBlocks} ${m.longSample.map((x) => x.tag + ':' + x.n).join(',')}`);
    chk('tables', m.tables === 0, `tables=${m.tables}`);
    chk('nested-cards', m.nestedCards === 0, `nested=${m.nestedCards}/${m.cards} ${m.nestedSample.join(' | ')}`);
    chk('chrome', m.chromeShare <= 25, `chrome=${m.chromePx}px/${m.vh}px=${m.chromeShare}% bars=${m.bars}`);
    chk('radii', m.radii.length <= 3, `distinct=${m.radii.length} [${m.radii.join(',')}]`);
    chk('paddings', m.paddings.length <= 4, `distinct=${m.paddings.length} [${m.paddings.slice(0, 5).join(' / ')}]`);
    chk('button-colors', m.btnColors.length <= 3, `distinct=${m.btnColors.length} [${m.btnColors.join(', ')}]`);
    chk('no-h-overflow', m.docScrollW <= m.vw, `docScrollW=${m.docScrollW} vw=${m.vw}`);
    chk('body-no-scroll', m.bodyScrollY === 0 && (!m.docScrollable || m.hasScroller), `window.scrollY=${m.bodyScrollY} docH=${m.docH} vh=${m.vh} innerScroller=${m.hasScroller}`);
    chk('scroll-works', m.scrollWorks, `innerScrollMoved=${m.scrollWorks} scroller="${m.scrollerClass}"`);

    const fails = checks.filter((x) => !x).length;
    return { fails: fails, total: checks.length };
  };

  // ---------- helpers ----------
  const isDrawerOpen = () =>
    page
      .evaluate(() => {
        const d = document.querySelector('[aria-label="Navigation menu"]');
        return !!d && d.getAttribute('aria-hidden') !== 'true';
      })
      .catch(() => false);

  const dismissGuide = async () => {
    const skip = page.getByRole('button', { name: 'Skip guide' });
    if ((await skip.count()) > 0) {
      await skip.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(350);
    }
  };

  // If a screen ever hides the app chrome (immersive runner left on), reload back to Today.
  const ensureChrome = async () => {
    const menu = page.getByRole('button', { name: 'Open navigation menu' });
    if ((await menu.count()) === 0) {
      await page.reload({ waitUntil: 'load' }).catch(() => {});
      await page.waitForTimeout(1200);
      await dismissGuide();
    }
  };

  const goTo = async (label) => {
    if (await isDrawerOpen()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    await ensureChrome();
    await t.nav(label);
    await page.waitForTimeout(400);
  };

  const tapBottom = async (label) => {
    await ensureChrome();
    const nav = page.getByRole('navigation', { name: 'Phone navigation' });
    const btn =
      label === 'More'
        ? nav.getByRole('button', { name: 'More navigation' })
        : nav.getByRole('button', { name: label, exact: true });
    await btn.click({ timeout: 8000 });
    await page.waitForTimeout(900);
  };

  const auditScreen = async (name, id, overlay = false) => {
    const m = await t.step(`${id}/metrics`, () => page.evaluate(AUDIT));
    if (!m) {
      t.rec(`${id}/audit`, false, 'metrics unavailable — page.evaluate failed on this screen');
      screens.push({ name: name, id: id, overlay: overlay, fails: 99, total: 15, chrome: 0, fonts: 0, long: 0, nested: 0, score: 99 });
      return;
    }
    const g = grade(id, m);
    screens.push({
      name: name,
      id: id,
      overlay: overlay,
      fails: g.fails,
      total: g.total,
      chrome: m.chromeShare,
      fonts: m.fontSizes.length,
      long: m.longBlocks,
      nested: m.nestedCards,
      score: g.fails + m.nestedCards + m.longBlocks * 0.5 + m.chromeShare / 25,
    });
  };

  // ---------- boot ----------
  await t.seed();
  await t.step('boot/dismiss-guide', async () => {
    await dismissGuide();
    await page.waitForTimeout(300);
  });

  // ---------- 1. bottom tabs ----------
  for (const tab of TABS) {
    const id = `tab-${slug(tab)}`;
    let reached = false;
    await t.step(`${id}/open`, async () => {
      await tapBottom(tab);
      reached = true;
    });
    if (!reached) {
      t.rec(`${id}/screen`, false, 'bottom tab could not be tapped');
      screens.push({ name: `Tab: ${tab}`, id: id, overlay: false, fails: 99, total: 15, chrome: 0, fonts: 0, long: 0, nested: 0, score: 99 });
      continue;
    }
    await auditScreen(`Tab: ${tab}`, id);
  }

  // ---------- 2. More drawer overlay ----------
  let moreReached = false;
  await t.step('drawer/open', async () => {
    await tapBottom('More');
    await page.waitForTimeout(500);
    moreReached = true;
  });
  if (moreReached) {
    const open = await isDrawerOpen();
    t.rec('drawer/opens', open, `aria-hidden=${!open}`);
    await auditScreen('Drawer (More)', 'drawer', true);
    await t.step('drawer/close', async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    });
    t.rec('drawer/closes', !(await isDrawerOpen()), `stillOpen=${await isDrawerOpen()}`);
  } else {
    t.rec('drawer/opens', false, 'More tab not reachable');
  }

  // ---------- 3. every drawer screen ----------
  for (const label of NAV_LABELS) {
    const id = `scr-${slug(label)}`;
    let reached = false;
    await t.step(`${id}/nav`, async () => {
      await goTo(label);
      reached = true;
    });
    if (!reached) {
      t.rec(`${id}/screen`, false, `t.nav('${label}') failed`);
      screens.push({ name: label, id: id, overlay: false, fails: 99, total: 15, chrome: 0, fonts: 0, long: 0, nested: 0, score: 99 });
      continue;
    }
    await auditScreen(label, id);
  }

  // ---------- 4. live Active Test Runner (immersive) ----------
  let runnerStarted = false;
  await t.step('runner/launch', async () => {
    await goTo('Question Bank');
    await page.waitForTimeout(600);
    let start = page.getByRole('button', { name: 'Start', exact: true });
    if ((await start.count()) === 0) {
      const row = page.getByText(/6 questions|phone-test/i).first();
      if ((await row.count()) > 0) {
        await row.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(700);
      }
    }
    start = page.getByRole('button', { name: 'Start', exact: true });
    const n = await start.count();
    t.rec('runner/start-button', n > 0, `exact 'Start' buttons on Question Bank=${n}`);
    if (n === 0) return;
    await start.first().click();
    await page.waitForTimeout(1800);
    runnerStarted = true;
  });

  if (runnerStarted) {
    const menuCount = await page.getByRole('button', { name: 'Open navigation menu' }).count();
    const navCount = await page.getByRole('navigation', { name: 'Phone navigation' }).count();
    t.rec('runner/top-bar-hidden', menuCount === 0, `top app bar menu buttons=${menuCount}`);
    t.rec('runner/bottom-nav-hidden', navCount === 0, `phone bottom navs=${navCount}`);

    const counts = {};
    for (const key of ['prev', 'skip', 'next', 'submit']) {
      counts[key] = await page.getByRole('button', { name: new RegExp('^' + key, 'i') }).count();
    }
    t.rec(
      'runner/action-bar',
      counts.prev + counts.skip + counts.next + counts.submit >= 3,
      `prev=${counts.prev} skip=${counts.skip} next=${counts.next} submit=${counts.submit}`,
    );

    for (const key of ['prev', 'next', 'submit', 'skip']) {
      if (!counts[key]) continue;
      const h = await t.step(`runner/h-${key}`, () =>
        page
          .getByRole('button', { name: new RegExp('^' + key, 'i') })
          .first()
          .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
      );
      t.rec(`runner/tap-${key}`, typeof h === 'number' && h >= 40, `height=${h}px`);
    }

    const backCount = await page.getByRole('button', { name: /back|exit/i }).count();
    t.rec('runner/back-button', backCount > 0, `back/exit buttons=${backCount}`);

    const counter = await page.getByText(/\b\d+\s*\/\s*\d+\b/).count();
    t.rec('runner/question-counter', counter > 0, `elements matching n / total=${counter}`);

    const bt = await t.step('runner/text', () =>
      page.evaluate(() => {
        let n = 0;
        let min = 999;
        let minText = '';
        for (const e of Array.from(document.querySelectorAll('main *'))) {
          const r = e.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          let s = '';
          for (const c of e.childNodes) if (c.nodeType === 3) s += c.textContent;
          s = s.replace(/\s+/g, ' ').trim();
          if (s.length < 20) continue;
          const f = parseFloat(getComputedStyle(e).fontSize) || 0;
          n++;
          if (f < min) {
            min = f;
            minText = s.slice(0, 28);
          }
        }
        return { n: n, min: min, minText: minText };
      }),
    );
    if (bt) t.rec('runner/stem-option-14px', bt.n === 0 || bt.min >= 14, `blocks>=20ch=${bt.n} min=${bt.min}px "${bt.minText}"`);

    const cov = await t.step('runner/coverage', () =>
      page.evaluate(() => {
        const vh = innerHeight;
        const sc = Array.from(document.querySelectorAll('*'))
          .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4)
          .sort((a, b) => b.clientHeight - a.clientHeight)[0];
        const bars = Array.from(document.querySelectorAll('body *'))
          .filter((e) => {
            const s = getComputedStyle(e);
            if (s.position !== 'fixed' && s.position !== 'sticky') return false;
            if (parseFloat(s.opacity) === 0 || s.display === 'none' || s.visibility === 'hidden') return false;
            const r = e.getBoundingClientRect();
            return r.height > 0 && r.height < vh * 0.45 && r.bottom >= vh - 2 && r.width >= innerWidth * 0.6;
          })
          .map((e) => e.getBoundingClientRect().top);
        const barTop = bars.length ? Math.min.apply(null, bars) : vh;
        if (!sc) return { ok: true, barTop: Math.round(barTop), maxBottom: null, note: 'no inner scroller' };
        sc.scrollTop = sc.scrollHeight;
        let maxBottom = 0;
        for (const e of Array.from(sc.querySelectorAll('*'))) {
          let s = '';
          for (const c of e.childNodes) if (c.nodeType === 3) s += c.textContent;
          if (!s.trim()) continue;
          const r = e.getBoundingClientRect();
          if (r.height > 0) maxBottom = Math.max(maxBottom, r.bottom);
        }
        sc.scrollTop = 0;
        return { ok: maxBottom <= barTop + 1, barTop: Math.round(barTop), maxBottom: Math.round(maxBottom), note: '' };
      }),
    );
    if (cov) {
      t.rec(
        'runner/content-above-action-bar',
        cov.ok,
        `actionBarTop=${cov.barTop} contentBottom=${cov.maxBottom == null ? 'n/a' : cov.maxBottom} ${cov.note || ''}`,
      );
    }

    if (counts.next) {
      const before = await page.evaluate(() => {
        const m = document.querySelector('main');
        return m ? m.innerText.slice(0, 3000) : '';
      });
      await t.step('runner/next-click', async () => {
        await page.getByRole('button', { name: /^next/i }).first().click();
        await page.waitForTimeout(800);
      });
      const after = await page.evaluate(() => {
        const m = document.querySelector('main');
        return m ? m.innerText.slice(0, 3000) : '';
      });
      t.rec('runner/next-advances', before !== after && after.length > 0, `contentChanged=${before !== after}`);
    }

    await auditScreen('Active Test Runner (live)', 'runner-live');
  } else {
    t.rec('runner/live-audit', false, 'live test runner was not reached — immersive chrome could not be measured');
  }

  // ---------- 5. ranked summary ----------
  const audited = screens.filter((s) => !s.overlay && s.fails < 99);
  const notAudited = screens.filter((s) => s.fails === 99);
  t.rec(
    'AUDIT/screens-audited',
    audited.length >= 15,
    `audited=${audited.length} couldNotAudit=${notAudited.length}${notAudited.length ? ' (' + notAudited.map((s) => s.name).join(', ').slice(0, 120) + ')' : ''}`,
  );

  const ranked = audited.slice().sort((a, b) => b.fails - a.fails || b.score - a.score);
  const fmt = (s) => `${s.name} [fails ${s.fails}/${s.total} chrome ${s.chrome}% fonts ${s.fonts} nested ${s.nested} long ${s.long}]`;
  t.rec(
    'AUDIT/ranked-most-website-like',
    ranked.length > 0 && ranked[0].fails === 0,
    ranked.slice(0, 4).map(fmt).join(' > '),
  );
  t.rec('AUDIT/least-website-like', ranked.length > 0, ranked.slice(-3).map(fmt).join(' > '));

  const clean = audited.filter((s) => s.fails === 0);
  t.rec('AUDIT/clean-screens', clean.length > 0, `${clean.length}/${audited.length} clean: ${clean.map((s) => s.name).join(', ').slice(0, 250)}`);

  const worstKeys = Object.keys(metricFails).sort((a, b) => (metricFails[b] || 0) - (metricFails[a] || 0));
  const worstLine = worstKeys.slice(0, 6).map((k) => `${k}=${metricFails[k]}/${metricTotal[k]}`).join(' | ');
  const worstCount = worstKeys.length ? metricFails[worstKeys[0]] : 0;
  t.rec('AUDIT/worst-metrics', worstCount <= Math.ceil(Math.max(1, audited.length) / 2), worstLine || 'no metric failed on any screen');
});

