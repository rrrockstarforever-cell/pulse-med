import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { JSX } from 'react';

const URL_KEY = 'pulse-server-url';
const PIN_KEY = 'pulse-server-pin';
let originalFetch: typeof window.fetch | null = null;
let patched = false;

function getOriginalFetch(): typeof window.fetch {
  if (!originalFetch) originalFetch = window.fetch.bind(window);
  return originalFetch;
}

export function isNativeApp(): boolean {
  return Boolean((window as any).Capacitor?.isNativePlatform?.());
}

export function getServer(): { url: string; pin: string } | null {
  try {
    const url = localStorage.getItem(URL_KEY);
    return url ? { url, pin: localStorage.getItem(PIN_KEY) ?? '' } : null;
  } catch {
    return null;
  }
}

export function saveServer(url: string, pin: string): void {
  try {
    localStorage.setItem(URL_KEY, url);
    localStorage.setItem(PIN_KEY, pin);
  } catch {}
}

export function clearServer(): void {
  try {
    localStorage.removeItem(URL_KEY);
    localStorage.removeItem(PIN_KEY);
  } catch {}
}

export function apiUrl(path: string): string {
  const server = getServer();
  return isNativeApp() && server && path.startsWith('/') ? server.url + path : path;
}

export function installNativeFetch(): void {
  if (!isNativeApp() || patched) return;
  patched = true;
  installNativeImages();
  const original = getOriginalFetch();
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const server = getServer();
    if (!server) return original(input, init);

    if (input instanceof Request) {
      const u = new URL(input.url);
      if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/__')) {
        const req = new Request(server.url + u.pathname + u.search, input);
        const headers = new Headers(req.headers);
        if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
        headers.set('X-Pulse-Pin', server.pin);
        return original(new Request(req, { ...init, headers }));
      }
      return original(input, init);
    }

    let path: string | null = null;
    if (typeof input === 'string') {
      if (input.startsWith('/api/') || input.startsWith('/__')) path = input;
    } else if (input instanceof URL) {
      if (input.pathname.startsWith('/api/') || input.pathname.startsWith('/__')) path = input.pathname + input.search;
    }

    if (path !== null) {
      const headers = new Headers(init?.headers);
      headers.set('X-Pulse-Pin', server.pin);
      return original(server.url + path, { ...init, headers });
    }

    return original(input, init);
  };
}

function normalizeUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  return url.replace(/\/+$/, '');
}

type VerifyResult = 'ok' | 'pin' | 'network';

async function verifyServer(url: string, pin: string): Promise<VerifyResult> {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return 'network';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await getOriginalFetch()(url + '/api/oauth/status', {
      headers: { 'X-Pulse-Pin': pin },
      signal: controller.signal,
    });

    if (res.status === 401) return 'pin';
    if (!res.ok) return 'network';

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return 'network';

    return 'ok';
  } catch {
    return 'network';
  } finally {
    clearTimeout(timeout);
  }
}

export function resetServer(): void {
  clearServer();
  window.location.reload();
}

const screen: CSSProperties = {
  minHeight: '100vh',
  background: '#0f172a',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#e2e8f0',
  fontFamily: 'system-ui, sans-serif',
  padding: 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)',
  boxSizing: 'border-box',
};

const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: 48,
  marginBottom: 12,
  padding: '0 12px',
  borderRadius: 8,
  border: '1px solid #475569',
  background: '#0f172a',
  color: '#e2e8f0',
  fontSize: 16,
  boxSizing: 'border-box',
};

