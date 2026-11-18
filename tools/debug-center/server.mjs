#!/usr/bin/env node
/**
 * Pulse Med — Debug Control Center
 *
 * A local-only dashboard that can launch/stop the app, stream logs, run tests,
 * and manage checkpoints. It deliberately exposes NO arbitrary-command endpoint:
 * every action below is a fixed, reviewed command.
 *
 * Bind: 127.0.0.1 only. Auth: random token + cookie + custom header for writes.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(ROOT, 'debug-center-data');
const CHECKPOINTS = path.join(DATA, 'checkpoints');
const TOKEN_FILE = path.join(DATA, '.token');
const STATE_FILE = path.join(DATA, 'state.json');
const BUILD_FILE = path.join(DATA, 'build.json');
const CHECKPOINT_FILE = path.join(DATA, 'checkpoints.json');

const APP_VERSION = '1.0.0';
const CENTER_VERSION = '1.0.0';
const HOST = '127.0.0.1';
const PORT = Number(process.env.DEBUG_CENTER_PORT || 4319);
const DEV_PORT = 3400;
const PROD_PORT = 3401;
const ELECTRON_PORT = 3217;

for (const dir of [DATA, CHECKPOINTS]) fs.mkdirSync(dir, { recursive: true });

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------
const nowIso = () => new Date().toISOString();
const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
function fileExists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function dirExists(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function sizeOf(p) { try { return fs.statSync(p).size; } catch { return 0; } }
function mtimeOf(p) { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }

/** Run a process, capture output, report complete lines. No shell is ever used. */
function runProcess(file, args, opts = {}) {
  return new Promise((resolve) => {
    const {
      cwd = ROOT, env = {}, timeoutMs = 0, source = 'process', onLine = null, maxOutput = 4 * 1024 * 1024,
    } = opts;
    let child;
    try {
      child = spawn(file, args, {
        cwd,
        env: { ...process.env, ...env },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ code: -1, signal: null, error: String(err), stdout: '', stderr: String(err) });
      return;
    }
    let stdout = '';
    let stderr = '';
    const pending = { stdout: '', stderr: '' };
    const consume = (chunk, isErr) => {
      const text = chunk.toString('utf8');
      if (isErr) stderr = (stderr + text).slice(-maxOutput);
      else stdout = (stdout + text).slice(-maxOutput);
      pending[isErr ? 'stderr' : 'stdout'] += text;
      const parts = pending[isErr ? 'stderr' : 'stdout'].split(/\r?\n/);
      pending[isErr ? 'stderr' : 'stdout'] = parts.pop() || '';
      for (const line of parts) {
        if (line.trim()) {
          if (onLine) { try { onLine(line, isErr ? 'stderr' : 'stdout'); } catch { /* ignore */ } }
          else logLine(isErr ? 'warn' : 'info', source, line);
        }
      }
    };
    child.stdout.on('data', (d) => consume(d, false));
    child.stderr.on('data', (d) => consume(d, true));
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }); } catch { /* ignore */ }
      }, timeoutMs);
    }
    const finish = (code, signal, error) => {
      if (timer) clearTimeout(timer);
      for (const stream of ['stdout', 'stderr']) {
        const tail = pending[stream];
        if (tail && tail.trim()) {
          if (onLine) { try { onLine(tail, stream === 'stderr' ? 'stderr' : 'stdout'); } catch { /* ignore */ } }
          else logLine(stream === 'stderr' ? 'warn' : 'info', source, tail);
        }
      }
      resolve({ code, signal, error, stdout, stderr });
    };
    child.on('error', (err) => finish(-1, null, String(err)));
    child.on('close', (code, signal) => finish(code, signal, null));
  });
}

function runSync(file, args, opts = {}) {
  try {
    return spawnSync(file, args, {
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ...(opts.env || {}) },
      encoding: 'utf8',
      windowsHide: true,
      timeout: opts.timeoutMs || 30_000,
      maxBuffer: opts.maxBuffer || 16 * 1024 * 1024,
    });
  } catch (err) {
    return { status: -1, stdout: '', stderr: String(err), error: err };
  }
}

