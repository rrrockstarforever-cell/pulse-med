import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
// TEMPORARY SAMPLE: the playful theme is opt-in via localStorage 'pulse-theme' = 'playful'.
import './theme-playful.css';

try {
  if (localStorage.getItem('pulse-theme') === 'playful') document.documentElement.classList.add('theme-playful');
} catch { /* storage blocked: default theme */ }

if (import.meta.env.PROD) {
  try {
    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!isLocalhost && window.isSecureContext && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* Service worker registration is best-effort. */
      });
    }
  } catch {
    /* Service worker not available. */
  }
}

createRoot(document.getElementById('root')!).render(<App />);
