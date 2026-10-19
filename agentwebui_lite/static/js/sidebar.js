// Sidebar (Main, Home and Sidebar states boards), the 56px rail when collapsed, and the drawer on small screens.
import { html, useState, useRef, useEffect, store, useStore, cx, dayGroup, navigate, notInLite, mod, api, toast } from './lib.js';
import { Icon } from './icons.js';
import { Menu, MenuItem, MenuSep, confirm, useToggle } from './ui.js';
import { renameChat, deleteChat, openPalette, openPicker, toggleSidebar, newChat } from './actions.js';

const LOGO = '/assets/logo.svg';

export function Sidebar({ drawer = false }) {
  const { chats, route, config, live } = useStore((s) => ({ chats: s.chats, route: s.route, config: s.config, live: s.live }));
  const close = () => store.set({ drawer: false });
  const go = (hash) => { close(); navigate(hash); };
  const groups = [];
  for (const chat of chats) {
    const name = dayGroup(chat.updated_at);
    let group = groups.find((g) => g.name === name);
    if (!group) groups.push(group = { name, chats: [] });
    group.chats.push(chat);
  }
  const current = route.name === 'chat' ? route.id : null;
  const agents = config?.agents || [];
  return html`<aside class=${cx('side', drawer && 'drawer')} aria-label=${drawer ? 'Menu' : 'Sidebar'}>
    <div class="side-head">
      <img src=${LOGO} alt="" width="22" height="22" style="border-radius: 7px" />
      <span class="brand">AgentWebUI</span>
      ${drawer
        ? html`<button class="ib" aria-label="Close menu" onClick=${close}><${Icon} name="close" /></button>`
        : html`<button class="ib" aria-label="Collapse sidebar" title=${`Collapse sidebar  ${mod}\\`} onClick=${toggleSidebar}><${Icon} name="panel" /></button>`}
    </div>
    <div class="side-group" style="margin-top: 6px">
      <button class=${cx('nav', route.name === 'home' && 'on')} style="color: var(--tx)" aria-current=${route.name === 'home' ? 'page' : undefined}
        onClick=${() => { close(); newChat(); }}><${Icon} name="new-chat" /><span class="t">New chat</span><span class="kbd">${mod}N</span></button>
      <button class="nav" onClick=${() => { close(); openPalette(); }}><${Icon} name="search" /><span class="t">Search</span><span class="kbd">${mod}K</span></button>
    </div>
    <div class="side-group" style="margin-top: 10px">
      <button class="nav" onClick=${notInLite('Projects')}><${Icon} name="layers" /><span class="t">Projects</span></button>
      <button class="nav" onClick=${notInLite('Workspaces')}><${Icon} name="workspace" /><span class="t">Workspaces</span></button>
      <button class="nav" onClick=${() => { close(); openPicker({ tab: 'agents' }); }}><${Icon} name="agent" /><span class="t">Agents</span>${agents.length > 0 && html`<span class="count">${agents.length}</span>`}</button>
      <button class="nav" onClick=${notInLite('The prompt library')}><${Icon} name="library" /><span class="t">Prompt library</span></button>
    </div>
    <div class="side-list">
      ${drawer && agents.length > 0 && html`<div class="lbl">Agents</div>
        ${agents.map((a) => html`<button class="nav" key=${a.id} onClick=${() => { close(); newChat(`agent:${a.id}`); }}>
          <span class="dot" style=${`animation: none; background: ${a.running ? 'var(--ok)' : 'var(--tx-3)'}`}></span>
          <span class="t">${a.name}</span><span class="count">${a.running ? 'running' : 'idle'}</span></button>`)}`}
      ${chats.length === 0 && html`<div class="side-empty"><${Icon} name="chat" size=${18} />Your chats will show up here.</div>`}
      ${groups.map((g) => html`<div key=${g.name}>
        <div class="lbl">${g.name}</div>
        ${g.chats.map((chat) => html`<${ChatRow} key=${chat.id} chat=${chat} on=${chat.id === current}
          live=${live[chat.id]} go=${() => go(`#/c/${chat.id}`)} />`)}
      </div>`)}
    </div>
    <${Account} />
  </aside>`;
}

function ChatRow({ chat, on, live, go }) {
  const menu = useToggle();
  const [renaming, setRenaming] = useState(false);
  const input = useRef(null);
  useEffect(() => { if (renaming) { input.current?.focus(); input.current?.select(); } }, [renaming]);
  const running = chat.running || live?.running;
  const waiting = chat.waiting || live?.waiting;
  const finish = async (save) => {
    const title = input.current?.value.trim();
    setRenaming(false);
    if (save && title && title !== chat.title) await renameChat(chat.id, title);
  };
  if (renaming) {
    return html`<div class="rename">
      <label class="sr" for=${`rn-${chat.id}`}>Chat title</label>
      <input id=${`rn-${chat.id}`} ref=${input} class="bare" value=${chat.title}
        onKeyDown=${(e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } }}
        onBlur=${() => finish(true)} />
    </div>`;
  }
  return html`<div class=${cx('row-wrap', menu.open && 'menu-open')}>
    <a class=${cx('nav', on && 'on')} href=${`#/c/${chat.id}`} aria-current=${on ? 'page' : undefined}
      onClick=${(e) => { e.preventDefault(); go(); }} title=${chat.title || 'New chat'}>
      <span class="t">${chat.title || 'New chat'}</span>
      ${waiting
        ? html`<span class="dot" title="Waiting for you" style="background: var(--warn)"></span>`
        : running && html`<span class="dot" title="Replying" style="background: var(--ac-tx)"></span>`}
    </a>
    <button class="row-more" ref=${menu.ref} aria-label=${`Actions for ${chat.title || 'New chat'}`} aria-haspopup="menu"
      aria-expanded=${menu.open} onClick=${menu.toggle}><${Icon} name="more" size=${14} /></button>
    ${menu.open && html`<${Menu} anchor=${menu.ref} onClose=${menu.close} label="Chat actions" width=${200}>
      <${MenuItem} icon="edit" onClick=${() => setRenaming(true)}>Rename<//>
      <${MenuItem} icon="pin" onClick=${notInLite('Pinning')}>Pin<//>
      <${MenuItem} icon="layers" onClick=${notInLite('Projects')}>Move to project…<//>
      <${MenuItem} icon="clone" onClick=${notInLite('Cloning')}>Clone<//>
      <${MenuItem} icon="share" onClick=${notInLite('Sharing')}>Share…<//>
      <${MenuItem} icon="archive" onClick=${notInLite('Archiving')}>Archive<//>
      <${MenuSep} />
      <${MenuItem} icon="delete" danger onClick=${() => confirm({
        title: 'Delete this chat?', danger: true, action: 'Delete chat',
        body: `“${chat.title || 'New chat'}” and its messages are removed for good.`,
        onConfirm: () => deleteChat(chat.id),
      })}>Delete…<//>
    <//>`}
  </div>`;
}

function Account() {
  const { config, passwordRequired } = useStore((s) => ({ config: s.config, passwordRequired: s.passwordRequired }));
  const menu = useToggle();
  const name = config?.user_name || 'You';
  const signOut = async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    store.set({ signedIn: false });
    toast('Signed out.');
  };
  return html`<div class="side-foot">
    <button class="account" ref=${menu.ref} aria-haspopup="menu" aria-expanded=${menu.open} onClick=${menu.toggle}>
      <span class="avatar">${name.slice(0, 1).toUpperCase()}</span>
      <span class="who"><span class="n">${name}</span><span class="r">${passwordRequired ? 'Signed in' : 'On this computer'}</span></span>
      <${Icon} name="chevrons-v" style="color: var(--tx-3)" />
    </button>
    ${menu.open && html`<${Menu} anchor=${menu.ref} onClose=${menu.close} label="Account" width=${240} up=${true}>
      <${MenuItem} icon="settings" onClick=${() => { store.set({ drawer: false }); navigate('#/settings/appearance'); }}>Settings<//>
      <${MenuItem} icon="palette" onClick=${() => { store.set({ drawer: false }); navigate('#/settings/appearance'); }}>Appearance<//>
      <${MenuItem} icon="plug" onClick=${() => { store.set({ drawer: false }); navigate('#/settings/providers'); }}>Providers and agents<//>
      <${MenuItem} icon="key" keys="?" onClick=${() => store.set({ overlay: { type: 'shortcuts' } })}>Keyboard shortcuts<//>
      ${passwordRequired && html`<${MenuSep} /><${MenuItem} icon="signout" onClick=${signOut}>Sign out<//>`}
    <//>`}
  </div>`;
}

export function Rail() {
  const { route } = useStore((s) => ({ route: s.route }));
  return html`<nav class="rail" aria-label="Sidebar (collapsed)">
    <img src=${LOGO} alt="AgentWebUI" width="22" height="22" style="border-radius: 7px; margin: 9px 0 10px" />
    <button class="ib" aria-label="Expand sidebar" title=${`Expand sidebar  ${mod}\\`} onClick=${toggleSidebar}><${Icon} name="panel" /></button>
    <button class=${cx('ib', route.name === 'home' && 'on')} aria-label="New chat" title=${`New chat  ${mod}N`} onClick=${() => newChat()}><${Icon} name="new-chat" /></button>
    <button class="ib" aria-label="Search" title=${`Search  ${mod}K`} onClick=${openPalette}><${Icon} name="search" /></button>
    <button class="ib" aria-label="Agents" title="Agents" onClick=${() => openPicker({ tab: 'agents' })}><${Icon} name="agent" /></button>
    <span style="flex: 1"></span>
    <button class="ib" aria-label="Settings" title="Settings" onClick=${() => navigate('#/settings/appearance')}><${Icon} name="settings" /></button>
  </nav>`;
}