// ---------------------------------------------------------------------------
// logging ring buffer
// ---------------------------------------------------------------------------
const MAX_LOGS = 5000;
const logRing = [];
let logSeq = 0;
function logLine(level, source, text) {
  const clean = String(text ?? '').replace(/\u0000/g, '');
  if (!clean.trim()) return;
  const entry = { seq: ++logSeq, ts: Date.now(), level: level || 'info', source: source || 'center', text: clean.slice(0, 20_000) };
  logRing.push(entry);
  if (logRing.length > MAX_LOGS) logRing.splice(0, logRing.length - MAX_LOGS);
  const prefix = `[${entry.source}]`;
  if (entry.level === 'error') console.error(prefix, entry.text);
  else if (entry.level === 'warn') console.warn(prefix, entry.text);
  else console.log(prefix, entry.text);
}
function levelFromText(line) {
  if (/\b(error|fatal|exception|failed|ERR_)\b/i.test(line)) return 'error';
  if (/\b(warn|warning|deprecated)\b/i.test(line)) return 'warn';
  if (/\b(debug|trace)\b/i.test(line)) return 'debug';
  return 'info';
}
function queryLogs({ since = 0, level = '', q = '', source = '', limit = 400 } = {}) {
  const needle = String(q || '').toLowerCase();
  const src = String(source || '').toLowerCase();
  const lv = String(level || '').toLowerCase();
  let rows = logRing.filter((e) => e.seq > Number(since || 0));
  if (lv) rows = rows.filter((e) => e.level === lv);
  if (src) rows = rows.filter((e) => e.source.toLowerCase().includes(src));
  if (needle) rows = rows.filter((e) => e.text.toLowerCase().includes(needle) || e.source.toLowerCase().includes(needle));
  const total = rows.length;
  rows = rows.slice(-clamp(Number(limit) || 400, 1, 2000));
  return { entries: rows, total, lastSeq: logSeq, dropped: Math.max(0, total - rows.length) };
}

// ---------------------------------------------------------------------------
// persisted state
// ---------------------------------------------------------------------------
const defaultState = {
  appMode: 'dev',
  lastCheckpoint: null,
  checkpoints: [],
};
const state = { ...defaultState, ...readJson(STATE_FILE, {}) };

const buildState = readJson(BUILD_FILE, {
  lastBuild: null, lastTest: null, lastPackage: null, running: null,
});
let checkpoints = readJson(CHECKPOINT_FILE, []);
if (!Array.isArray(checkpoints)) checkpoints = [];

function saveState() { writeJson(STATE_FILE, state); }
function saveBuild() { writeJson(BUILD_FILE, buildState); }
function saveCheckpoints() { writeJson(CHECKPOINT_FILE, checkpoints); }

// ---------------------------------------------------------------------------
// auth token
// ---------------------------------------------------------------------------
function ensureToken() {
  if (process.env.DEBUG_CENTER_TOKEN) return process.env.DEBUG_CENTER_TOKEN;
  try {
    const existing = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (/^[a-f0-9]{32,128}$/i.test(existing)) return existing;
  } catch { /* create */ }
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}
const TOKEN = ensureToken();

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function tokenFromRequest(req, url) {
  const header = req.headers['x-debug-token'];
  if (header) return String(header);
  const auth = req.headers.authorization || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const cookie = parseCookies(req).pmdc_token;
  if (cookie) return cookie;
  const q = url?.searchParams?.get('token');
  return q || '';
}
function isAuthed(req, url) { return safeEqual(tokenFromRequest(req, url), TOKEN); }
function hostAllowed(req) {
  const host = String(req.headers.host || '').toLowerCase();
  return host === `${HOST}:${PORT}` || host === `localhost:${PORT}` || host === `${HOST}` || host === 'localhost';
}
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches may omit it; CSRF forms cannot set the token header
  return origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}
function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(text);
}
function readJsonBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON body.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function serveStatic(res, file, type) {
  try {
    const stat = fs.statSync(file);
    res.writeHead(200, {
      'content-type': type,
      'content-length': stat.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-src http://127.0.0.1:* http://localhost:*; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'self'",
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    sendText(res, 404, 'Not found');
  }
}
function contentTypeFor(p) {
  const ext = path.extname(p).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json',
  }[ext] || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// app process management
// ---------------------------------------------------------------------------
const appState = {
  status: 'stopped', mode: null, pid: null, child: null, url: null, port: null,
  startedAt: null, exitCode: null, error: null, owned: false, intentionalStop: false,
  lastCrashAt: null, lastCrashCode: null,
};
const APP_PORTS = [
  { port: ELECTRON_PORT, mode: 'electron' },
  { port: DEV_PORT, mode: 'dev' },
  { port: PROD_PORT, mode: 'prod' },
  { port: 3300, mode: 'dev-external' },
];

function httpProbe(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https:') ? import('node:https') : null;
    const doReq = (httpsMod) => {
      const lib = httpsMod || http;
      const req = lib.get(url, { timeout: timeoutMs }, (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode });
      });
      req.on('error', () => resolve({ ok: false, error: 'connection failed' }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    };
    if (mod) mod.then((m) => doReq(m)).catch(() => resolve({ ok: false, error: 'https unavailable' }));
    else doReq(null);
  });
}

function appEnv(mode) {
  return {
    PORT: String(mode === 'dev' ? DEV_PORT : mode === 'prod' ? PROD_PORT : ELECTRON_PORT),
    NODE_ENV: mode === 'prod' || mode === 'electron' ? 'production' : 'development',
    PULSE_DATA_DIR: path.join(os.homedir(), '.pulse-med'),
    ...(mode === 'electron' ? { ELECTRON_ENABLE_LOGGING: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } : {}),
  };
}

function detectExternalApp() {
  return new Promise(async (resolve) => {
    for (const candidate of APP_PORTS) {
      const url = `http://127.0.0.1:${candidate.port}/`;
      const probe = await httpProbe(url, 900);
      if (probe.ok) {
        resolve({ ...candidate, url });
        return;
      }
    }
    resolve(null);
  });
}

