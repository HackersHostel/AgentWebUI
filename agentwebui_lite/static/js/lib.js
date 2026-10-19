// Shared plumbing: Preact through htm (no build step), the API, server-sent events, a small store, and helpers.
export {
  html, render, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useReducer,
} from '../vendor/preact-htm.js';
import { useState, useEffect } from '../vendor/preact-htm.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'Couldn’t reach the server. Check that it is running.');
  }
  if (response.status === 401) {
    store.set({ signedIn: false });
    throw new ApiError(401, 'Sign in first.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error || `The server answered ${response.status}.`);
  }
  if (raw) return response;
  return response.status === 204 || response.status === 202 ? null : response.json();
}

// Read a server-sent event stream from a fetch response, calling onEvent for each `data:` frame.
export async function readEvents(response, onEvent) {
  if (!response || !response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      if (frame.startsWith('data: ')) onEvent(JSON.parse(frame.slice(6)));
    }
  }
}

// A tiny global store: set() merges, components re-render through useStore().
function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      listeners.forEach((fn) => fn(state));
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

export const store = createStore({
  signedIn: null, passwordRequired: false,
  config: null, chats: [], projects: [], route: { name: 'home' },
  chat: null, live: {}, sidebar: 'open', drawer: false,
  inspector: null, overlay: null, toasts: [], offline: false, voice: null,
});

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.is(a[k], b[k]));
}

export function useStore(select = (s) => s) {
  const [value, setValue] = useState(() => select(store.get()));
  useEffect(() => {
    const update = (s) => setValue((old) => { const next = select(s); return shallowEqual(old, next) ? old : next; });
    const unsubscribe = store.subscribe(update);
    update(store.get()); // the store may have changed between the first render and this subscription
    return unsubscribe;
  }, []);
  return value;
}

// Per-browser preferences. Storage can be missing (private windows), so every access is guarded.
export const local = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`awl.${key}`); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`awl.${key}`, JSON.stringify(value)); } catch { /* not kept */ }
  },
};

let toastId = 0;
export function toast(text, { action, onAction, ms } = {}) {
  const id = ++toastId;
  store.set((s) => ({ toasts: [...s.toasts, { id, text, action, onAction }] }));
  setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms || (action ? 6000 : 4000));
}

export const cx = (...parts) => parts.filter(Boolean).join(' ');

export function navigate(hash) {
  if (location.hash !== hash) location.hash = hash;
  else window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function dayGroup(seconds, now = new Date()) {
  const d = new Date(seconds * 1000);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= start) return 'Today';
  if (t >= start - 864e5) return 'Yesterday';
  if (t >= start - 7 * 864e5) return 'Previous 7 days';
  if (t >= start - 30 * 864e5) return 'Previous 30 days';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function ago(seconds) {
  const s = Math.max(0, Date.now() / 1000 - seconds);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hour${s >= 7200 ? 's' : ''} ago`;
  if (s < 172800) return 'yesterday';
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function secs(value) {
  if (value == null) return '';
  return value < 10 ? `${value.toFixed(1)} s` : value < 60 ? `${Math.round(value)} s` : `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
}

// Whether `path` is `root` or inside it. Works with a root of "/" and with Windows separators.
export function within(path, root) {
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
  const p = norm(path), r = norm(root);
  if (!p || !r) return false;
  return p === r || p.startsWith(r.endsWith('/') ? r : `${r}/`);
}

export function dirname(path) {
  const s = String(path || '');
  const i = s.lastIndexOf('/');
  return i > 0 ? s.slice(0, i) : '/';
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const mod = isMac ? '⌘' : 'Ctrl+';

export function basename(path) {
  const parts = String(path || '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path || '';
}

export function size(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// The bytes of a File as base64, for the JSON upload endpoints.
export function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Save text or a Blob as a file in the browser's downloads.
export function saveFile(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const isImage = (mime) => /^image\/(png|jpe?g|gif|webp|svg\+xml|avif|bmp)$/.test(mime || '');
export const fileUrl = (id, download) => `/api/files/${id}${download ? '?download=1' : ''}`;
export const rawUrl = (path, download) => `/api/fs/raw?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`;

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied.'); }
  catch { toast('Couldn’t copy. Select the text and copy it yourself.'); }
}

// A stable gradient for a provider, like the logos in the model picker.
const GRADIENTS = [
  ['#1a73e8', '#8ab4f8'], ['#0f9d58', '#8ad1a6'], ['#6e56cf', '#b3a4ff'], ['#d9480f', '#ffb38a'],
  ['#0e8f7e', '#5fd4c4'], ['#c2255c', '#f783ac'], ['#3f3f46', '#a1a1aa'],
];
export function providerGradient(key, local = false) {
  if (local) return 'linear-gradient(135deg, #3f3f46, #a1a1aa)';
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = GRADIENTS[h % (GRADIENTS.length - 1)];
  return `linear-gradient(135deg, ${a}, ${b})`;
}
export const AGENT_GRADIENT = 'linear-gradient(135deg, #b4541a, #f5b94a)';
