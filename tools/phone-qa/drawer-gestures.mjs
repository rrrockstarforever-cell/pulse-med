import { run } from './lib.mjs';

const BASE = process.env.QA_BASE || 'http://localhost:3100';

async function drawerState(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('[aria-label="Navigation menu"]');
    const panel = wrap?.querySelector('.mobile-drawer-panel');
    const r = panel?.getBoundingClientRect();
    const open = !!wrap && wrap.getAttribute('aria-hidden') !== 'true' && !wrap.hasAttribute('inert');
    return {
      exists: !!wrap,
      open,
      hidden: wrap?.getAttribute('aria-hidden') ?? null,
      inert: wrap?.hasAttribute('inert') ?? null,
      left: r ? Math.round(r.left) : null,
      right: r ? Math.round(r.right) : null,
      width: r ? Math.round(r.width) : null,
      bodyOverflow: getComputedStyle(document.body).overflow,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      bodyInlineOverflow: document.body.style.overflow,
      htmlInlineOverflow: document.documentElement.style.overflow,
      scrollY: window.scrollY,
      appScrollTop: document.querySelector('.app-scroll')?.scrollTop ?? null,
    };
  });
}

async function ensureClosed(page) {
  let s = await drawerState(page);
  if (s.open) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(450);
    s = await drawerState(page);
    if (s.open) {
      await page.touchscreen.tap(390, 400).catch(() => {});
      await page.waitForTimeout(450);
      s = await drawerState(page);
    }
  }
  return s;
}

async function moreButton(page) {
  const candidates = [
    page.getByRole('button', { name: 'More navigation' }),
    page.getByRole('button', { name: /^More$/ }),
  ];
  for (const c of candidates) {
    try {
      if (await c.count()) return c.first();
    } catch {}
  }
  return null;
}

async function openViaMore(page) {
  await ensureClosed(page);
  const b = await moreButton(page);
  if (b) {
    await b.click().catch(() => {});
    await page.waitForTimeout(450);
  }
  return drawerState(page);
}

async function getTitle(page) {
  const candidates = [
    page.locator('header').first(),
    page.locator('main h1').first(),
    page.locator('main h2').first(),
    page.locator('[data-testid="screen-title"]').first(),
  ];
  for (const c of candidates) {
    try {
      if ((await c.count()) && (await c.isVisible())) {
        const txt = (await c.innerText()).trim();
        if (txt) return txt.split('\n')[0].slice(0, 140);
      }
    } catch {}
  }
  try {
    return (await page.locator('body').innerText()).trim().slice(0, 180);
  } catch {
    return '';
  }
}

async function visibleTextCount(page, source) {
  return page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    return [...document.querySelectorAll('body *')].filter((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      if (!(r.width > 0 && r.height > 0)) return false;
      if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) return false;
      if (e.closest('[aria-hidden="true"]')) return false;
      const ownText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      return ownText && re.test((e.textContent || '').trim());
    }).length;
  }, source);
}

async function visibleOverlayCount(page) {
  return page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      if (!(r.width > 10 && r.height > 10)) return false;
      if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) return false;
      if (e.closest('[aria-hidden="true"]')) return false;
      if (e.closest('[aria-label="Navigation menu"]')) return false;
      return true;
    };
    return [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], [aria-label*="Notification" i], [aria-label*="Alert" i], .popover, .dropdown, .notification-panel')].filter(vis).length;
  });
}

async function firstVisibleInput(page) {
  const inputs = page.locator('input, textarea');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

async function findDarkToggle(panel) {
  const candidates = [
    panel.getByRole('button', { name: /switch to dark mode|switch to light mode/i }),
    panel.getByRole('button', { name: /dark mode|light mode|toggle theme|appearance/i }),
    panel.getByRole('switch', { name: /dark|theme|appearance/i }),
    panel.locator('[aria-label*="dark" i], [aria-label*="light" i], [aria-label*="theme" i], [title*="dark" i], [title*="light" i]'),
    panel.locator('button', { hasText: /Dark mode|Light mode|Dark theme|Light theme|Appearance/i }),
  ];
  for (const c of candidates) {
    try {
      if (await c.count()) {
        const el = c.first();
        if (await el.isVisible().catch(() => false)) return el;
      }
    } catch {}
  }
  return null;
}

async function swipe(page, cdp, from, to, steps = 12) {
  const point = (x, y) => ({ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point(from.x, from.y)],
  });
  await page.waitForTimeout(20);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const x = from.x + (to.x - from.x) * f;
    const y = from.y + (to.y - from.y) * f;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point(x, y)],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

