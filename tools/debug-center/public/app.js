// Pulse Med — Debug Control Center (dashboard client)
// Plain ES module. No third-party code. All API calls stay on 127.0.0.1.

const $ = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem('pmdc.token') || '',
  status: null,
  logs: [],
  lastSeq: 0,
  logSignature: '',
  follow: true,
  statusBusy: false,
  logsBusy: false,
  jobWasActive: false,
  offline: false,
  checkpointSignature: '',
  models: null,
  modelsBusy: false,
  modelsAt: null,
  modelsAppKey: null,
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function api(path, options = {}, retried = false) {
  const opts = { ...options, credentials: 'same-origin', cache: 'no-store', headers: { ...(options.headers || {}) } };
  if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  if (state.token) opts.headers['x-debug-token'] = state.token;

  let res;
  try {
    res = await fetch(path, opts);
  } catch (err) {
    const e = new Error(`Could not reach the Debug Control Center (${err?.message || 'network error'}).`);
    e.network = true;
    throw e;
  }

  if (res.status === 401) {
    // A stale localStorage token can shadow a perfectly good cookie. Drop it and retry once.
    if (state.token && !retried) {
      state.token = '';
      localStorage.removeItem('pmdc.token');
      return api(path, options, true);
    }
    showAuthBanner(true);
    const e = new Error('Unauthorized. Enter the debug token to continue.');
    e.status = 401;
    throw e;
  }

  const type = res.headers.get('content-type') || '';
  let data = null;
  try {
    data = type.includes('application/json') ? await res.json() : await res.text();
  } catch { /* empty body */ }

  if (!res.ok) {
    const msg = data && typeof data === 'object' && data.error ? data.error : `Request failed (HTTP ${res.status}).`;
    const e = new Error(msg);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  showAuthBanner(false);
  return data;
}

function showAuthBanner(show) {
  $('authBanner').hidden = !show;
}

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
function setPill(el, text, tone = 'idle') {
  el.textContent = text;
  el.className = `pill pill-${tone}`;
}
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function renderKv(container, pairs) {
  container.replaceChildren();
  for (const [key, value] of pairs) {
    container.append(el('dt', null, key));
    const dd = el('dd', null, value === undefined || value === null || value === '' ? '—' : value);
    if (typeof value === 'string' && /^[\x20-\x7e]+$/.test(value) && /[\\/]|^ses_|^[0-9a-f]{12,}$/.test(value)) dd.classList.add('mono');
    container.append(dd);
  }
}

// ---------------------------------------------------------------------------
// toasts
// ---------------------------------------------------------------------------
function toast(title, body = '', tone = 'info', ms) {
  const node = el('div', `toast ${tone}`);
  node.append(el('span', 'toast-title', title));
  if (body) node.append(el('span', 'toast-body', body));
  $('toasts').append(node);
  const life = ms ?? (tone === 'error' ? 10_000 : tone === 'warn' ? 8000 : 5000);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .2s';
    setTimeout(() => node.remove(), 220);
  }, life);
}

// ---------------------------------------------------------------------------
// status rendering
// ---------------------------------------------------------------------------
async function refreshStatus() {
  if (state.statusBusy) return;
  state.statusBusy = true;
  try {
    const s = await api('/api/status');
    state.status = s;
    state.offline = false;
    renderStatus(s);
  } catch (err) {
    if (err.network) {
      setPill($('centerPill'), 'center unreachable', 'bad');
      if (!state.offline) toast('Control center unreachable', err.message, 'error');
      state.offline = true;
    }
  } finally {
    state.statusBusy = false;
  }
}