async function refreshAppState() {
  if (appState.child && appState.child.exitCode === null) {
    if (appState.status === 'starting') {
      const probe = await httpProbe(appState.url || `http://127.0.0.1:${appState.port}/`, 700);
      if (probe.ok) appState.status = 'running';
    }
    return;
  }
  if (appState.child && appState.child.exitCode !== null && appState.status !== 'stopped') {
    const code = appState.child.exitCode;
    appState.status = appState.intentionalStop ? 'stopped' : 'crashed';
    appState.exitCode = code;
    if (!appState.intentionalStop) {
      appState.lastCrashAt = nowIso();
      appState.lastCrashCode = code;
      logLine('error', 'app', `Application exited unexpectedly with code ${code}.`);
    }
    appState.child = null;
    appState.pid = null;
    appState.owned = false;
    return;
  }
  if (appState.status === 'running' && appState.owned && !appState.child) {
    appState.status = 'stopped';
  }
  // External instance detection (started outside the control center).
  const external = await detectExternalApp();
  if (external) {
    if (!appState.owned) {
      appState.status = 'running';
      appState.mode = appState.mode || external.mode;
      appState.port = external.port;
      appState.url = external.url;
      appState.pid = appState.pid || null;
      appState.owned = false;
    }
  } else if (!appState.owned && appState.status === 'running') {
    appState.status = 'stopped';
    appState.pid = null;
    appState.url = null;
    appState.port = null;
  }
}