async function contrastSamples(page, mode) {
  return page.evaluate((mode) => {
    const vis = (e) => {
      if (!e) return false;
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      if (!(r.width > 0 && r.height > 0)) return false;
      if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) return false;
      if (e.closest('[aria-hidden="true"]')) return false;
      return true;
    };
    const all = (sel) => [...document.querySelectorAll(sel)].filter(vis);
    const first = (sel) => all(sel)[0] || null;
    const findText = (re, root = document) => {
      return [...root.querySelectorAll('h1,h2,h3,p,span,button,a')].find((e) => {
        return vis(e) && e.children.length === 0 && re.test((e.textContent || '').trim());
      }) || null;
    };
    const parse = (c) => {
      const m = String(c || '').match(/rgba?\(([^)]+)\)/);
      if (!m) return [255, 255, 255, 1];
      const p = m[1].split(',').map((x) => Number(x.trim()));
      return [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? p[3] : 1];
    };
    const blend = (fg, bg) => {
      const a = fg[3];
      return [
        fg[0] * a + bg[0] * (1 - a),
        fg[1] * a + bg[1] * (1 - a),
        fg[2] * a + bg[2] * (1 - a),
        1,
      ];
    };
    const effectiveBg = (el) => {
      const chain = [];
      let node = el;
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c[3] > 0) {
          chain.push(c);
          if (c[3] >= 0.99) break;
        }
        node = node.parentElement;
      }
      let bg = [255, 255, 255, 1];
      for (let i = chain.length - 1; i >= 0; i--) bg = blend(chain[i], bg);
      return bg;
    };
    const lum = (rgb) => {
      const c = rgb.slice(0, 3).map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (el) => {
      if (!el) return null;
      const bg = effectiveBg(el);
      const fg0 = parse(getComputedStyle(el).color);
      const fg = fg0[3] < 1 ? blend(fg0, bg) : fg0;
      const L1 = lum(fg);
      const L2 = lum(bg);
      const hi = Math.max(L1, L2);
      const lo = Math.min(L1, L2);
      return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
    };

    let samples = [];
    if (mode === 'today') {
      const header = first('header');
      const title = header ? (findText(/today/i, header) || first('header h1') || header) : first('header h1');
      const main = document.querySelector('main') || document;
      const heading = findText(/today/i, main) || first('main h1') || first('main h2');
      const body = all('main p, main span').find((e) => (e.textContent || '').trim().length > 25) || first('main');
      samples = [
        { label: 'today-top-title', el: title },
        { label: 'today-heading', el: heading },
        { label: 'today-body', el: body },
      ];
    } else {
      const wrap = document.querySelector('[aria-label="Navigation menu"]');
      const root = wrap || document;
      const active = root.querySelector('button[aria-current="page"]') || [...root.querySelectorAll('button')].find((b) => vis(b));
      const inactive = [...root.querySelectorAll('button')].find((b) => vis(b) && !b.hasAttribute('aria-current'));
      const brand = [...root.querySelectorAll('h1,h2,h3,span')].find((e) => {
        return vis(e) && e.children.length === 0 && (e.textContent || '').trim().length > 2 && !/^\d+$/.test((e.textContent || '').trim());
      });
      samples = [
        { label: 'drawer-active', el: active },
        { label: 'drawer-inactive', el: inactive },
        { label: 'drawer-brand', el: brand },
      ];
    }

    return samples.map((s) => {
      const bg = s.el ? effectiveBg(s.el) : null;
      return {
        label: s.label,
        ratio: ratio(s.el),
        text: s.el ? (s.el.textContent || '').trim().slice(0, 48) : null,
        color: s.el ? getComputedStyle(s.el).color : null,
        bg: bg ? bg.map((v) => Math.round(v)).join(',') : null,
      };
    });
  }, mode);
}