function renderStatus(s) {
  setPill($('centerPill'), `center ${s.center.version}`, 'ok');
  $('centerMeta').textContent = `pid ${s.center.pid} · node ${s.center.node} · ${s.center.platform}/${s.center.arch} · up ${fmtDuration(s.center.uptimeMs)}`;
  $('repoPath').textContent = s.repo.root;

  renderApp(s);
  renderAi(s.ai);
  renderBuild(s);
  renderCheckpoints(s.checkpoints);
  renderSystem(s);

  // Read the account model libraries once per running app instance.
  const appKey = s.app.status === 'running' ? s.app.url : null;
  if (appKey && state.modelsAppKey !== appKey) {
    state.modelsAppKey = appKey;
    state.models = null;
    loadModels(false);
  } else if (!appKey) {
    state.modelsAppKey = null;
  }
}

function renderApp(s) {
  const app = s.app;
  const tone = { running: 'ok', starting: 'run', crashed: 'bad', stopped: 'idle' }[app.status] || 'idle';
  setPill($('appPill'), app.status, tone);
  $('appMode').textContent = app.mode ? `${app.mode} mode` : 'No process';

  const pairs = [
    ['URL', app.url || '—'],
    ['Port', app.port || '—'],
    ['PID', app.pid || '—'],
    ['Uptime', app.status === 'running' || app.status === 'starting' ? fmtDuration(app.uptimeMs) : '—'],
    ['Owner', app.owned ? 'control center' : app.status === 'running' ? 'external' : '—'],
    ['Git', `${s.repo.git.branch}@${s.repo.git.commit}${s.repo.git.dirty ? ` · ${s.repo.git.changedFiles} changed` : ' · clean'}`],
  ];
  renderKv($('appKv'), pairs);

  const foot = $('appFoot');
  foot.replaceChildren();
  if (app.status === 'running' && app.url) {
    const link = el('a', 'btn btn-tiny btn-ghost', 'Open app');
    link.href = app.url;
    link.target = '_blank';
    link.rel = 'noopener';
    foot.append(link);
  } else if (app.error) {
    foot.append(el('p', 'hint', app.error));
  } else if (app.lastCrashCode !== null && app.lastCrashCode !== undefined) {
    foot.append(el('p', 'hint', `Last crash: exit ${app.lastCrashCode} at ${fmtDateTime(app.lastCrashAt)}`));
  } else {
    foot.append(el('p', 'hint', 'Launch a mode from the controls panel.'));
  }

  // Preview
  const frame = $('preview');
  const empty = $('previewEmpty');
  if (app.status === 'running' && app.url) {
    empty.hidden = true;
    const current = frame.getAttribute('data-src');
    if (current !== app.url) {
      frame.setAttribute('data-src', app.url);
      frame.src = app.url;
    }
    $('previewUrl').textContent = `${app.url} · ${app.mode || 'app'} · pid ${app.pid || 'external'}`;
  } else {
    empty.hidden = false;
    frame.removeAttribute('data-src');
    if (frame.getAttribute('src')) frame.removeAttribute('src');
    $('previewUrl').textContent = app.status === 'starting' ? 'Starting…' : 'Stopped.';
  }

  $('btnStop').disabled = !(app.status === 'running' || app.status === 'starting');
  $('btnRestart').disabled = !(app.status === 'running' || app.status === 'starting');
  $('btnOpenApp').disabled = !(app.status === 'running' || app.status === 'starting');
}

function renderAi(ai) {
  const box = $('aiProviders');
  box.replaceChildren();
  if (!ai || ai.connected === false) {
    setPill($('aiPill'), 'unavailable', 'warn');
    box.append(el('span', 'muted small', ai?.reason || 'App is not running.'));
    $('aiHint').textContent = 'Start the app to read provider connection state.';
    return;
  }
  const ids = ['gemini', 'chatgpt', 'claude', 'grok'];
  const connected = ids.filter((id) => ai.providers?.[id]?.connected);
  setPill($('aiPill'), `${connected.length} connected`, connected.length ? 'ok' : 'warn');
  for (const id of ids) {
    const on = Boolean(ai.providers?.[id]?.connected);
    const chip = el('span', `chip ${on ? 'on' : 'off'}`);
    chip.append(el('span', 'chip-dot'));
    chip.append(document.createTextNode(`${id}${on ? '' : ' · not connected'}`));
    box.append(chip);
  }
  $('aiHint').textContent = 'Live /api/oauth/status. Connection alone does not guarantee plan entitlement: the app\'s active provider must support prompts (ChatGPT plans without Codex access return HTTP 502).';
}