export function ConnectGate({ children }: { children: ReactNode }): JSX.Element {
  const [url, setUrl] = useState(() => getServer()?.url ?? '');
  const [pin, setPin] = useState(() => getServer()?.pin ?? '');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(() => Boolean(isNativeApp() && getServer()));
  const [connected, setConnected] = useState(false);
  // The PC is not reachable on start: the app still opens (saved banks, tests, notes and mistakes live on the phone).
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    const saved = getServer();
    if (!saved) return setChecking(false);
    let cancelled = false;
    (async () => {
      const result = await verifyServer(saved.url, saved.pin);
      if (cancelled) return;
      if (result === 'ok') {
        installNativeFetch();
        setConnected(true);
        setChecking(false);
      } else if (result === 'network') {
        installNativeFetch();
        setOffline(true);
        setConnected(true);
        setChecking(false);
      } else {
        setError('Wrong PIN');
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isNativeApp()) return <>{children}</>;
  if (checking) return <div style={screen}>Connecting…</div>;
  if (connected) {
    const retry = async () => {
      const saved = getServer();
      if (!saved) return;
      if ((await verifyServer(saved.url, saved.pin)) === 'ok') setOffline(false);
    };
    return (
      <>
        {offline && (
          <div role="status" style={{ position: 'fixed', left: 8, right: 8, bottom: 'calc(72px + env(safe-area-inset-bottom))', zIndex: 9999, display: 'flex', gap: 8, alignItems: 'center', background: '#1e293b', color: '#e2e8f0', borderRadius: 12, padding: '10px 12px', fontFamily: 'system-ui, sans-serif', fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,.35)' }}>
            <span style={{ flex: 1 }}>PC not reachable. Saved questions and notes still work; AI and sync need your PC.</span>
            <button onClick={retry} style={{ background: '#0f8b8d', color: '#fff', border: 0, borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 600 }}>Retry</button>
            <button onClick={() => setOffline(false)} aria-label="Dismiss" style={{ background: 'transparent', color: '#94a3b8', border: 0, fontSize: 18, padding: '4px 8px' }}>×</button>
          </div>
        )}
        {children}
      </>
    );
  }

  const connect = async () => {
    const normalized = normalizeUrl(url.trim());
    if (!normalized) {
      setError('Type the address shown by start-phone.cmd, for example http://192.168.1.20:3200');
      return;
    }
  
    if (!pin) {
      setError('Type the PIN');
      return;
    }
  
    setChecking(true);
    setError('');
    const result = await verifyServer(normalized, pin);
    if (result === 'ok') {
      saveServer(normalized, pin);
      installNativeFetch();
      setConnected(true);
      setChecking(false);
    } else {
      setError(
        result === 'pin'
          ? 'Wrong PIN'
          : 'Cannot reach the server. Check Wi-Fi and that Pulse Med is running on your PC with phone mode on.',
      );
      setChecking(false);
    }
  };

  return (
    <div style={screen}>
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#1e293b',
          borderRadius: 16,
          padding: 24,
          color: '#e2e8f0',
          fontFamily: 'system-ui, sans-serif',
          boxSizing: 'border-box',
        }}
      >
        <h1 style={{ margin: '0 0 20px', fontSize: 24, textAlign: 'center' }}>Connect to Pulse Med</h1>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://192.168.1.20:3200"
          style={inputStyle}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" style={inputStyle} />
        <button
          onClick={connect}
          disabled={checking}
          style={{
            width: '100%',
            minHeight: 48,
            borderRadius: 8,
            border: 'none',
            background: '#0ea5e9',
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
            cursor: 'pointer',
            opacity: checking ? 0.6 : 1,
          }}
        >
          Connect
        </button>
        {error ? <div style={{ marginTop: 12, color: '#f87171', textAlign: 'center', fontSize: 14 }}>{error}</div> : null}
      </div>
    </div>
  );
}

// <img> tags cannot send the PIN header, so images served by the PC server are fetched with it and shown from a blob.
let installed = false;

export function installNativeImages(): void {
  if (installed) return;
  installed = true;

  const cache = new Map<string, Promise<string>>();
  const urls = new WeakMap<HTMLImageElement, string>();
  const queue: Array<() => Promise<void>> = [];
  let active = 0;

  const pump = (): void => {
    while (active < 4 && queue.length > 0) {
      const task = queue.shift()!;
      active++;
      task()
        .catch(() => {})
        .then(() => {
          active--;
          pump();
        });
    }
  };

  const schedule = (task: () => Promise<void>): void => {
    queue.push(task);
    pump();
  };

  const getUrl = (path: string): Promise<string> => {
    let p = cache.get(path);
    if (p) return p;
    p = window.fetch(path)
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.blob();
      })
      .then((blob) => URL.createObjectURL(blob))
      .catch((error) => {
        if (cache.get(path) === p) cache.delete(path);
        throw error;
      });
    cache.set(path, p);
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    return p;
  };

  const processImg = (img: HTMLImageElement, force = false): void => {
    const src = img.getAttribute('src');
    if (!src || !src.startsWith('/api/')) return;
    if (!force && img.hasAttribute('data-native-img')) return;
    img.setAttribute('data-native-img', '1');
    img.setAttribute('data-native-src', src);
    schedule(async () => {
      try {
        const url = await getUrl(src);
        if (img.getAttribute('data-native-src') !== src) return;
        const prev = urls.get(img);
        img.src = url;
        urls.set(img, url);
        if (prev && prev !== url) URL.revokeObjectURL(prev);
      } catch {
        if (img.getAttribute('data-native-src') === src) {
          img.removeAttribute('data-native-img');
        }
      }
    });
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const el = mutation.target;
        if (el instanceof HTMLImageElement) {
          const src = el.getAttribute('src');
          if (src && src.startsWith('/api/')) processImg(el, true);
        }
      } else {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLImageElement) processImg(node);
          else if (node instanceof Element) {
            node.querySelectorAll('img').forEach((img) => processImg(img));
          }
        });
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });

  document.querySelectorAll('img').forEach((img) => processImg(img));
}
