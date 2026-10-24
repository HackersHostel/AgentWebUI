// The app's own logo (static/brand, from the Brand board) in the ink of the current theme: the accent's ink on the
// default themes, blue on Graphite and teal on Paper. Terminal and Custom draw the same mark on their own accent,
// mixed as the board mixes it; High contrast uses the bare light glyph. A BRAND_LOGO in .env replaces all of them
// (the server marks the page).
import { html, store, useStore } from './lib.js';
import { mix, customVars } from './prefs.js';

const OWN = document.documentElement.hasAttribute('data-own-logo');
const INKS = new Set(['violet', 'blue', 'teal']);
const asset = (file) => new URL(`../brand/${file}`, import.meta.url).href;

// An ink with its own files, 'hc', or the tile color to draw one on.
function ink(p) {
  if (p.theme === 'graphite') return 'blue';
  if (p.theme === 'paper') return 'teal';
  if (p.theme === 'terminal') return '#1a7d40';
  if (p.theme === 'hc') return 'hc';
  if (p.theme === 'custom') return customVars(p).vars['--ac'];
  return INKS.has(p.accent) ? p.accent : 'violet';
}

// The board's geometry; the back stroke is white at 55% over the tile (62% on the small version).
const FRONT = '12,51 22.5,51 37,13 26.5,13', BACK = '27.5,13 38,13 52,51 41.5,51';
function draw(tile, small) {
  const poly = (points, c) => `<polygon points="${points}" fill="${c}" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${small ? 13 : 14}" fill="${tile}"/>`
    + `${poly(BACK, mix(tile, '#ffffff', small ? 0.62 : 0.55))}${poly(FRONT, '#ffffff')}<rect x="22.5" y="34" width="18" height="7" rx="1" fill="#ffffff"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// small: the favicon version, drawn for 20 px and under.
export function logoUrl(p, small = false) {
  if (OWN) return '/brand/logo';
  const i = ink(p);
  if (i === 'hc') return asset('glyph-light.svg');
  return INKS.has(i) ? asset(`${small ? 'favicon' : 'mark'}-${i}.svg`) : draw(i, small);
}

// The tiles have their own corners; a BRAND_LOGO image is rounded here.
export function BrandLogo({ size, alt = '', style = '' }) {
  const prefs = useStore((s) => s.prefs);
  const round = OWN ? `border-radius: ${Math.round(size * 0.3)}px; ` : '';
  return html`<img src=${logoUrl(prefs, size <= 20)} alt=${alt} width=${size} height=${size} style=${round + style} />`;
}

// The tab and home-screen icons follow the theme too. A browser tab can be light or dark, so High contrast gets a
// black tile there; the home screen needs a PNG, which only the inks with files have.
function setIcons(p) {
  if (OWN || !p) return;
  const i = ink(p), tile = i === 'hc' ? '#000000' : i;
  document.querySelector('link[rel="icon"]')?.setAttribute('href', INKS.has(tile) ? asset(`favicon-${tile}.svg`) : draw(tile, true));
  document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', asset(`apple-${INKS.has(tile) ? tile : 'violet'}.png`));
}
let shown;
store.subscribe((s) => { if (s.prefs !== shown) setIcons(shown = s.prefs); });