// ---------------------------------------------------------------------------
// account model libraries
// ---------------------------------------------------------------------------
const PROVIDER_LABELS = { gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', grok: 'Grok' };

async function loadModels(force = false) {
  if (state.modelsBusy) return;
  const app = state.status?.app;
  if (!app || app.status !== 'running') {
    $('modelsMeta').textContent = 'app not running';
    $('modelProviders').replaceChildren(el('p', 'muted small', 'Launch the app to read its provider libraries.'));
    return;
  }
  state.modelsBusy = true;
  $('modelsMeta').textContent = 'searching providers…';
  $('btnFindModels').disabled = true;
  try {
    const r = await api(`/api/ai/models${force ? '?refresh=1' : ''}`);
    if (!r.ok) throw new Error(r.error || 'Could not read the model libraries.');
    state.models = r;
    state.modelsAt = new Date();
    renderModelLibraries(r);
  } catch (err) {
    $('modelsMeta').textContent = 'failed';
    $('modelProviders').replaceChildren(el('p', 'model-error', err.message));
  } finally {
    state.modelsBusy = false;
    $('btnFindModels').disabled = false;
  }
}

function renderModelLibraries(payload) {
  const box = $('modelProviders');
  box.replaceChildren();
  const providers = payload.providers || {};
  const errors = payload.errors || {};
  const connected = state.status?.ai?.providers || {};
  const order = ['claude', 'grok', 'chatgpt', 'gemini'];
  let total = 0;

  for (const id of order) {
    const models = Array.isArray(providers[id]) ? providers[id] : [];
    const on = Boolean(connected[id]?.connected) || models.length > 0;
    total += models.length;
    const section = el('div', 'model-provider');
    const head = el('div', 'model-provider-head');
    const chip = el('span', `chip ${on ? 'on' : 'off'}`);
    chip.append(el('span', 'chip-dot'));
    chip.append(document.createTextNode(PROVIDER_LABELS[id] || id));
    head.append(chip);
    head.append(el('span', 'muted small', on ? `${models.length} model${models.length === 1 ? '' : 's'}` : 'not connected'));
    const spacer = el('span', 'spacer');
    head.append(spacer);
    if (models.length) {
      const copyAll = el('button', 'btn btn-tiny btn-ghost', 'Copy all ids');
      copyAll.type = 'button';
      copyAll.addEventListener('click', () => copyText(models.map((m) => m.id).join('\n'), `${models.length} ${PROVIDER_LABELS[id]} model ids copied`));
      head.append(copyAll);
    }
    section.append(head);

    if (models.length) {
      const list = el('div', 'model-list');
      for (const model of models) {
        const button = el('button', 'model-chip', model.id);
        button.type = 'button';
        button.title = `${model.name && model.name !== model.id ? `${model.name}\n` : ''}Click to copy ${model.id}`;
        button.addEventListener('click', () => copyText(model.id, `Copied ${model.id}`));
        list.append(button);
      }
      section.append(list);
    } else {
      section.append(el('p', 'model-empty', on ? 'The provider returned no usable chat models for this plan.' : 'Sign in from the app to search this library.'));
    }
    if (errors[id]) {
      section.append(el('p', 'model-error', errors[id]));
    }
    box.append(section);
  }

  const stamp = state.modelsAt ? fmtTime(state.modelsAt) : '';
  $('modelsMeta').textContent = `${total} model${total === 1 ? '' : 's'}${stamp ? ` · ${stamp}` : ''}`;
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message, '', 'ok', 3000);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    try {
      document.execCommand('copy');
      toast(message, 'Copied via the fallback clipboard path.', 'ok', 3000);
    } catch {
      toast('Could not copy', 'Select the text manually.', 'warn');
    } finally {
      area.remove();
    }
  }
}