await run('drawer-gestures', async (t) => {
  const page = t.page;
  let cdp = null;
  try {
    cdp = await page.context().newCDPSession(page);
  } catch {}

  await t.step('initial-today', async () => {
    await t.nav('Today');
    await page.waitForTimeout(800);
    t.rec('initial-today', true, JSON.stringify(await drawerState(page)));
  });

  await t.step('open-menu-slide', async () => {
    await ensureClosed(page);
    const panel = page.locator('[aria-label="Navigation menu"] .mobile-drawer-panel').first();
    if (!(await panel.count())) {
      t.rec('drawer-slide-samples', false, 'drawer panel not found');
      return;
    }
    const menu = page.getByRole('button', { name: 'Open navigation menu' }).first();
    if (!(await menu.count())) {
      t.rec('drawer-open-menu', false, 'open navigation menu button not found');
      return;
    }

    const started = Date.now();
    await menu.click();
    const samples = [];
    for (let i = 0; i < 5; i++) {
      if (i > 0) await page.waitForTimeout(87);
      const b = await panel.boundingBox().catch(() => null);
      samples.push(b ? Math.round(b.x) : null);
    }

    let finishMs = null;
    for (let i = 0; i < 25; i++) {
      const s = await drawerState(page);
      if (s.left !== null && s.left >= -1) {
        finishMs = Date.now() - started;
        break;
      }
      await page.waitForTimeout(20);
    }

    const state = await drawerState(page);
    const nums = samples.filter((v) => v !== null);
    const monotonic = nums.length >= 2 && nums.every((v, i) => i === 0 || v >= nums[i - 1] - 1);
    const startOk = nums.length > 0 && nums[0] < -150;
    const endOk = nums.length > 0 && nums[nums.length - 1] >= -6;
    const finishOk = finishMs !== null && finishMs <= 400;

    t.rec('drawer-open-menu', state.open, JSON.stringify({ open: state.open, left: state.left, width: state.width }));
    t.rec('drawer-slide-samples', monotonic && startOk && endOk && finishOk, JSON.stringify({
      samples,
      width: state.width,
      finishMs,
      monotonic,
      startOk,
      endOk,
      finishOk,
    }));
  });

  await t.step('backdrop-close', async () => {
    let before = await drawerState(page);
    if (!before.open) {
      await openViaMore(page);
      before = await drawerState(page);
    }
    if (!before.open) {
      t.rec('backdrop-tap-closes', false, 'drawer did not open');
      return;
    }
    await page.touchscreen.tap(390, 400).catch(async () => {
      await page.mouse.click(390, 400).catch(() => {});
    });
    await page.waitForTimeout(450);
    const after = await drawerState(page);
    t.rec('backdrop-tap-closes', !after.open, JSON.stringify({ before, after }));
  });

  await t.step('more-escape', async () => {
    await ensureClosed(page);
    const b = await moreButton(page);
    if (!b) {
      t.rec('drawer-open-more', false, 'More button not found');
      return;
    }
    await b.click().catch(() => {});
    await page.waitForTimeout(450);
    const opened = await drawerState(page);
    t.rec('drawer-open-more', opened.open, JSON.stringify(opened));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
    const closed = await drawerState(page);
    t.rec('escape-closes', !closed.open, JSON.stringify(closed));
  });

  await t.step('choose-screen', async () => {
    await ensureClosed(page);
    const beforeTitle = await getTitle(page);
    const opened = await openViaMore(page);
    if (!opened.open) {
      t.rec('drawer-screen-close', false, 'drawer did not open via More');
      return;
    }
    const wrap = page.locator('[aria-label="Navigation menu"]').first();
    const item = wrap.locator('button', { hasText: 'Question Bank' }).first();
    if (!(await item.count())) {
      t.rec('drawer-screen-close', false, 'Question Bank item not found in drawer');
      return;
    }
    await item.click().catch(() => {});
    await page.waitForTimeout(1500);
    const afterState = await drawerState(page);
    const afterTitle = await getTitle(page);
    const pass = !afterState.open && /Question Bank/i.test(afterTitle) && afterTitle !== beforeTitle;
    t.rec('drawer-screen-close', pass, JSON.stringify({ beforeTitle, afterTitle, afterState }));
  });

  await t.step('scroll-lock', async () => {
    await ensureClosed(page);
    const opened = await openViaMore(page);
    if (!opened.open) {
      t.rec('drawer-body-scroll-locked', false, 'drawer did not open');
      return;
    }
    const before = await drawerState(page);
    await page.mouse.wheel(0, 300).catch(() => {});
    await page.waitForTimeout(300);
    const after = await drawerState(page);
    const locked = before.bodyOverflow === 'hidden' && before.htmlOverflow === 'hidden' &&
      Math.abs((after.scrollY || 0) - (before.scrollY || 0)) <= 2;
    t.rec('drawer-body-scroll-locked', locked, JSON.stringify({ before, after, wheel: 300 }));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
    const closed = await drawerState(page);
    t.rec('drawer-scroll-restored', closed.bodyOverflow !== 'hidden' && closed.htmlOverflow !== 'hidden', JSON.stringify({
      bodyOverflow: closed.bodyOverflow,
      htmlOverflow: closed.htmlOverflow,
    }));
  });

  await t.step('swipe-gestures', async () => {
    if (!cdp) {
      t.rec('swipe-edge-opens', false, 'CDP touch session unavailable');
      return;
    }
    await ensureClosed(page);
    await page.waitForTimeout(200);
    await swipe(page, cdp, { x: 3, y: 420 }, { x: 220, y: 420 }, 12);
    await page.waitForTimeout(450);
    let s = await drawerState(page);
    t.rec('swipe-edge-opens', s.open && s.left !== null && s.left > -20, JSON.stringify({ open: s.open, left: s.left, width: s.width }));

    if (!s.open) {
      await openViaMore(page);
      s = await drawerState(page);
    }
    if (!s.open) {
      t.rec('swipe-left-closes', false, 'drawer was not open for close swipe');
      return;
    }

    await swipe(page, cdp, { x: 220, y: 420 }, { x: 30, y: 420 }, 12);
    await page.waitForTimeout(450);
    const c = await drawerState(page);
    t.rec('swipe-left-closes', !c.open, JSON.stringify({ open: c.open, left: c.left, width: c.width }));
  });

  await t.step('drawer-list-reachable', async () => {
    const opened = await openViaMore(page);
    if (!opened.open) {
      t.rec('drawer-last-item-reachable', false, 'drawer did not open');
      return;
    }
    const panel = page.locator('[aria-label="Navigation menu"] .mobile-drawer-panel').first();
    const scrollInfo = await panel.evaluate((el) => {
      const candidates = [...el.querySelectorAll('*')].filter((e) => {
        const s = getComputedStyle(e);
        return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 4;
      });
      const s = candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0];
      if (!s) return null;
      s.scrollTop = s.scrollHeight;
      return {
        className: String(s.className).slice(0, 80),
        scrollHeight: s.scrollHeight,
        clientHeight: s.clientHeight,
        scrollTop: s.scrollTop,
      };
    }).catch(() => null);

    const last = panel.locator('button', { hasText: 'AI Subscriptions & OCR' }).first();
    const found = await last.count();
    if (!found) {
      t.rec('drawer-last-item-reachable', false, JSON.stringify({ found, scrollInfo }));
      await page.keyboard.press('Escape');
      return;
    }

    await last.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
    const box = await last.boundingBox().catch(() => null);
    const panelBox = await panel.boundingBox().catch(() => null);
    const vh = await page.evaluate(() => innerHeight);
    const visible = await last.isVisible().catch(() => false);
    const notCut = !!box && box.y >= 0 && box.y + box.height <= vh + 1 &&
      (!panelBox || box.y + box.height <= panelBox.y + panelBox.height + 1);
    t.rec('drawer-last-item-reachable', found && visible && notCut, JSON.stringify({
      found,
      visible,
      scrollInfo,
      box,
      panelBox,
      vh,
      notCut,
    }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
  });

  await t.step('search-navigate', async () => {
    await ensureClosed(page);
    const beforeTitle = await getTitle(page);
    let clicked = false;
    const candidates = [
      page.getByRole('button', { name: /search/i }),
      page.locator('[aria-label*="Search" i]'),
    ];
    for (const c of candidates) {
      try {
        if (await c.count()) {
          const el = c.first();
          if (await el.isVisible().catch(() => false)) {
            await el.click().catch(() => {});
            clicked = true;
            break;
          }
        }
      } catch {}
    }
    if (!clicked) {
      t.rec('search-enter-navigates', false, 'search button not found');
      return;
    }

    await page.waitForTimeout(400);
    const input = await firstVisibleInput(page);
    if (!input) {
      t.rec('search-enter-navigates', false, 'no visible search input after opening search');
      return;
    }
    const meta = await input.evaluate((e) => ({
      placeholder: e.getAttribute('placeholder'),
      aria: e.getAttribute('aria-label'),
      type: e.getAttribute('type'),
    })).catch(() => ({}));

    await input.fill('hypercalcaemia').catch(() => {});
    await input.press('Enter').catch(async () => {
      await page.keyboard.press('Enter').catch(() => {});
    });
    await page.waitForTimeout(1500);

    const title = await getTitle(page);
    const body = await page.locator('body').innerText().catch(() => '');
    const s = await drawerState(page);
    const navigated = title !== beforeTitle || /clinical|evidence|research/i.test(title);
    const pass = navigated && /clinical|evidence|research|hypercalcaemia/i.test(title + '\n' + body) && !s.open;
    t.rec('search-enter-navigates', pass, JSON.stringify({
      clicked,
      input: meta,
      beforeTitle: beforeTitle.slice(0, 100),
      title: title.slice(0, 120),
      bodyHasQuery: /hypercalcaemia/i.test(body),
      drawerOpen: s.open,
    }));
  });

  await t.step('bell-panel', async () => {
    await ensureClosed(page);
    const beforeText = await visibleTextCount(page, 'Notifications|Alerts');
    const beforeOverlays = await visibleOverlayCount(page);

    let clicked = false;
    const candidates = [
      page.getByRole('button', { name: /notifications|alerts|bell/i }),
      page.locator('[aria-label*="Notification" i], [aria-label*="Alert" i]'),
    ];
    for (const c of candidates) {
      try {
        if (await c.count()) {
          const el = c.first();
          if (await el.isVisible().catch(() => false)) {
            await el.click().catch(() => {});
            clicked = true;
            break;
          }
        }
      } catch {}
    }
    if (!clicked) {
      t.rec('bell-panel-outside-close', false, 'bell button not found');
      return;
    }

    await page.waitForTimeout(400);
    const afterText = await visibleTextCount(page, 'Notifications|Alerts');
    const afterOverlays = await visibleOverlayCount(page);
    const opened = afterText > beforeText || afterOverlays > beforeOverlays;

    await page.touchscreen.tap(10, 300).catch(async () => {
      await page.mouse.click(10, 300).catch(() => {});
    });
    await page.waitForTimeout(400);
    const closeText = await visibleTextCount(page, 'Notifications|Alerts');
    const closeOverlays = await visibleOverlayCount(page);
    const closed = closeText <= beforeText && closeOverlays <= beforeOverlays;

    t.rec('bell-panel-outside-close', opened && closed, JSON.stringify({
      beforeText,
      afterText,
      beforeOverlays,
      afterOverlays,
      closeText,
      closeOverlays,
      opened,
      closed,
    }));
  });

  await t.step('dark-mode-contrast', async () => {
    await t.nav('Today');
    await page.waitForTimeout(800);
    await ensureClosed(page);

    const opened = await openViaMore(page);
    if (!opened.open) {
      t.rec('dark-mode-enabled', false, 'drawer did not open');
      return;
    }
    const panel = page.locator('[aria-label="Navigation menu"] .mobile-drawer-panel').first();
    const toggle = await findDarkToggle(panel);
    if (!toggle) {
      t.rec('dark-mode-enabled', false, 'dark mode toggle not found in drawer');
      await page.keyboard.press('Escape').catch(() => {});
      return;
    }

    const before = await page.evaluate(() => localStorage.getItem('pulse-dark-mode')).catch(() => null);
    await toggle.click().catch(() => {});
    await page.waitForTimeout(600);
    let dark = await page.evaluate(() => ({
      ls: localStorage.getItem('pulse-dark-mode'),
      hasDark: !!document.querySelector('.dark'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    })).catch(() => ({ ls: null, hasDark: false, bodyBg: null }));

    if (dark.ls !== 'true' && !dark.hasDark) {
      const toggle2 = await findDarkToggle(panel);
      if (toggle2) {
        await toggle2.click().catch(() => {});
        await page.waitForTimeout(700);
      }
      dark = await page.evaluate(() => ({
        ls: localStorage.getItem('pulse-dark-mode'),
        hasDark: !!document.querySelector('.dark'),
        bodyBg: getComputedStyle(document.body).backgroundColor,
      })).catch(() => ({ ls: null, hasDark: false, bodyBg: null }));
    }
    t.rec('dark-mode-enabled', dark.ls === 'true' || dark.hasDark, JSON.stringify({ before, dark }));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
    const todaySamples = await contrastSamples(page, 'today');

    const opened2 = await openViaMore(page);
    let drawerSamples = [];
    if (opened2.open) {
      drawerSamples = await contrastSamples(page, 'drawer');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(450);
    } else {
      drawerSamples = [
        { label: 'drawer-active', ratio: null, text: 'drawer did not open for contrast sampling' },
        { label: 'drawer-inactive', ratio: null, text: 'drawer did not open for contrast sampling' },
        { label: 'drawer-brand', ratio: null, text: 'drawer did not open for contrast sampling' },
      ];
    }

    const samples = [...todaySamples, ...drawerSamples];
    for (const s of samples) {
      t.rec('contrast-' + s.label, s.ratio !== null && s.ratio >= 4.5, JSON.stringify(s));
    }
  });

  await t.step('browser-back', async () => {
    await ensureClosed(page);
    await t.nav('Study Plan');
    await page.waitForTimeout(1000);
    const beforeUrl = page.url();
    const beforeTitle = await getTitle(page);
    const historyLength = await page.evaluate(() => history.length).catch(() => null);

    let wentBack = false;
    try {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 2500 });
      wentBack = true;
    } catch {}

    await page.waitForTimeout(800);
    const afterUrl = page.url();
    const appShell = await page.locator('.app-shell').count().catch(() => 0);
    const afterTitle = await getTitle(page);
    const body = await page.locator('body').innerText().catch(() => '');
    const leftApp = !afterUrl.includes('localhost:3100') || appShell === 0;
    const returnedToday = /today/i.test(afterTitle) || /today/i.test(body.slice(0, 300));
    const verdict = leftApp ? 'left app' : returnedToday ? 'returned to Today' : 'stayed in app on another screen';

    t.rec('browser-back-behaviour', true, JSON.stringify({
      wentBack,
      beforeUrl,
      afterUrl,
      historyLength,
      appShell,
      beforeTitle: beforeTitle.slice(0, 80),
      afterTitle: afterTitle.slice(0, 80),
      returnedToday,
      leftApp,
      verdict,
    }));

    if (leftApp) {
      await page.goto(BASE, { waitUntil: 'load', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const skip = page.getByRole('button', { name: 'Skip guide' });
      if (await skip.count()) {
        await skip.first().click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  });
});

