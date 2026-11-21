import { run } from './lib.mjs';

const DESTRUCTIVE = /delete|clear|reset|remove|logout|sign out|import|restore/i;
const localErrors = [];

async function getTargets40(page) {
  return page.evaluate(() => {
    const sel = 'button,a,[role="button"],input,select,textarea';
    const els = [...document.querySelectorAll(sel)].filter((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[aria-hidden="true"]');
    });
    const bad = els.filter((e) => e.getBoundingClientRect().height < 40);
    const heights = els.map((e) => e.getBoundingClientRect().height).filter((h) => h > 0);
    return {
      count: els.length,
      under40: bad.length,
      minH: heights.length ? +Math.min(...heights).toFixed(1) : null,
      sample: bad.slice(0, 3).map((e) => ({
        text: ((e.innerText || e.textContent || e.getAttribute('aria-label') || e.tagName) || '').trim().replace(/\s+/g, ' ').slice(0, 45),
        h: +e.getBoundingClientRect().height.toFixed(1),
      })),
    };
  });
}

async function getCandidates(page) {
  return page.evaluate(() => {
    const bad = /delete|clear|reset|remove|logout|sign out|import|restore/i;
    const els = [...document.querySelectorAll('main button, main a, main [role="button"], main input[type="button"], main input[type="submit"]')].filter((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      if (!(r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none')) return false;
      if (e.closest('[aria-hidden="true"]')) return false;
      if (e.disabled) return false;
      const txt = ((e.innerText || e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '')).trim();
      if (!txt) return false;
      return !bad.test(txt);
    });
    return els.slice(0, 3).map((e, i) => ({
      i,
      tag: e.tagName,
      text: ((e.innerText || e.textContent || '') || '').trim().replace(/\s+/g, ' ').slice(0, 90),
      aria: e.getAttribute('aria-label') || '',
      title: e.getAttribute('title') || '',
      type: e.getAttribute('type') || '',
    }));
  });
}

async function restoreToScreen(t, label) {
  const page = t.page;
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(250);

  const menu = page.getByRole('button', { name: 'Open navigation menu' });
  const menuVisible = await menu.isVisible().catch(() => false);
  if (!menuVisible) {
    await page.reload({ waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(1100);
  } else {
    const close = page.getByRole('button', { name: 'Close navigation menu' });
    if (await close.isVisible().catch(() => false)) {
      await close.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  const skip = page.getByRole('button', { name: 'Skip guide' });
  if (await skip.count().catch(() => 0)) {
    await skip.first().click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  await t.nav(label);
}

async function tapFirstThree(t, key, label) {
  let candidates = [];
  await t.step(`${key}.candidates`, async () => {
    candidates = await getCandidates(t.page);
    t.rec(`${key}.candidates`, candidates.length > 0, `count=${candidates.length} first="${candidates.map((c) => c.text || c.aria || c.title || c.tag).join(' | ').slice(0, 180)}"`);
  });

  for (let i = 0; i < 3; i++) {
    const cand = candidates[i];
    await t.step(`${key}.tap${i + 1}`, async () => {
      if (!cand) {
        t.rec(`${key}.tap${i + 1}`, true, 'no additional non-destructive candidate');
        return;
      }

      await restoreToScreen(t, label);

      const errBefore = localErrors.length;
      const clicked = await t.page.evaluate((cand) => {
        const bad = /delete|clear|reset|remove|logout|sign out|import|restore/i;
        const els = [...document.querySelectorAll('main button, main a, main [role="button"], main input[type="button"], main input[type="submit"]')].filter((e) => {
          const r = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          if (!(r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none')) return false;
          if (e.closest('[aria-hidden="true"]')) return false;
          if (e.disabled) return false;
          const txt = ((e.innerText || e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '')).trim();
          if (!txt) return false;
          return !bad.test(txt);
        });

        let el = null;
        if (cand.aria) el = els.find((e) => (e.getAttribute('aria-label') || '') === cand.aria);
        if (!el && cand.text) {
          el = els.find((e) => ((e.innerText || e.textContent || '').trim().replace(/\s+/g, ' ')) === cand.text);
        }
        if (!el && cand.title) el = els.find((e) => (e.getAttribute('title') || '') === cand.title);
        if (!el) el = els[cand.i] || null;
        if (!el) return { clicked: false, reason: 'not found' };

        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.focus?.();
        el.click();
        return {
          clicked: true,
          tag: el.tagName,
          text: ((el.innerText || el.textContent || el.getAttribute('aria-label') || '') || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        };
      }, cand);

      await t.page.waitForTimeout(800);
      const responsive = await t.page.evaluate(() => !!document.body && document.body.innerText.trim().length > 0).catch(() => false);
      const newErr = localErrors.slice(errBefore);
      t.rec(
        `${key}.tap${i + 1}`,
        clicked.clicked && responsive && newErr.length === 0,
        `clicked=${clicked.clicked} target="${clicked.text || cand.text || cand.aria || cand.title}" responsive=${responsive} newErrors=${newErr.length}${newErr.length ? ' :: ' + newErr.slice(0, 2).join(' | ') : ''}`,
      );
    });
  }
}

async function auditAITutorInput(t, key) {
  await t.step(`${key}.input`, async () => {
    await t.page.evaluate(() => {
      const scroller = [...document.querySelectorAll('*')]
        .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4)
        .sort((a, b) => b.clientHeight - a.clientHeight)[0];
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      else window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await t.page.waitForTimeout(350);

    const r = await t.page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Phone navigation"]');
      const navRect = nav ? nav.getBoundingClientRect() : null;
      const navTop = navRect ? Math.round(navRect.top) : null;
      const cands = [...document.querySelectorAll('main textarea, main input[type="text"], main input:not([type]), main [contenteditable="true"]')].filter((e) => {
        const b = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[aria-hidden="true"]');
      });
      cands.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
      const el = cands[0] || null;
      if (!el) return { found: false, navTop, vh: innerHeight };
      const b = el.getBoundingClientRect();
      return {
        found: true,
        navTop,
        vh: innerHeight,
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
        h: Math.round(b.height),
        aboveNav: navTop != null ? b.bottom <= navTop - 1 : true,
        inView: b.top >= 0 && b.bottom <= innerHeight,
        nearBottom: b.bottom > innerHeight * 0.55,
        tag: el.tagName,
        placeholder: el.getAttribute('placeholder') || '',
      };
    });

    t.rec(`${key}.inputAboveNav`, r.found && r.aboveNav, `found=${r.found} navTop=${r.navTop} inputTop=${r.top ?? '-'} inputBottom=${r.bottom ?? '-'} h=${r.h ?? '-'}`);
    t.rec(`${key}.inputInView`, r.found && r.inView, `inputTop=${r.top ?? '-'} inputBottom=${r.bottom ?? '-'} vh=${r.vh} placeholder="${r.placeholder || ''}"`);
    t.rec(`${key}.inputNearBottom`, r.found && r.nearBottom, `inputBottom=${r.bottom ?? '-'} vh=${r.vh} nearBottom=${r.nearBottom}`);
  });
}

async function auditQuestionBankExtra(t, key) {
  await t.step(`${key}.saved-bank`, async () => {
    const page = t.page;
    const start = page.getByRole('button', { name: 'Start', exact: true });
    const count = await start.count().catch(() => 0);
    const visible = count ? await start.first().isVisible().catch(() => false) : false;
    t.rec(`${key}.savedBankStartVisible`, visible, `exactStartButtons=${count} visible=${visible}`);

    const bodyText = await page.evaluate(() => document.body.innerText);
    t.rec(
      `${key}.phoneTestText`,
      /phone-test|6\s*question|INI-CET/i.test(bodyText),
      `phone-test=${/phone-test/i.test(bodyText)} sixQuestions=${/6\s*question/i.test(bodyText)} iniCet=${/INI-CET/i.test(bodyText)}`,
    );
  });
}

async function auditScreen(t, key, label, extra) {
  const opened = await t.step(`${key}.open`, async () => {
    await t.nav(label);
    await t.page.waitForTimeout(500);
    return true;
  });
  if (!opened) {
    t.rec(`${key}.skipped`, false, 'navigation failed');
    return;
  }

  await t.step(`${key}.metrics`, async () => {
    const m = await t.metrics();
    t.rec(`${key}.overflow`, m.docScrollW <= m.vw, `docScrollW=${m.docScrollW} vw=${m.vw}`);
    t.rec(`${key}.clippedRight`, m.clippedRight === 0, `clippedRight=${m.clippedRight}`);
    t.rec(`${key}.minFont`, m.minFont >= 11, `minFont=${m.minFont} minEl="${m.minEl}"`);
    const tg = await getTargets40(t.page);
    t.rec(`${key}.tapTargets40`, tg.under40 === 0, `interactive=${tg.count} under40=${tg.under40} minH=${tg.minH} sample=${JSON.stringify(tg.sample).slice(0, 220)}`);
    t.rec(`${key}.smallTargets32`, m.smallTargets === 0, `smallTargets<32=${m.smallTargets}`);
    t.rec(`${key}.screens`, m.screens <= 3, `screens=${m.screens} vh=${m.vh} scrollerClass="${m.scrollerClass}"`);
    t.rec(`${key}.mono`, m.mono === 0, `mono=${m.mono}`);

    const body = await t.page.evaluate(() => ({ docH: document.documentElement.scrollHeight, bodyH: document.body.scrollHeight, vh: innerHeight }));
    t.rec(`${key}.bodyNoScroll`, body.docH <= body.vh + 2, `docScrollH=${body.docH} bodyScrollH=${body.bodyH} vh=${body.vh}`);
  });

  await t.step(`${key}.scroll`, async () => {
    const start = await t.page.evaluate(() => {
      const scroller = [...document.querySelectorAll('*')]
        .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4)
        .sort((a, b) => b.clientHeight - a.clientHeight)[0];
      const before = scroller ? scroller.scrollTop : window.scrollY;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      else window.scrollTo(0, document.documentElement.scrollHeight);
      return {
        hasScroller: !!scroller,
        scrollHeight: scroller ? scroller.scrollHeight : document.documentElement.scrollHeight,
        clientHeight: scroller ? scroller.clientHeight : innerHeight,
        before,
      };
    });

    await t.page.waitForTimeout(350);

    const b = await t.page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Phone navigation"]');
      const navRect = nav ? nav.getBoundingClientRect() : null;
      const navTop = navRect ? Math.round(navRect.top) : null;
      const main = document.querySelector('main');
      let last = null;

      if (main) {
        const els = [...main.querySelectorAll('*')].filter((e) => {
          const r = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          if (!(r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.position !== 'fixed' && r.bottom > 0 && r.top < innerHeight + 1)) return false;
          const ownText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
          const control = e.matches('button,a,[role="button"],input,select,textarea');
          return ownText || control;
        });
        els.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
        last = els[0] || null;
      }

      const lr = last ? last.getBoundingClientRect() : null;
      const scroller = [...document.querySelectorAll('*')]
        .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4)
        .sort((a, b) => b.clientHeight - a.clientHeight)[0];

      return {
        navTop,
        lastTop: lr ? Math.round(lr.top) : null,
        lastBottom: lr ? Math.round(lr.bottom) : null,
        lastText: last ? (last.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70) : '',
        covered: !!(lr && navTop != null && lr.bottom > navTop + 1),
        scrolled: scroller ? scroller.scrollTop : window.scrollY,
        vh: innerHeight,
      };
    });

    const scrollable = start.hasScroller && start.scrollHeight > start.clientHeight + 4;
    t.rec(`${key}.scrolls`, !scrollable || b.scrolled > start.before + 1, `hasScroller=${start.hasScroller} scrollHeight=${start.scrollHeight} clientHeight=${start.clientHeight} before=${start.before} after=${b.scrolled}`);
    t.rec(`${key}.bottomNotCovered`, !b.covered, `navTop=${b.navTop} lastTop=${b.lastTop} lastBottom=${b.lastBottom} vh=${b.vh} text="${b.lastText}"`);
  });

  if (extra) {
    await t.step(`${key}.extra`, async () => {
      await extra(t, key);
    });
  }

  await tapFirstThree(t, key, label);
}

await run('screens-tools', async (t) => {
  const page = t.page;
  page.on('pageerror', (e) => localErrors.push('pageerror: ' + String(e.message || e).split('\n')[0].slice(0, 180)));
  page.on('console', (m) => {
    if (m.type() === 'error') localErrors.push('console: ' + m.text().slice(0, 180));
  });
  page.on('filechooser', (fc) => {
    fc.setFiles([]).catch(() => {});
  });

  await t.step('seed-phone-test', async () => {
    await t.seed();
    t.rec('seed-phone-test', true, 'saved bank phone-test with 6 questions');
  });

  const screens = [
    { key: 'syllabus', label: 'Syllabus Tracker' },
    { key: 'sync', label: 'Sync & Backup' },
    { key: 'ai-tutor', label: 'Clinical AI Tutor', extra: auditAITutorInput },
    { key: 'pdf', label: 'PDF Reader & OCR' },
    { key: 'evidence', label: 'Clinical Evidence Browser' },
    { key: 'qa', label: 'QA & Benchmark' },
    { key: 'question-bank', label: 'Question Bank', extra: auditQuestionBankExtra },
  ];

  for (const s of screens) {
    await t.step(`screen:${s.key}`, async () => {
      await auditScreen(t, s.key, s.label, s.extra);
    });
  }
});
