// Boot, layout and global keys. The page opens straight into chat; a password, when set in .env, comes first.
import { html, render, useEffect, store, useStore, local, cx, api } from './lib.js';
import { applyPrefs, loadPrefs } from './prefs.js';
import { Sidebar, Rail } from './sidebar.js';
import { Home } from './home.js';
import { ChatScreen } from './chat.js';
import { Settings } from './settings.js';
import { ModelPicker } from './picker.js';
import { Palette, Shortcuts } from './palette.js';
import { Confirm, Toasts, Dialog, closeTopLayer } from './ui.js';
import { Icon } from './icons.js';
import { SignIn, SystemState, OfflineBanner, Loading } from './states.js';
import { loadConfig, loadChats, onRoute, newChat, openPalette, openPicker, toggleSidebar, stop, renameChat, chatTarget, switchModel } from './actions.js';

const prefs = loadPrefs();
store.set({ prefs, sidebar: local.get('sidebar', 'open') });
applyPrefs(prefs);

function Overlay() {
  const overlay = useStore((s) => s.overlay);
  if (!overlay) return null;
  const close = () => store.set({ overlay: null });
  switch (overlay.type) {
    case 'picker': return html`<${ModelPicker} ...${overlay} onClose=${close} />`;
    case 'palette': return html`<${Palette} onClose=${close} />`;
    case 'shortcuts': return html`<${Shortcuts} onClose=${close} />`;
    case 'confirm': return html`<${Confirm} ...${overlay} onClose=${close} />`;
    case 'rename': return html`<${Rename} ...${overlay} onClose=${close} />`;
    default: return null;
  }
}

function Rename({ id, title, onClose }) {
  let value = title;
  const save = () => { if (value.trim()) renameChat(id, value.trim()); onClose(); };
  return html`<${Dialog} onClose=${onClose} label="Rename chat" width=${420}>
    <div class="dh"><div><h3>Rename chat</h3></div></div>
    <div class="db"><div class="f"><label for="rename">Title</label>
      <input id="rename" class="inp" value=${title} data-autofocus onInput=${(e) => { value = e.target.value; }} onKeyDown=${(e) => e.key === 'Enter' && save()} /></div></div>
    <div class="df"><button class="btn btn-g" onClick=${onClose}>Cancel</button><button class="btn btn-p" onClick=${save}>Rename chat</button></div>
  <//>`;
}

function Shell() {
  const { route, sidebar, drawer } = useStore((s) => ({ route: s.route, sidebar: s.sidebar, drawer: s.drawer }));
  const screen = route.name === 'home' ? html`<${Home} />`
    : route.name === 'chat' ? html`<${ChatScreen} />`
    : route.name === 'settings' ? html`<${Settings} />`
    : html`<${SystemState} kind="missing" />`;
  if (route.name === 'settings') return html`<div class="shell">${screen}</div>`;
  return html`<div class=${cx('shell', sidebar === 'rail' && 'collapsed')}>
    <a class="skip" href="#composer" onClick=${(e) => { e.preventDefault(); document.getElementById('composer')?.focus(); }}>Skip to message box</a>
    <div class="side-slot">${sidebar === 'rail' ? html`<${Rail} />` : html`<${Sidebar} />`}</div>
    <div class="rail-slot"><${Rail} /></div>
    ${drawer && html`<div class="scrim drawer-scrim" onClick=${() => store.set({ drawer: false })}></div><${Sidebar} drawer=${true} />`}
    <main class="main" id="main">
      <${OfflineBanner} />
      ${screen}
    </main>
  </div>`;
}

function App() {
  const { signedIn, config, bootError } = useStore((s) => ({ signedIn: s.signedIn, config: s.config, bootError: s.bootError }));
  useEffect(() => {
    const onHash = () => onRoute();
    window.addEventListener('hashchange', onHash);
    window.addEventListener('awl:signed-in', boot);
    boot();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if (e.key === 'Escape') {
        if (closeTopLayer()) { e.preventDefault(); return; }
        const { chat, live, drawer } = store.get();
        if (drawer) { store.set({ drawer: false }); return; }
        if (chat && live[chat.id]?.running && !typing) { stop(chat.id); return; }
      }
      if (!store.get().signedIn) return;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); store.get().overlay?.type === 'palette' ? store.set({ overlay: null }) : openPalette(); }
      else if (mod && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); store.set({ overlay: null }); newChat(); }
      else if (mod && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        const chat = store.get().chat;
        openPicker(chat && store.get().route.name === 'chat' ? { value: chatTarget(chat), chat, onPick: (t) => switchModel(chat.id, t) } : {});
      }
      else if (mod && e.key === '\\') { e.preventDefault(); toggleSidebar(); }
      else if (e.key === '?' && !typing && !mod) { e.preventDefault(); store.set({ overlay: { type: 'shortcuts' } }); }
    };
    window.addEventListener('keydown', onKey);
    const online = () => { store.set({ offline: false }); loadChats(); };
    const offline = () => store.set({ offline: true });
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    const poll = setInterval(() => { if (store.get().signedIn && !document.hidden) loadChats(); }, 15000);
    return () => { window.removeEventListener('keydown', onKey); clearInterval(poll); };
  }, []);
  if (bootError) return html`<${SystemState} kind="error" detail=${bootError} />`;
  if (signedIn === false) return html`<${SignIn} /><${Toasts} />`;
  if (!config) return html`<${Loading} />`;
  return html`<${Shell} /><${Overlay} /><${Toasts} />`;
}

async function boot() {
  try {
    const session = await api('/api/session');
    store.set({ passwordRequired: session.password_required, signedIn: session.signed_in });
    if (!session.signed_in) return;
    await loadConfig();
    await loadChats();
    await onRoute();
  } catch (e) {
    if (e.status === 401) return;
    store.set(e.status === 0 ? { offline: true, bootError: e.message } : { bootError: e.message });
  }
}

window.addEventListener('error', (e) => console.error(e.error || e.message));
render(html`<${App} />`, document.getElementById('root'));
export { Icon };