function renderBuild(s) {
  const b = s.build;
  const t = s.test;
  const p = s.package;
  let tone = 'idle';
  let label = 'none yet';
  if (p) { tone = p.ok ? 'ok' : 'bad'; label = `package ${p.ok ? 'pass' : 'fail'}`; }
  else if (t) { tone = t.ok ? 'ok' : 'bad'; label = `tests ${t.ok ? 'pass' : 'fail'}`; }
  else if (b) { tone = b.ok ? 'ok' : 'bad'; label = `build ${b.ok ? 'pass' : 'fail'}`; }
  setPill($('buildPill'), label, tone);

  renderKv($('buildKv'), [
    ['Build', b ? `${b.ok ? 'pass' : 'fail'} · ${fmtDateTime(b.at)}` : 'never run'],
    ['Tests', t ? `${t.ok ? 'pass' : 'fail'} · ${fmtDateTime(t.at)}` : 'never run'],
    ['Package', p ? `${p.ok ? 'pass' : 'fail'} · ${fmtDateTime(p.at)}` : 'never run'],
    ['dist/assets', `${s.repo.dist.assetCount} files · ${fmtBytes(s.repo.dist.bytes)}`],
    ['server.mjs', s.repo.dist.serverBundle.exists ? fmtBytes(s.repo.dist.serverBundle.bytes) : 'missing'],
  ]);

  const foot = $('installerFoot');
  foot.replaceChildren();
  if (s.installer) {
    foot.append(el('p', 'hint', `Installer: ${s.installer.name} · ${fmtBytes(s.installer.bytes)} · ${fmtDateTime(s.installer.mtimeMs)}`));
    foot.append(el('p', 'hint mono', s.installer.path));
  } else {
    foot.append(el('p', 'hint', 'No installer in release/ yet.'));
  }
}

function renderSystem(s) {
  renderKv($('systemKv'), [
    ['Center', `v${s.center.version}`],
    ['Port', s.center.port],
    ['PID', s.center.pid],
    ['Node', s.center.node],
    ['Platform', `${s.center.platform} ${s.center.arch}`],
    ['App version', s.repo.version],
    ['Framework', s.repo.framework],
    ['Data dir', s.paths.data],
    ['Token file', s.paths.tokenFile],
  ]);
}

// ---------------------------------------------------------------------------
// checkpoints
// ---------------------------------------------------------------------------
function renderCheckpoints(list) {
  const box = $('checkpointList');
  const signature = JSON.stringify((list || []).map((c) => [c.file, c.bytes, c.mtimeMs]));
  if (signature === state.checkpointSignature) return;
  state.checkpointSignature = signature;
  box.replaceChildren();
  if (!list || !list.length) {
    box.append(el('p', 'muted small', 'No checkpoints yet.'));
    return;
  }
  for (const cp of list) {
    const row = el('label', 'checkpoint-row');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'cp';
    radio.value = cp.file;
    const main = el('span', 'cp-main');
    main.append(el('span', 'cp-name', cp.label ? `${cp.label} · ${cp.file}` : cp.file));
    main.append(el('span', 'cp-meta', `${fmtBytes(cp.bytes)} · ${fmtDateTime(cp.mtimeMs)}${cp.git ? ` · ${cp.git.branch}@${cp.git.commit}` : ''}`));
    row.append(radio, main);
    box.append(row);
  }
}

// ---------------------------------------------------------------------------
// logs
// ---------------------------------------------------------------------------
function logQuery() {
  const params = new URLSearchParams();
  params.set('since', String(state.lastSeq));
  const level = $('logLevel').value;
  const source = $('logSource').value;
  const q = $('logSearch').value.trim();
  if (level) params.set('level', level);
  if (source) params.set('source', source);
  if (q) params.set('q', q);
  params.set('limit', '500');
  return params.toString();
}