async function startApp(mode = 'dev') {
  if (!['dev', 'prod', 'electron'].includes(mode)) throw Object.assign(new Error('Unknown app mode.'), { status: 400 });
  await refreshAppState();
  if (['starting', 'running'].includes(appState.status)) {
    return { ok: true, alreadyRunning: true, app: publicApp() };
  }
  if (mode === 'prod' && !fileExists(path.join(ROOT, 'server.mjs'))) {
    throw Object.assign(new Error('server.mjs is missing. Build the app first.'), { status: 409 });
  }
  let file;
  let args;
  if (mode === 'dev') {
    file = process.execPath;
    args = [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server.ts'];
  } else if (mode === 'prod') {
    file = process.execPath;
    args = [path.join(ROOT, 'server.mjs')];
  } else {
    const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
    if (!fileExists(electron)) throw Object.assign(new Error('Electron is not installed (node_modules/electron missing).'), { status: 409 });
    file = electron;
    args = ['.'];
  }
  const child = spawn(file, args, {
    cwd: ROOT,
    windowsHide: true,
    env: { ...process.env, ...appEnv(mode) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = mode === 'dev' ? DEV_PORT : mode === 'prod' ? PROD_PORT : ELECTRON_PORT;
  appState.child = child;
  appState.pid = child.pid;
  appState.mode = mode;
  appState.port = port;
  appState.url = `http://127.0.0.1:${port}/`;
  appState.startedAt = nowIso();
  appState.exitCode = null;
  appState.error = null;
  appState.owned = true;
  appState.intentionalStop = false;
  appState.status = 'starting';
  state.appMode = mode;
  saveState();
  logLine('info', 'app', `Starting ${mode} app (PID ${child.pid}) on ${appState.url}`);

  const onData = (stream) => (chunk) => {
    const text = chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) {
        logLine(levelFromText(line), 'app', line);
        if (mode === 'electron' && /DevTools listening on (ws:\/\/\S+)/.test(line)) {
          appState.devtools = line.match(/DevTools listening on (ws:\/\/\S+)/)[1];
        }
      }
    }
  };
  child.stdout.on('data', onData('stdout'));
  child.stderr.on('data', onData('stderr'));
  child.on('error', (err) => {
    appState.status = 'crashed';
    appState.error = String(err);
    logLine('error', 'app', `Could not start the app: ${String(err)}`);
  });
  child.on('exit', (code, signal) => {
    if (appState.child === child) appState.child = null;
    const wasIntentional = appState.intentionalStop;
    appState.pid = null;
    appState.exitCode = code;
    appState.owned = false;
    if (wasIntentional) {
      appState.status = 'stopped';
      logLine('info', 'app', `Application stopped (exit ${code ?? signal}).`);
    } else {
      appState.status = 'crashed';
      appState.lastCrashAt = nowIso();
      appState.lastCrashCode = code;
      logLine('error', 'app', `Application crashed (exit ${code ?? signal}).`);
    }
  });

  const deadline = Date.now() + 70_000;
  while (Date.now() < deadline) {
    if (appState.status === 'crashed') break;
    const probe = await httpProbe(appState.url, 1000);
    if (probe.ok) {
      appState.status = 'running';
      logLine('info', 'app', `Application is up at ${appState.url} (HTTP ${probe.status}).`);
      break;
    }
    await sleep(500);
  }
  if (appState.status !== 'running') {
    appState.status = appState.status === 'crashed' ? 'crashed' : 'starting';
    if (appState.status === 'starting') logLine('warn', 'app', 'The app process started but did not answer its health check yet.');
  }
  return { ok: appState.status === 'running', app: publicApp() };
}

async function stopApp() {
  await refreshAppState();
  if (appState.owned && appState.pid) {
    appState.intentionalStop = true;
    logLine('info', 'app', `Stopping app tree (PID ${appState.pid}).`);
    runSync('taskkill.exe', ['/PID', String(appState.pid), '/T', '/F'], { timeoutMs: 15_000 });
    for (let i = 0; i < 30; i++) {
      if (appState.child && appState.child.exitCode !== null) break;
      await sleep(200);
    }
    appState.status = 'stopped';
    appState.child = null;
    appState.pid = null;
    appState.owned = false;
    appState.exitCode = null;
    return { ok: true, app: publicApp() };
  }
  if (appState.status === 'running') {
    throw Object.assign(new Error('This instance was started outside the Debug Control Center. Close it from its own window instead.'), { status: 409 });
  }
  return { ok: true, alreadyStopped: true, app: publicApp() };
}

async function restartApp() {
  const mode = appState.mode || state.appMode || 'dev';
  await stopApp();
  await sleep(600);
  return startApp(mode);
}

function publicApp() {
  const uptimeMs = appState.startedAt ? Date.now() - new Date(appState.startedAt).getTime() : 0;
  return {
    status: appState.status,
    mode: appState.mode,
    pid: appState.pid,
    url: appState.url,
    port: appState.port,
    startedAt: appState.startedAt,
    uptimeMs: appState.status === 'running' || appState.status === 'starting' ? uptimeMs : 0,
    exitCode: appState.exitCode,
    error: appState.error,
    owned: appState.owned,
    devtools: appState.devtools || null,
    lastCrashAt: appState.lastCrashAt,
    lastCrashCode: appState.lastCrashCode,
  };
}

// ---------------------------------------------------------------------------
// git / environment info
// ---------------------------------------------------------------------------
let gitCache = { at: 0, data: null };
function gitInfo(force = false) {
  if (!force && gitCache.data && Date.now() - gitCache.at < 5000) return gitCache.data;
  const branch = runSync('git.exe', ['rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 8000 });
  const commit = runSync('git.exe', ['rev-parse', '--short', 'HEAD'], { timeoutMs: 8000 });
  const status = runSync('git.exe', ['status', '--porcelain'], { timeoutMs: 8000 });
  const data = {
    branch: (branch.stdout || '').trim() || 'unknown',
    commit: (commit.stdout || '').trim() || 'unknown',
    dirty: Boolean((status.stdout || '').trim()),
    changedFiles: (status.stdout || '').split(/\r?\n/).filter(Boolean).length,
  };
  gitCache = { at: Date.now(), data };
  return data;
}

function findInstaller() {
  const release = path.join(ROOT, 'release');
  if (!dirExists(release)) return null;
  const files = fs.readdirSync(release)
    .filter((f) => /\.exe$/i.test(f) && !/uninstall/i.test(f))
    .map((f) => ({ name: f, path: path.join(release, f), bytes: sizeOf(path.join(release, f)), mtimeMs: mtimeOf(path.join(release, f)) }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0] || null;
}

function distInfo() {
  const dist = path.join(ROOT, 'dist');
  const assets = path.join(dist, 'assets');
  const files = dirExists(assets) ? fs.readdirSync(assets) : [];
  return {
    exists: dirExists(dist),
    indexMtime: mtimeOf(path.join(dist, 'index.html')),
    assetCount: files.length,
    bytes: files.reduce((n, f) => n + sizeOf(path.join(assets, f)), 0),
    serverBundle: { exists: fileExists(path.join(ROOT, 'server.mjs')), bytes: sizeOf(path.join(ROOT, 'server.mjs')), mtime: mtimeOf(path.join(ROOT, 'server.mjs')) },
  };
}

// ---------------------------------------------------------------------------
// build / test / package jobs
// ---------------------------------------------------------------------------
let activeJob = null;

function jobSnapshot() {
  if (!activeJob) return null;
  const { child, ...rest } = activeJob;
  return { ...rest, pid: child?.pid || null };
}

async function runBuildJob(kind = 'build') {
  if (activeJob) throw Object.assign(new Error(`A ${activeJob.kind} job is already running.`), { status: 409 });
  const job = { id: uid('job'), kind, status: 'running', startedAt: nowIso(), finishedAt: null, steps: [], error: null, child: null };
  activeJob = job;
  logLine('info', kind, `Starting ${kind} (job ${job.id}).`);
  try {
    const steps = [
      {
        name: 'TypeScript check',
        file: process.execPath,
        args: [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'],
      },
      {
        name: 'Vite client build',
        file: process.execPath,
        args: [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
      },
    ];
    for (const step of steps) {
      const started = Date.now();
      job.steps.push({ name: step.name, status: 'running', startedAt: nowIso() });
      const idx = job.steps.length - 1;
      logLine('info', kind, `▸ ${step.name}`);
      const r = await runProcess(step.file, step.args, {
        source: kind,
        timeoutMs: 10 * 60 * 1000,
        onLine: (line, stream) => logLine(stream === 'stderr' ? 'error' : levelFromText(line), kind, line),
      });
      job.steps[idx] = {
        ...job.steps[idx],
        status: r.code === 0 ? 'ok' : 'failed',
        code: r.code,
        ms: Date.now() - started,
        finishedAt: nowIso(),
        outputTail: (r.stdout + r.stderr).split(/\r?\n/).filter(Boolean).slice(-40).join('\n'),
      };
      if (r.code !== 0) throw new Error(`${step.name} failed with exit code ${r.code}.`);
    }

    job.steps.push({ name: 'Server bundle (esbuild)', status: 'running', startedAt: nowIso() });
    const idx = job.steps.length - 1;
    logLine('info', kind, '▸ Server bundle (esbuild)');
    const esbuild = await import('esbuild');
    const started = Date.now();
    await esbuild.build({
      entryPoints: [path.join(ROOT, 'server.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      outfile: path.join(ROOT, 'server.mjs'),
      external: ['vite'],
      logLevel: 'silent',
    });
    job.steps[idx] = {
      ...job.steps[idx], status: 'ok', code: 0, ms: Date.now() - started, finishedAt: nowIso(),
      outputTail: `Wrote server.mjs (${sizeOf(path.join(ROOT, 'server.mjs'))} bytes).`,
    };

    if (kind === 'package') {
      job.steps.push({ name: 'electron-builder (NSIS x64)', status: 'running', startedAt: nowIso() });
      const pIdx = job.steps.length - 1;
      logLine('info', kind, '▸ electron-builder (NSIS x64)');
      const pStarted = Date.now();
      const r = await runProcess(process.execPath, [path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js'), '--win', 'nsis', '--x64'], {
        source: kind,
        timeoutMs: 30 * 60 * 1000,
        env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
        onLine: (line, stream) => logLine(stream === 'stderr' ? 'warn' : levelFromText(line), kind, line),
      });
      job.steps[pIdx] = {
        ...job.steps[pIdx], status: r.code === 0 ? 'ok' : 'failed', code: r.code,
        ms: Date.now() - pStarted, finishedAt: nowIso(),
        outputTail: (r.stdout + r.stderr).split(/\r?\n/).filter(Boolean).slice(-60).join('\n'),
      };
      if (r.code !== 0) throw new Error(`electron-builder failed with exit code ${r.code}.`);
      const installer = findInstaller();
      buildState.lastPackage = { at: nowIso(), ok: true, installer };
      if (installer) logLine('info', kind, `Installer ready: ${installer.path} (${(installer.bytes / 1024 / 1024).toFixed(1)} MB)`);
    }

    job.status = 'succeeded';
    job.finishedAt = nowIso();
    const dist = distInfo();
    buildState.lastBuild = {
      at: nowIso(), ok: true, kind,
      artifact: { indexMtime: dist.indexMtime, assetCount: dist.assetCount, bytes: dist.bytes, serverBytes: dist.serverBundle.bytes },
    };
    if (kind === 'package') buildState.lastPackage = { ...(buildState.lastPackage || {}), ok: true, installer: findInstaller(), at: nowIso() };
    saveBuild();
    logLine('info', kind, `${kind} succeeded (${job.steps.reduce((n, s) => n + (s.ms || 0), 0)} ms).`);
    return job;
  } catch (err) {
    job.status = 'failed';
    job.error = String(err?.message || err);
    job.finishedAt = nowIso();
    if (kind === 'build') buildState.lastBuild = { at: nowIso(), ok: false, error: job.error };
    if (kind === 'package') buildState.lastPackage = { at: nowIso(), ok: false, error: job.error };
    saveBuild();
    logLine('error', kind, `${kind} failed: ${job.error}`);
    return job;
  } finally {
    activeJob = null;
  }
}

async function runTestsJob() {
  if (activeJob) throw Object.assign(new Error(`A ${activeJob.kind} job is already running.`), { status: 409 });
  const job = { id: uid('test'), kind: 'tests', status: 'running', startedAt: nowIso(), finishedAt: null, checks: [], error: null, child: null };
  activeJob = job;
  logLine('info', 'tests', 'Starting verification suite.');

  const add = (name, ok, detail) => {
    job.checks.push({ name, ok, detail, at: nowIso() });
    logLine(ok ? 'info' : 'error', 'tests', `${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    // 1) Type check
    let started = Date.now();
    let r = await runProcess(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], {
      source: 'tests', timeoutMs: 10 * 60 * 1000,
      onLine: (line) => logLine('error', 'tests', line),
    });
    add('TypeScript (tsc --noEmit)', r.code === 0, `exit ${r.code} in ${Date.now() - started} ms`);
    if (r.code !== 0) throw new Error('TypeScript check failed.');

    // 2) Client build
    started = Date.now();
    r = await runProcess(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
      source: 'tests', timeoutMs: 10 * 60 * 1000,
      onLine: (line) => logLine(levelFromText(line), 'tests', line),
    });
    add('Client production build (vite)', r.code === 0, `exit ${r.code} in ${Date.now() - started} ms`);
    if (r.code !== 0) throw new Error('Vite build failed.');

    // 3) Running app HTTP health (use the live app when available, else boot a temp prod server)
    let base = appState.status === 'running' && appState.url ? appState.url : null;
    let temp = null;
    if (!base) {
      if (!fileExists(path.join(ROOT, 'server.mjs'))) {
        const esbuild = await import('esbuild');
        await esbuild.build({
          entryPoints: [path.join(ROOT, 'server.ts')], bundle: true, platform: 'node', format: 'esm',
          packages: 'external', outfile: path.join(ROOT, 'server.mjs'), external: ['vite'], logLevel: 'silent',
        });
      }
      const testPort = 3499;
      temp = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
        cwd: ROOT, windowsHide: true, env: { ...process.env, PORT: String(testPort), NODE_ENV: 'production', PULSE_DATA_DIR: path.join(os.homedir(), '.pulse-med') },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      temp.stdout.on('data', (d) => logLine('info', 'tests', `[temp-server] ${d.toString().trim()}`));
      temp.stderr.on('data', (d) => logLine('warn', 'tests', `[temp-server] ${d.toString().trim()}`));
      base = `http://127.0.0.1:${testPort}/`;
      for (let i = 0; i < 60; i++) {
        const p = await httpProbe(base, 700);
        if (p.ok) break;
        await sleep(500);
      }
    }
    const health = await httpProbe(base, 3000);
    add('Application HTTP health', health.ok, `${base} -> ${health.status || health.error}`);
    if (health.ok) {
      const oauth = await httpJson(`${base}api/oauth/status`, 5000);
      add('OAuth/provider status route', oauth.ok, oauth.ok ? 'real JSON returned' : oauth.error);
      const providers = await httpJson(`${base}api/providers/status`, 5000);
      add('Provider status route', providers.ok, providers.ok ? 'real JSON returned' : providers.error);
    }
    if (temp) {
      try { spawnSync('taskkill.exe', ['/PID', String(temp.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }); } catch { /* ignore */ }
    }

    job.status = job.checks.every((c) => c.ok) ? 'succeeded' : 'failed';
    job.finishedAt = nowIso();
    buildState.lastTest = { at: nowIso(), ok: job.status === 'succeeded', checks: job.checks };
    saveBuild();
    logLine(job.status === 'succeeded' ? 'info' : 'error', 'tests', `Verification ${job.status}.`);
    return job;
  } catch (err) {
    job.status = 'failed';
    job.error = String(err?.message || err);
    job.finishedAt = nowIso();
    buildState.lastTest = { at: nowIso(), ok: false, checks: job.checks, error: job.error };
    saveBuild();
    logLine('error', 'tests', `Verification failed: ${job.error}`);
    return job;
  } finally {
    activeJob = null;
  }
}

function httpJson(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => text += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: JSON.parse(text) }); }
        catch { resolve({ ok: false, status: res.statusCode, error: 'non-JSON response' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

async function aiStatus() {
  const base = appState.status === 'running' && appState.url ? appState.url : null;
  if (!base) return { connected: false, reason: 'The app is not running.', providers: {} };
  const r = await httpJson(`${base}api/oauth/status`, 5000);
  if (!r.ok) return { connected: false, reason: r.error || `HTTP ${r.status}`, providers: {} };
  return { connected: true, at: nowIso(), providers: r.json.providers || {}, defaults: r.json.defaults || {} };
}

/**
 * The app's account-aware model library: each connected subscription is asked,
 * with its own stored token, which models it can actually use. Read-only; no
 * model is ever selected here because the app keeps that choice in its own UI.
 */
async function appModelLibrary({ refresh = false, provider = '' } = {}) {
  await refreshAppState();
  const base = appState.status === 'running' && appState.url ? appState.url : null;
  if (!base) return { ok: false, error: 'The app is not running. Launch it to read the provider libraries.', providers: {}, errors: {} };
  const q = new URLSearchParams();
  if (refresh) q.set('refresh', '1');
  if (provider) q.set('provider', provider);
  const r = await httpJson(`${base}api/models/available${q.size ? `?${q.toString()}` : ''}`, 90_000);
  if (!r.ok) return { ok: false, error: r.error || `The app returned HTTP ${r.status}.`, providers: {}, errors: {} };
  return { ok: true, ...r.json };
}

// ---------------------------------------------------------------------------
// checkpoints
// ---------------------------------------------------------------------------
function listCheckpointFiles() {
  if (!dirExists(CHECKPOINTS)) return [];
  return fs.readdirSync(CHECKPOINTS)
    .filter((f) => /\.tar\.gz$/i.test(f))
    .map((f) => {
      const p = path.join(CHECKPOINTS, f);
      const meta = checkpoints.find((c) => c.file === f) || {};
      return { file: f, path: p, bytes: sizeOf(p), mtimeMs: mtimeOf(p), ...meta };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function createCheckpoint(label = 'manual', verified = false) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `pulse-med-${stamp}.tar.gz`;
  const out = path.join(CHECKPOINTS, file);
  logLine('info', 'checkpoint', `Creating checkpoint ${file}.`);
  const args = [
    '-czf', out,
    '--exclude=node_modules', '--exclude=dist', '--exclude=release',
    '--exclude=.git', '--exclude=debug-center-data',
    '-C', ROOT, '.',
  ];
  const r = await runProcess('tar.exe', args, {
    source: 'checkpoint', timeoutMs: 10 * 60 * 1000,
    onLine: (line) => logLine(levelFromText(line), 'checkpoint', line),
  });
  if (r.code !== 0) throw new Error(`Checkpoint creation failed (tar exit ${r.code}).`);
  const rec = {
    id: uid('cp'), file, label, verified, at: nowIso(), bytes: sizeOf(out),
    git: gitInfo(true),
  };
  checkpoints.unshift(rec);
  checkpoints = checkpoints.slice(0, 40);
  state.lastCheckpoint = rec;
  saveState();
  saveCheckpoints();
  logLine('info', 'checkpoint', `Checkpoint ready: ${file} (${(rec.bytes / 1024 / 1024).toFixed(1)} MB).`);
  return rec;
}

async function restoreCheckpoint(file, confirm) {
  if (confirm !== 'RESTORE') throw Object.assign(new Error('Restore requires explicit confirmation.'), { status: 400 });
  const safe = path.basename(String(file || ''));
  const archive = path.join(CHECKPOINTS, safe);
  if (!fileExists(archive)) throw Object.assign(new Error('Checkpoint not found.'), { status: 404 });
  if (appState.status === 'running' || appState.status === 'starting') {
    throw Object.assign(new Error('Stop the application before restoring a checkpoint.'), { status: 409 });
  }
  await createCheckpoint('pre-restore-safety', false);
  logLine('warn', 'checkpoint', `Restoring ${safe}. Current files are backed up first.`);
  const r = await runProcess('tar.exe', ['-xzf', archive, '-C', ROOT], {
    source: 'checkpoint', timeoutMs: 10 * 60 * 1000,
    onLine: (line) => logLine(levelFromText(line), 'checkpoint', line),
  });
  if (r.code !== 0) throw new Error(`Restore failed (tar exit ${r.code}).`);
  logLine('warn', 'checkpoint', 'Checkpoint restored. New files created after the checkpoint were left in place.');
  return { ok: true, restored: safe };
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------
async function getStatus() {
  await refreshAppState();
  const app = publicApp();
  const [ai, external] = await Promise.all([
    aiStatus(),
    app.status === 'running' ? Promise.resolve(null) : detectExternalApp(),
  ]);
  return {
    ok: true,
    at: nowIso(),
    center: { version: CENTER_VERSION, port: PORT, pid: process.pid, uptimeMs: process.uptime() * 1000, node: process.version, platform: process.platform, arch: process.arch },
    repo: {
      root: ROOT, version: APP_VERSION, framework: 'Electron + React 19 + Vite 8 + Express (TypeScript)',
      git: gitInfo(),
      dist: distInfo(),
    },
    app,
    external,
    ai,
    build: buildState.lastBuild,
    test: buildState.lastTest,
    package: buildState.lastPackage,
    installer: findInstaller(),
    activeJob: jobSnapshot(),
    checkpoints: listCheckpointFiles().slice(0, 10),
    paths: { data: DATA, checkpoints: CHECKPOINTS, tokenFile: TOKEN_FILE },
  };
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  if (!hostAllowed(req)) {
    sendJson(res, 403, { error: 'This server only accepts connections addressed to localhost.' });
    return;
  }

  // Static dashboard (no secrets are embedded in these files).
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    if (url.searchParams.has('token')) {
      if (!safeEqual(url.searchParams.get('token'), TOKEN)) {
        sendText(res, 401, 'Invalid debug token.');
        return;
      }
      res.setHeader('set-cookie', `pmdc_token=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Strict`);
      res.writeHead(302, { location: '/' });
      res.end();
      return;
    }
    serveStatic(res, path.join(PUBLIC, 'index.html'), 'text/html; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && (pathname === '/app.js' || pathname === '/styles.css')) {
    serveStatic(res, path.join(PUBLIC, pathname.slice(1)), contentTypeFor(pathname));
    return;
  }
  if (req.method === 'GET' && pathname === '/favicon.svg') {
    serveStatic(res, path.join(PUBLIC, 'favicon.svg'), 'image/svg+xml');
    return;
  }
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, version: CENTER_VERSION, pid: process.pid, at: nowIso() });
    return;
  }

  if (pathname.startsWith('/api/')) {
    if (!isAuthed(req, url)) {
      sendJson(res, 401, { error: 'Unauthorized. Open the control center with the token link from the launcher.' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !originAllowed(req)) {
      sendJson(res, 403, { error: 'Cross-origin writes are not allowed.' });
      return;
    }
  }

  // ---- status ----
  if (req.method === 'GET' && pathname === '/api/status') {
    sendJson(res, 200, await getStatus());
    return;
  }

  // ---- account-aware model libraries (read-only proxy to the running app) ----
  if (req.method === 'GET' && pathname === '/api/ai/models') {
    sendJson(res, 200, await appModelLibrary({
      refresh: url.searchParams.get('refresh') === '1',
      provider: url.searchParams.get('provider') || '',
    }));
    return;
  }

  // ---- logs ----
  if (req.method === 'GET' && pathname === '/api/logs') {
    sendJson(res, 200, queryLogs({
      since: Number(url.searchParams.get('since') || 0),
      level: url.searchParams.get('level') || '',
      q: url.searchParams.get('q') || '',
      source: url.searchParams.get('source') || '',
      limit: Number(url.searchParams.get('limit') || 400),
    }));
    return;
  }
  if (req.method === 'GET' && pathname === '/api/logs/export') {
    const rows = queryLogs({ since: 0, level: '', q: '', source: '', limit: 5000 }).entries;
    const text = rows.map((e) => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] [${e.source}] ${e.text}`).join('\n');
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="pulse-med-debug-logs-${new Date().toISOString().slice(0, 10)}.txt"`,
      'cache-control': 'no-store',
    });
    res.end(text + '\n');
    return;
  }
  if (req.method === 'POST' && pathname === '/api/logs/clear') {
    logRing.length = 0;
    logLine('info', 'center', 'Log buffer cleared by operator.');
    sendJson(res, 200, { ok: true });
    return;
  }

  // ---- app controls ----
  if (req.method === 'POST' && pathname === '/api/app/start') {
    const body = await readJsonBody(req);
    const result = await startApp(body.mode || state.appMode || 'dev');
    sendJson(res, 200, result);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/app/stop') {
    sendJson(res, 200, await stopApp());
    return;
  }
  if (req.method === 'POST' && pathname === '/api/app/restart') {
    sendJson(res, 200, await restartApp());
    return;
  }
  if (req.method === 'POST' && pathname === '/api/app/open') {
    const body = await readJsonBody(req);
    const target = body.url || appState.url;
    if (!target) throw Object.assign(new Error('The app is not running.'), { status: 409 });
    const opener = process.platform === 'win32' ? 'cmd.exe' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
    spawn(opener, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    sendJson(res, 200, { ok: true, opened: target });
    return;
  }

  // ---- tests / build / package ----
  if (req.method === 'POST' && pathname === '/api/tests/run') {
    if (activeJob) throw Object.assign(new Error(`A ${activeJob.kind} job is already running.`), { status: 409 });
    runTestsJob();
    sendJson(res, 202, { ok: true, job: jobSnapshot(), message: 'Verification started.' });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/build') {
    if (activeJob) throw Object.assign(new Error(`A ${activeJob.kind} job is already running.`), { status: 409 });
    runBuildJob('build');
    sendJson(res, 202, { ok: true, job: jobSnapshot(), message: 'Build started.' });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/package') {
    if (activeJob) throw Object.assign(new Error(`A ${activeJob.kind} job is already running.`), { status: 409 });
    runBuildJob('package');
    sendJson(res, 202, { ok: true, job: jobSnapshot(), message: 'Installer build started.' });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/jobs/active') {
    sendJson(res, 200, { job: jobSnapshot() });
    return;
  }

  // ---- checkpoints ----
  if (req.method === 'GET' && pathname === '/api/checkpoints') {
    sendJson(res, 200, { checkpoints: listCheckpointFiles(), lastCheckpoint: state.lastCheckpoint || null });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/checkpoints') {
    const body = await readJsonBody(req);
    const rec = await createCheckpoint(body.label || 'manual', Boolean(body.verified));
    sendJson(res, 200, { ok: true, checkpoint: rec });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/checkpoints/restore') {
    const body = await readJsonBody(req);
    sendJson(res, 200, await restoreCheckpoint(body.file, body.confirm));
    return;
  }


  sendJson(res, 404, { error: 'Unknown endpoint.' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    logLine(status >= 500 ? 'error' : 'warn', 'http', `${req.method} ${req.url} -> ${status}: ${err?.message || err}`);
    if (!res.headersSent) sendJson(res, status, { error: err?.message || 'Request failed.' });
    else res.end();
  });
});
server.requestTimeout = 5 * 60 * 1000;
server.headersTimeout = 60 * 1000;

server.listen(PORT, HOST, () => {
  logLine('info', 'center', `Pulse Med Debug Control Center ${CENTER_VERSION} on http://${HOST}:${PORT}/`);
  logLine('info', 'center', `Repository: ${ROOT}`);
  logLine('info', 'center', `Auth token file: ${TOKEN_FILE}`);
  // Create an initial checkpoint once, so rollback is available before the first build.
  const existing = listCheckpointFiles();
  if (!existing.length) {
    createCheckpoint('initial', false).catch((e) => logLine('warn', 'checkpoint', e.message));
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logLine('info', 'center', `Received ${sig}; stopping child processes.`);
    try { if (appState.owned && appState.pid) spawnSync('taskkill.exe', ['/PID', String(appState.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }); } catch { /* ignore */ }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}
