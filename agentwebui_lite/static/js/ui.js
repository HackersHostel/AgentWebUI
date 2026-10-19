// Menus, dialogs and toasts (Kit board). Menus grow from their trigger; Esc closes the top layer first.
import { html, useEffect, useLayoutEffect, useRef, useState, store, useStore, cx } from './lib.js';
import { Icon } from './icons.js';

const layers = [];
function useLayer(onClose, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const layer = { onClose };
    layers.push(layer);
    return () => { const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); };
  }, [active]);
}
export function closeTopLayer() {
  const top = layers[layers.length - 1];
  if (top) { top.onClose(); return true; }
  return false;
}

// A menu attached to the element in `anchor` (a ref). Opens below, or above when there is no room.
export function Menu({ anchor, onClose, children, width, align = 'start', label, up: forceUp, class: klass, style }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayer(onClose);
  // Placed after every render, since the content can grow (a model list arriving after "Starting…"). It opens on its
  // side unless it only fits on the other, and never runs off the screen: it gets the room there and scrolls.
  const place = () => {
    const a = anchor.current?.getBoundingClientRect();
    const m = ref.current;
    if (!a || !m) return;
    const want = m.scrollHeight, mw = m.offsetWidth;
    const above = a.top - 14, below = innerHeight - a.bottom - 14;
    let up = forceUp ?? (want > below && above > below);
    if (up && want > above && below > above) up = false;
    else if (!up && want > below && above > below) up = true;
    const height = Math.min(want, up ? above : below, 520);
    let left = align === 'end' ? a.right - mw : a.left;
    left = Math.max(8, Math.min(left, innerWidth - mw - 8));
    const next = { left, top: up ? a.top - height - 6 : a.bottom + 6, up, height };
    setPos((p) => (p && p.left === next.left && p.top === next.top && p.height === next.height ? p : next));
  };
  useLayoutEffect(place);
  useEffect(() => {
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, []);
  useEffect(() => {
    const away = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !anchor.current?.contains(e.target)) onClose();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, []);
  useEffect(() => {
    const first = ref.current?.querySelector('[role^="menuitem"], [role="option"], button');
    first?.focus({ preventScroll: true });
  }, [pos !== null]);
  const onKey = (e) => {
    const items = [...ref.current.querySelectorAll('[role^="menuitem"]:not([disabled]), [role="option"]')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    if (e.key === 'Tab') onClose();
  };
  const at = pos ? `left: ${pos.left}px; top: ${pos.top}px; max-height: ${pos.height}px; overflow-y: auto;` : 'left: -9999px; top: 0;';
  return html`<div ref=${ref} class=${cx('menu', pos?.up && 'up', klass)} role="menu" aria-label=${label}
    onKeyDown=${onKey} onClick=${(e) => e.target.closest('[data-close]') && onClose()}
    style=${`position: fixed; ${at} ${width ? `width: ${width}px;` : ''} ${style || ''}`}>${children}</div>`;
}

export function MenuItem({ icon, children, onClick, keys, danger, checked, radio, desc, disabled }) {
  const role = radio ? 'menuitemradio' : 'menuitem';
  return html`<button class=${cx('mi', danger && 'bad')} role=${role} aria-checked=${radio ? String(!!checked) : undefined}
    data-close="1" disabled=${disabled} onClick=${onClick}
    style=${desc ? 'height: auto; padding: 7px 8px; align-items: flex-start' : ''}>
    ${icon && html`<${Icon} name=${icon} />`}
    ${desc
      ? html`<span style="display: flex; flex-direction: column; flex: 1; min-width: 0"><span>${children}</span><span style="font-size: 12px; color: var(--tx-3)">${desc}</span></span>`
      : html`<span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${children}</span>`}
    ${keys && html`<span class="k">${keys}</span>`}
    ${checked && !radio && html`<${Icon} name="check" style="color: var(--ac-tx)" />`}
    ${radio && checked && html`<${Icon} name="check" style="color: var(--ac-tx)" />`}
  </button>`;
}
export const MenuSep = () => html`<div class="msep"></div>`;
export const MenuHead = ({ children }) => html`<div class="mh">${children}</div>`;

export function useToggle() {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  return { ref, open, toggle: () => setOpen((v) => !v), close: () => setOpen(false), setOpen };
}

// A centered dialog over a scrim. Focus moves into it and returns to the opener on close.
export function Dialog({ onClose, label, width = 440, top, children, role = 'dialog', class: klass, style }) {
  const ref = useRef(null);
  useLayer(onClose);
  useEffect(() => {
    const opener = document.activeElement;
    const target = ref.current?.querySelector('[data-autofocus]') || ref.current?.querySelector('input, textarea, button');
    target?.focus({ preventScroll: true });
    return () => opener?.focus?.({ preventScroll: true });
  }, []);
  const trap = (e) => {
    if (e.key !== 'Tab') return;
    const focusable = [...ref.current.querySelectorAll('button, input, textarea, select, a[href], [tabindex="0"]')].filter((el) => !el.disabled);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const place = top != null ? `top: ${top}px; transform: translateX(-50%);` : 'top: 50%; transform: translate(-50%, -50%);';
  return html`<div class="scrim" onPointerDown=${(e) => e.target === e.currentTarget && onClose()}></div>
    <div ref=${ref} class=${cx('dlg', klass)} role=${role} aria-modal="true" aria-label=${label} onKeyDown=${trap}
      style=${`position: fixed; left: 50%; ${place} width: min(${width}px, calc(100% - 32px)); z-index: 41; ${style || ''}`}>${children}</div>`;
}

// store.overlay = { type: 'confirm', title, body, action, danger, onConfirm }
export function Confirm({ title, body, action, danger, onConfirm, onClose }) {
  return html`<${Dialog} onClose=${onClose} label=${title} role="alertdialog" width=${420}>
    <div class="dh">
      <span class="ico" style=${danger ? 'background: var(--bad-soft); color: var(--bad)' : ''}><${Icon} name=${danger ? 'delete' : 'info'} /></span>
      <div style="flex: 1; min-width: 0"><h3>${title}</h3>${body && html`<p>${body}</p>`}</div>
    </div>
    <div class="db" style="padding: 8px"></div>
    <div class="df">
      <button class="btn btn-g" onClick=${onClose}>Cancel</button>
      <button class=${cx('btn', danger ? 'btn-d' : 'btn-p')} data-autofocus onClick=${() => { onClose(); onConfirm(); }}>${action}</button>
    </div>
  <//>`;
}

export function confirm(options) {
  store.set({ overlay: { type: 'confirm', ...options } });
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return html`<div class="toasts" role="status" aria-live="polite">
    ${toasts.map((t) => html`<div class="toast" key=${t.id}><${Icon} name="info" /><span>${t.text}</span>
      ${t.action && html`<button class="btn btn-sm" onClick=${t.onAction}>${t.action}</button>`}</div>`)}
  </div>`;
}

export const Kbd = ({ children }) => html`<span class="kbd">${children}</span>`;