async function pollLogs(force = false) {
  if (state.logsBusy) return;
  const sig = `${$('logLevel').value}|${$('logSource').value}|${$('logSearch').value.trim()}`;
  if (sig !== state.logSignature) {
    state.logSignature = sig;
    state.lastSeq = 0;
    state.logs = [];
    $('logList').replaceChildren();
    $('logCount').textContent = '';
  }
  state.logsBusy = true;
  try {
    const data = await api(`/api/logs?${logQuery()}`);
    state.lastSeq = Math.max(state.lastSeq, data.lastSeq || 0);
    appendLogs(data.entries || []);
    $('logCount').textContent = `${state.logs.length} shown${data.dropped ? ` · ${data.dropped} older` : ''}`;
  } catch (err) {
    if (err.network) setPill($('centerPill'), 'center unreachable', 'bad');
  } finally {
    state.logsBusy = false;
  }
}

function appendLogs(entries) {
  if (!entries.length) return;
  const list = $('logList');
  const atBottom = state.follow || (list.scrollHeight - list.scrollTop - list.clientHeight < 40);
  for (const entry of entries) {
    state.logs.push(entry);
    const line = el('div', `log-line ${entry.level}`);
    line.append(el('span', 'log-time', fmtTime(entry.ts)));
    line.append(el('span', `log-level ${entry.level}`, entry.level));
    line.append(el('span', 'log-source', entry.source));
    line.append(el('span', 'log-text', entry.text));
    list.append(line);
  }
  while (list.children.length > 1500) list.firstElementChild.remove();
  if (state.logs.length > 1500) state.logs.splice(0, state.logs.length - 1500);
  if (atBottom) list.scrollTop = list.scrollHeight;
}

