// Appearance (Settings · Appearance board): applies instantly and is remembered on this browser.
import { local, store } from './lib.js';

export const THEMES = [
  { id: 'dark', label: 'Dark', desc: 'The default look.', cls: '', bg: '#111114', side: '#0c0c0f', bar: 'rgba(255,255,255,.14)', ac: '#6e56cf' },
  { id: 'light', label: 'Light', desc: 'Light surfaces, same accent.', cls: 'light', bg: '#ffffff', side: '#f4f4f5', bar: 'rgba(0,0,0,.12)', ac: '#6e56cf' },
  { id: 'system', label: 'System', desc: 'Follows your device.', cls: '', bg: 'linear-gradient(90deg, #ffffff 50%, #111114 50%)', side: '#e4e4e7', bar: 'rgba(120,120,130,.4)', ac: '#6e56cf' },
  { id: 'graphite', label: 'Graphite', desc: 'Neutral greys, calm blue.', cls: 'graphite', bg: '#121417', side: '#0d0f11', bar: 'rgba(255,255,255,.14)', ac: '#2563d0' },
  { id: 'terminal', label: 'Terminal', desc: 'Phosphor green on black.', cls: 'terminal', bg: '#0a0f0b', side: '#070b08', bar: 'rgba(120,255,170,.2)', ac: '#1a7d40' },
  { id: 'paper', label: 'Paper', desc: 'Warm paper, teal accent.', cls: 'paper', bg: '#f8f4ec', side: '#efe7d8', bar: 'rgba(60,40,10,.14)', ac: '#0f766e' },
  { id: 'hc', label: 'High contrast', desc: 'Black, white, bright focus.', cls: 'hc', bg: '#000000', side: '#000000', bar: '#ffffff', ac: '#ffd60a' },
  { id: 'custom', label: 'Custom', desc: 'Your own colors, kept readable.', cls: '', bg: '', side: '', bar: '', ac: '' },
];
export const SWATCHES = [['Violet', '#7c3aed'], ['Blue', '#2563eb'], ['Cyan', '#0891b2'], ['Green', '#059669'], ['Lime', '#65a30d'], ['Orange', '#d97706'], ['Red', '#dc2626'], ['Pink', '#db2777'], ['Slate', '#64748b']];
// Geist ships with the app; the others load from Google Fonts the first time they are chosen.
export const FONTS = [
  { id: 'geist', label: 'Geist', note: 'Crisp and neutral', fam: "'Geist', sans-serif" },
  { id: 'inter', label: 'Inter', note: 'Familiar UI sans', fam: "'Inter', sans-serif", google: 'Inter:wght@400..700' },
  { id: 'system', label: 'System', note: "Your device's font", fam: 'system-ui, sans-serif' },
  { id: 'plex', label: 'IBM Plex Sans', note: 'Technical, condensed', fam: "'IBM Plex Sans', sans-serif", google: 'IBM+Plex+Sans:wght@400;500;600' },
  { id: 'jakarta', label: 'Plus Jakarta Sans', note: 'Rounded, friendly', fam: "'Plus Jakarta Sans', sans-serif", google: 'Plus+Jakarta+Sans:wght@400..700' },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', note: 'Designed for easier reading', fam: "'Atkinson Hyperlegible', sans-serif", google: 'Atkinson+Hyperlegible:wght@400;700' },
  { id: 'serif', label: 'Source Serif', note: 'Book-like, for long reads', fam: "'Source Serif 4', serif", google: 'Source+Serif+4:wght@400..700' },
];
export const CODES = [
  { id: 'geistmono', label: 'Geist Mono', note: 'Pairs with Geist', fam: "'Geist Mono', monospace" },
  { id: 'jetbrains', label: 'JetBrains Mono', note: 'Clear, tall letters', fam: "'JetBrains Mono', monospace", google: 'JetBrains+Mono:wght@400..600' },
  { id: 'fira', label: 'Fira Code', note: 'With ligatures', fam: "'Fira Code', monospace", google: 'Fira+Code:wght@400..600' },
  { id: 'plexmono', label: 'IBM Plex Mono', note: 'Pairs with Plex Sans', fam: "'IBM Plex Mono', monospace", google: 'IBM+Plex+Mono:wght@400;500' },
];
export const SIZES = [['s', 'Small', 13], ['m', 'Default', 14], ['l', 'Large', 15.5], ['xl', 'Extra large', 17]];
export const ACCENTS = [['violet', 'Violet', '#6e56cf'], ['blue', 'Blue', '#2b62d9'], ['teal', 'Teal', '#0f766e']];

const DEFAULTS = {
  theme: 'dark', accent: 'violet', base: 'dark', custom: '#7c3aed', tint: 'neutral', contrast: 'standard',
  font: 'geist', code: 'geistmono', size: 'm', density: 'comfortable',
};

export function loadPrefs() {
  return { ...DEFAULTS, ...local.get('appearance', {}) };
}

function rgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function hex(c) { return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
export function mix(a, b, t) { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); }
function lum(h) { return rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }
export function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

// The custom theme: an accent made readable against white text and the ground, as on the board.
export function customVars(p) {
  const ground = p.base === 'light' ? '#ffffff' : '#111114';
  let fill = p.custom, n = 0;
  while (ratio(fill, '#ffffff') < 4.5 && n < 20) { fill = mix(fill, '#000000', 0.08); n++; }
  let text = p.base === 'light' ? p.custom : mix(p.custom, '#ffffff', 0.45);
  const target = p.contrast === 'high' ? 7 : 4.5;
  n = 0;
  while (ratio(text, ground) < target && n < 20) { text = mix(text, p.base === 'light' ? '#000000' : '#ffffff', 0.12); n++; }
  const vars = { '--ac': fill, '--ac-hover': mix(fill, '#000000', 0.1), '--ac-press': mix(fill, '#000000', 0.2), '--ac-tx': text, '--ac-soft': `${p.custom}29`, '--ac-line': `${p.custom}73` };
  if (p.tint === 'accent') {
    Object.assign(vars, p.base === 'light'
      ? { '--bg': mix('#ffffff', p.custom, 0.03), '--bg-side': mix('#f7f7f8', p.custom, 0.06) }
      : { '--bg': mix('#111114', p.custom, 0.07), '--bg-side': mix('#0c0c0f', p.custom, 0.08), '--bg-raised': mix('#18181c', p.custom, 0.08) });
  }
  if (p.contrast === 'high') Object.assign(vars, p.base === 'light' ? { '--tx-2': '#27272a', '--tx-3': '#3f3f46' } : { '--tx-2': '#e4e4e7', '--tx-3': '#c4c4cc' });
  if (p.contrast === 'soft') Object.assign(vars, p.base === 'light' ? { '--tx': '#2a2a30' } : { '--tx': '#d6d6dc' });
  const low = Math.min(ratio(fill, '#ffffff'), ratio(text, ground));
  return { vars, low };
}

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const loadedFonts = new Set();
function loadGoogle(family) {
  if (!family || loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  document.head.appendChild(link);
}

export function applyPrefs(p) {
  const root = document.documentElement;
  const theme = THEMES.find((t) => t.id === p.theme) || THEMES[0];
  let cls = theme.cls;
  if (p.theme === 'system') cls = darkQuery.matches ? '' : 'light';
  if (p.theme === 'custom') cls = p.base === 'light' ? 'light' : '';
  const accent = ['dark', 'light', 'system'].includes(p.theme) && p.accent !== 'violet' ? `ac-${p.accent}` : '';
  root.className = ['app', cls, accent, p.density === 'compact' && 'compact'].filter(Boolean).join(' ');
  root.removeAttribute('style');
  if (p.theme === 'custom') for (const [k, v] of Object.entries(customVars(p).vars)) root.style.setProperty(k, v);
  const font = FONTS.find((f) => f.id === p.font) || FONTS[0];
  const code = CODES.find((f) => f.id === p.code) || CODES[0];
  loadGoogle(font.google);
  loadGoogle(code.google);
  root.style.setProperty('--font', font.fam);
  root.style.setProperty('--font-mono', code.fam);
  root.style.setProperty('--size', `${(SIZES.find((s) => s[0] === p.size) || SIZES[1])[2]}px`);
  root.style.setProperty('--zoom', String((SIZES.find((s) => s[0] === p.size) || SIZES[1])[2] / 14));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || '#111114';
}

export function setPrefs(patch) {
  const next = { ...store.get().prefs, ...patch };
  local.set('appearance', next);
  store.set({ prefs: next });
  applyPrefs(next);
}

darkQuery.addEventListener?.('change', () => { const p = store.get().prefs; if (p && p.theme === 'system') applyPrefs(p); });

// Settings › Chat, Voice and Notifications: kept on this browser like the appearance.
export const CHAT_DEFAULTS = {
  enterToSend: true, instructions: '', startPage: 'new', temperature: null, maxTokens: null,
  voiceLang: '', voiceName: '', autoRead: false, rate: 1,
  notifyFinish: true, notifyFail: true, notifyWaiting: true, inApp: true,
  hiddenModels: {},
};

export function loadChatPrefs() {
  return { ...CHAT_DEFAULTS, ...local.get('chat', {}) };
}

export function setChatPrefs(patch) {
  const next = { ...store.get().chatPrefs, ...patch };
  local.set('chat', next);
  store.set({ chatPrefs: next });
}

// Back to a plain start: every preference on this browser, each agent's remembered model, the default model,
// favorites and the sidebar. Chats and projects on the server are kept.
export function resetEverything() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('awl.')) localStorage.removeItem(key);
  } catch { /* nothing stored */ }
  const prefs = loadPrefs();
  store.set({ prefs, chatPrefs: loadChatPrefs(), sidebar: 'open', draftTarget: null, draftText: '' });
  applyPrefs(prefs);
}
