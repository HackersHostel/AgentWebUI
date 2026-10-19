// Command palette ⌘K (Command palette board): actions, chats (titles and message text), and settings.
import { html, useState, useEffect, useRef, store, useStore, api, navigate, dayGroup, mod } from './lib.js';
import { Icon } from './icons.js';
import { Dialog } from './ui.js';
import { newChat, openPicker, toggleSidebar } from './actions.js';
import { setPrefs } from './prefs.js';

export function Palette({ onClose }) {
  const { chats, prefs, config } = useStore((s) => ({ chats: s.chats, prefs: s.prefs, config: s.config }));
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [hot, setHot] = useState(0);
  const list = useRef(null);
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) { setFound(null); return undefined; }
    const timer = setTimeout(() => api(`/api/search?q=${encodeURIComponent(needle)}`).then(setFound).catch(() => setFound(null)), 150);
    return () => clearTimeout(timer);
  }, [q]);
  const light = ['light', 'paper'].includes(prefs.theme);
  const n = q.trim().toLowerCase();
  const actions = [
    { label: 'New chat', keys: `${mod}N`, icon: 'plus', run: () => newChat() },
    ...(config?.agents || []).map((a) => ({ label: `New chat with ${a.name}`, icon: 'agent', run: () => newChat(`agent:${a.id}`) })),
    { label: 'Switch model', keys: `${mod}M`, icon: 'sparkle', run: () => openPicker() },
    { label: 'Toggle sidebar', keys: `${mod}\\`, icon: 'panel', run: toggleSidebar },
    { label: light ? 'Switch to dark theme' : 'Switch to light theme', icon: light ? 'moon' : 'sun', run: () => setPrefs({ theme: light ? 'dark' : 'light' }) },
  ];
  const settings = [
    { label: 'Providers and agents', icon: 'plug', run: () => navigate('#/settings/providers') },
    { label: 'Appearance', icon: 'sun', run: () => navigate('#/settings/appearance') },
    { label: 'Keyboard shortcuts', keys: '?', icon: 'key', run: () => store.set({ overlay: { type: 'shortcuts' } }) },
  ];
  const match = (label) => !n || label.toLowerCase().includes(n);
  const chatItems = (found || chats.filter((c) => match(c.title || 'New chat')).slice(0, n ? 20 : 6)).map((c) => ({
    label: c.title || 'New chat', hint: c.snippet ? `  ·  ${c.snippet}` : `  ·  ${dayGroup(c.updated_at)}`, icon: c.kind === 'agent' ? 'agent' : 'chat',
    run: () => navigate(`#/c/${c.id}`),
  }));
  const sections = [
    { title: 'Actions', items: actions.filter((a) => match(a.label)) },
    { title: 'Chats', items: chatItems },
    { title: 'Settings', items: settings.filter((a) => match(a.label)) },
  ].filter((s) => s.items.length);
  const flat = sections.flatMap((s) => s.items);
  useEffect(() => setHot(0), [q, found]);
  useEffect(() => { list.current?.querySelector('[data-hot="1"]')?.scrollIntoView({ block: 'nearest' }); }, [hot]);
  const run = (item) => { onClose(); item.run(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHot((h) => Math.min(h + 1, flat.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHot((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[hot]) run(flat[hot]);
      else if (q.trim()) { onClose(); newChat(); setTimeout(() => window.dispatchEvent(new CustomEvent('awl:prefill', { detail: q.trim() })), 50); }
    }
  };
  let index = -1;
  return html`<${Dialog} onClose=${onClose} label="Command palette" width=${640} top=${120}>
    <div onKeyDown=${onKey}>
      <div class="pal-search">
        <${Icon} name="search" size=${18} style="color: var(--tx-3)" />
        <label for="cq" class="sr">Search chats, actions and settings</label>
        <input id="cq" class="bare" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Search chats, actions and settings…" autocomplete="off" data-autofocus />
        <span class="kbd">Esc</span>
      </div>
      <div class="pal-list" ref=${list} role="listbox" aria-label="Results">
        ${sections.map((s) => html`<div key=${s.title}>
          <div class="pal-title">${s.title}</div>
          ${s.items.map((it) => { index += 1; const i = index; return html`<button key=${s.title + i} class="row pal-row" role="option" aria-selected=${i === hot}
            data-hot=${i === hot ? '1' : '0'} style=${i === hot ? 'background: var(--bg-active)' : ''} onMouseEnter=${() => setHot(i)} onClick=${() => run(it)}>
            <span class="pal-ico"><${Icon} name=${it.icon} size=${15} /></span>
            <span class="pal-label">${it.label}<span style="color: var(--tx-3)">${it.hint || ''}</span></span>
            ${it.keys && html`<span class="kbd">${it.keys}</span>`}
          </button>`; })}
        </div>`)}
        ${flat.length === 0 && html`<div class="pal-empty">Nothing matches. Press <span class="kbd">↵</span> to ask about “${q}” in a new chat.</div>`}
      </div>
      <div class="pal-foot">
        <span><span class="kbd">↑↓</span>Move</span><span><span class="kbd">↵</span>Open</span>
        <span style="margin-left: auto"><span class="kbd">?</span>All shortcuts</span>
      </div>
    </div>
  <//>`;
}

export function Shortcuts({ onClose }) {
  const rows = [
    [`${mod}N`, 'New chat'], [`${mod}K`, 'Search chats, actions and settings'], [`${mod}M`, 'Switch model'],
    [`${mod}\\`, 'Collapse or expand the sidebar'], ['↵', 'Send, or allow the waiting request'], ['⇧↵', 'New line'],
    ['Esc', 'Stop the reply, or close the top layer'], ['?', 'This list'],
  ];
  return html`<${Dialog} onClose=${onClose} label="Keyboard shortcuts" width=${460}>
    <div class="dh"><span class="ico"><${Icon} name="key" /></span><div><h3>Keyboard shortcuts</h3><p>Work without the mouse.</p></div></div>
    <div class="db" style="gap: 0">${rows.map(([k, d]) => html`<div class="pr" key=${k}><span class="kbd" style="min-width: 52px; text-align: center">${k}</span><span>${d}</span></div>`)}</div>
    <div class="df"><button class="btn btn-p" data-autofocus onClick=${onClose}>Done</button></div>
  <//>`;
}