async function exportLogs() {
  try {
    const headers = state.token ? { 'x-debug-token': state.token } : {};
    const res = await fetch('/api/logs/export', { headers, credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error(`Export failed (HTTP ${res.status}).`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pulse-med-debug-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Logs exported', 'The full in-memory log buffer was downloaded.', 'ok');
  } catch (err) {
    toast('Export failed', err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// app controls
// ---------------------------------------------------------------------------
async function withButton(button, label, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await fn();
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}

async function launchApp(mode) {
  if (mode === 'electron' && !confirm('Launch the Electron desktop window? It opens a native window on this machine.')) return;
  const btn = $('btnLaunch');
  try {
    const result = await withButton(btn, 'Launching…', () => api('/api/app/start', { method: 'POST', body: { mode } }));
    if (result?.ok) toast('Application running', result.app?.url || '', 'ok');
    else toast('Application did not answer its health check', 'Check the logs for startup errors.', 'warn');
    await refreshStatus();
    await pollLogs(true);
  } catch (err) {
    toast('Launch failed', err.message, 'error');
    await refreshStatus();
  }
}

async function stopApp() {
  if (!confirm('Stop the running application? Unsaved work inside the app will be lost.')) return;
  try {
    await withButton($('btnStop'), 'Stopping…', () => api('/api/app/stop', { method: 'POST', body: {} }));
    toast('Application stopped', '', 'ok');
    await refreshStatus();
  } catch (err) {
    toast('Stop failed', err.message, 'warn');
  }
}

async function restartApp() {
  if (!confirm('Restart the application now?')) return;
  try {
    const result = await withButton($('btnRestart'), 'Restarting…', () => api('/api/app/restart', { method: 'POST', body: {} }));
    toast(result?.ok ? 'Application restarted' : 'Restart finished with warnings', result?.app?.url || '', result?.ok ? 'ok' : 'warn');
    await refreshStatus();
    await pollLogs(true);
  } catch (err) {
    toast('Restart failed', err.message, 'error');
  }
}

async function openApp() {
  try {
    const r = await api('/api/app/open', { method: 'POST', body: {} });
    toast('Opened in browser', r.opened, 'ok');
  } catch (err) {
    toast('Could not open app', err.message, 'warn');
  }
}

async function inspectErrors() {
  $('logLevel').value = 'error';
  state.lastSeq = 0;
  state.logs = [];
  $('logList').replaceChildren();
  await pollLogs(true);
  $('logList').scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast('Showing error-level logs', 'Switch the level filter back to “All levels” to see everything.', 'info');
}

// ---------------------------------------------------------------------------
// jobs (tests / build / package)
// ---------------------------------------------------------------------------
async function startJob(kind) {
  const config = {
    tests: { path: '/api/tests/run', label: 'Verification started' },
    build: { path: '/api/build', label: 'Build started' },
    package: { path: '/api/package', label: 'Installer build started' },
  }[kind];
  if (!config) return;
  if (kind === 'package' && !confirm('Build the Windows x64 installer? This takes several minutes and overwrites release\\PulseMed-Setup-*.exe.')) return;
  try {
    const r = await api(config.path, { method: 'POST', body: {} });
    state.jobWasActive = true;
    $('jobProgress').hidden = false;
    renderJob(r.job);
    toast(config.label, r.message || '', 'ok');
    $('jobProgress').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    pollActiveJob();
  } catch (err) {
    toast(`${kind} could not start`, err.message, 'error');
  }
}

async function pollActiveJob() {
  if (state.jobsBusy) return;
  state.jobsBusy = true;
  try {
    const r = await api('/api/jobs/active');
    const job = r.job;
    if (job) {
      state.jobWasActive = true;
      $('jobProgress').hidden = false;
      renderJob(job);
    } else if (state.jobWasActive) {
      state.jobWasActive = false;
      $('jobProgress').hidden = true;
      toast('Job finished', 'See the Build & artifacts card and the logs for the outcome.', 'info');
      await refreshStatus();
      await pollLogs(true);
    }
  } catch { /* transient */ } finally {
    state.jobsBusy = false;
  }
}

function renderJob(job) {
  if (!job) return;
  setPill($('jobKind'), job.kind, job.status === 'running' ? 'run' : job.status === 'succeeded' ? 'ok' : 'bad');
  const started = new Date(job.startedAt).getTime();
  const ended = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
  $('jobElapsed').textContent = `${fmtDuration(ended - started)} · ${job.status}`;
  const list = $('jobSteps');
  list.replaceChildren();
  const items = job.kind === 'tests' && Array.isArray(job.checks) && job.checks.length
    ? job.checks.map((c) => ({ name: c.name, status: c.ok ? 'ok' : 'failed', ms: undefined, detail: c.detail }))
    : job.steps || [];
  if (!items.length) {
    list.append(el('li', 'running', 'Starting…'));
    return;
  }
  for (const step of items) {
    const li = el('li', step.status || 'running');
    li.append(el('span', 'dot'));
    li.append(el('span', 'grow', step.name));
    if (step.ms !== undefined) li.append(el('span', 'ms', fmtDuration(step.ms)));
    list.append(li);
  }
}

// ---------------------------------------------------------------------------
// checkpoints
// ---------------------------------------------------------------------------
async function createCheckpoint() {
  try {
    const r = await withButton($('btnCheckpoint'), 'Creating…', () => api('/api/checkpoints', { method: 'POST', body: { label: 'manual' } }));
    toast('Checkpoint created', `${r.checkpoint.file} · ${fmtBytes(r.checkpoint.bytes)}`, 'ok');
    state.checkpointSignature = '';
    await refreshStatus();
  } catch (err) {
    toast('Checkpoint failed', err.message, 'error');
  }
}

async function restoreCheckpoint() {
  const checked = document.querySelector('input[name="cp"]:checked');
  if (!checked) {
    toast('Select a checkpoint first', 'Pick one from the list, then restore.', 'warn');
    return;
  }
  const file = checked.value;
  const answer = prompt(`Restore ${file}?\n\nThis overwrites tracked source files in the repository. The app must be stopped. A safety checkpoint is created first.\n\nType RESTORE to confirm.`);
  if (answer !== 'RESTORE') {
    if (answer !== null) toast('Restore cancelled', 'The confirmation text did not match RESTORE.', 'warn');
    return;
  }
  try {
    const r = await withButton($('btnRestore'), 'Restoring…', () => api('/api/checkpoints/restore', { method: 'POST', body: { file, confirm: 'RESTORE' } }));
    toast('Checkpoint restored', r.restored, 'ok');
    state.checkpointSignature = '';
    await refreshStatus();
    await pollLogs(true);
  } catch (err) {
    toast('Restore failed', err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------
function init() {
  $('logFollow').checked = true;
  $('logFollow').addEventListener('change', (e) => { state.follow = e.target.checked; });

  $('btnRefresh').addEventListener('click', () => { refreshStatus(); pollLogs(true); });
  $('btnExportLogs').addEventListener('click', exportLogs);
  $('btnExportLogs2')?.addEventListener('click', exportLogs);
  $('btnClearLogs').addEventListener('click', async () => {
    if (!confirm('Clear the in-memory log buffer? This does not delete files on disk.')) return;
    try {
      await api('/api/logs/clear', { method: 'POST', body: {} });
      state.lastSeq = 0;
      state.logs = [];
      $('logList').replaceChildren();
      $('logCount').textContent = '';
      toast('Log buffer cleared', '', 'ok');
    } catch (err) { toast('Could not clear logs', err.message, 'error'); }
  });
  $('logSearch').addEventListener('input', () => pollLogs(true));
  $('logLevel').addEventListener('change', () => pollLogs(true));
  $('logSource').addEventListener('change', () => pollLogs(true));

  $('btnLaunch').addEventListener('click', () => launchApp($('appModeSelect').value));
  $('btnStop').addEventListener('click', stopApp);
  $('btnRestart').addEventListener('click', restartApp);
  $('btnOpenApp').addEventListener('click', openApp);
  $('btnInspect').addEventListener('click', inspectErrors);
  $('btnTests').addEventListener('click', () => startJob('tests'));
  $('btnBuild').addEventListener('click', () => startJob('build'));
  $('btnPackage').addEventListener('click', () => startJob('package'));
  $('btnFindModels').addEventListener('click', () => loadModels(true));

  $('btnPreviewReload').addEventListener('click', () => {
    const frame = $('preview');
    const src = frame.getAttribute('data-src');
    if (src) frame.src = `${src}${src.includes('?') ? '&' : '?'}_=${Date.now()}`;
  });
  $('btnPreviewOpen').addEventListener('click', openApp);
  $('btnPreviewLaunch').addEventListener('click', () => launchApp('dev'));

  $('btnCheckpoint').addEventListener('click', createCheckpoint);
  $('btnRestore').addEventListener('click', restoreCheckpoint);

  $('btnToken').addEventListener('click', () => {
    $('tokenInput').value = state.token;
    $('tokenDialog').showModal();
  });
  $('btnAuthBanner').addEventListener('click', () => {
    $('tokenInput').value = state.token;
    $('tokenDialog').showModal();
  });
  $('btnTokenSave').addEventListener('click', () => {
    const token = $('tokenInput').value.trim();
    if (!token) {
      toast('Token is empty', 'Paste the token from debug-center-data\\.token.', 'warn');
      return;
    }
    localStorage.setItem('pmdc.token', token);
    location.reload();
  });
  $('btnTokenClear').addEventListener('click', () => {
    localStorage.removeItem('pmdc.token');
    location.reload();
  });

  refreshStatus();
  pollLogs(true);
  pollActiveJob();

  setInterval(refreshStatus, 2500);
  setInterval(() => pollLogs(false), 1200);
  setInterval(pollActiveJob, 1500);
}

init();
