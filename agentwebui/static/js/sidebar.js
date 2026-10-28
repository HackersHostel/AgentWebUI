// Sidebar (Main, Home, Sidebar states and Organize chats boards), the 56px rail when collapsed, and the drawer on
// small screens.
import { html, useState, useRef, useEffect, store, useStore, cx, dayGroup, navigate, mod, api, toast, local } from './lib.js';
import { Icon } from './icons.js';
import { Logo, targetLogo } from './logos.js';
import { BrandLogo } from './brand.js';
import { Menu, MenuItem, MenuSep, confirm, useToggle } from './ui.js';
import { renameChat, deleteChat, openPalette, openPicker, toggleSidebar, newChat, pinChat, archiveChat, cloneChat, exportChat } from './actions.js';
import { startInProject } from './projects.js';

export function Sidebar({ drawer = false }) {
  const { chats, route, config, live, projects } = useStore((s) => ({ chats: s.chats, route: s.route, config: s.config, live: s.live, projects: s.projects }));
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(() => local.get('openProjects', {}));
  const close = () => store.set({ drawer: false });
  const go = (hash) => { close(); navigate(hash); };
  const active = chats.filter((c) => !c.archived);
  const archived = chats.filter((c) => c.archived);
  const pinned = active.filter((c) => c.pinned);
  const projectIds = new Set(projects.map((p) => p.id));
  const loose = active.filter((c) => !c.pinned && !projectIds.has(c.project_id));
  const groups = [];
  for (const chat of loose) {
    const name = dayGroup(chat.updated_at);
    let group = groups.find((g) => g.name === name);
    if (!group) groups.push(group = { name, chats: [] });
    group.chats.push(chat);
  }
  const current = route.name === 'chat' ? route.id : null;
  const agents = config?.agents || [];
  const brand = config?.brand || {};
  const toggleProject = (id) => { const next = { ...open, [id]: !open[id] }; setOpen(next); local.set('openProjects', next); };
  const row = (chat) => html`<${ChatRow} key=${chat.id} chat=${chat} on=${chat.id === current} live=${live[chat.id]} go=${() => go(`#/c/${chat.id}`)} />`;
  return html`<aside class=${cx('side', drawer && 'drawer')} aria-label=${drawer ? 'Menu' : 'Sidebar'}>
    <div class="side-head">
      <${BrandLogo} size=${22} />
      <span class="brand">${brand.name || 'AgentWebUI'}</span>
      ${drawer
        ? html`<button class="ib" aria-label="Close menu" onClick=${close}><${Icon} name="close" /></button>`
        : html`<button class="ib" aria-label="Collapse sidebar" title=${`Collapse sidebar  ${mod}\\`} onClick=${toggleSidebar}><${Icon} name="panel" /></button>`}
    </div>
    <div class="side-group" style="margin-top: 6px">
      <button class=${cx('nav', route.name === 'home' && 'on')} style="color: var(--tx)" aria-current=${route.name === 'home' ? 'page' : undefined}
        onClick=${() => { close(); newChat(undefined, { project: null }); }}><${Icon} name="new-chat" /><span class="t">New chat</span><span class="kbd">${mod}N</span></button>
      <button class="nav" onClick=${() => { close(); openPalette(); }}><${Icon} name="search" /><span class="t">Search</span><span class="kbd">${mod}K</span></button>
    </div>
    <div class="side-group" style="margin-top: 10px">
      ${config?.roots?.length > 0 && html`<button class=${cx('nav', route.name === 'files' && 'on')} onClick=${() => go('#/files')}><${Icon} name="folder" /><span class="t">Files</span></button>`}
      <button class="nav" onClick=${() => { close(); openPicker({ tab: 'agents' }); }}><${Icon} name="agent" /><span class="t">Agents</span>${agents.length > 0 && html`<span class="count">${agents.length}</span>`}</button>
      <button class="nav" onClick=${() => { close(); store.set({ overlay: { type: 'project' } }); }}><${Icon} name="layers" /><span class="t">New project</span></button>
    </div>
    <div class="side-list">
      ${drawer && agents.length > 0 && html`<div class="lbl">Agents</div>
        ${agents.map((a) => html`<button class="nav" key=${a.id} onClick=${() => { close(); newChat(`agent:${a.id}`); }}>
          <span class="dot" style=${`animation: none; background: ${a.running ? 'var(--ok)' : 'var(--tx-3)'}`}></span>
          <span class="t">${a.name}</span><span class="count">${a.running ? 'running' : 'idle'}</span></button>`)}`}
      ${showArchived ? html`
        <div class="lbl" style="display: flex; align-items: center"><span style="flex: 1">Archived</span>
          <button class="btn btn-g btn-sm" style="height: 22px; padding: 0 6px" onClick=${() => setShowArchived(false)}>Done</button></div>
        ${archived.length === 0 && html`<div class="side-empty"><${Icon} name="archive" size=${18} />Nothing archived.</div>`}
        ${archived.map(row)}` : html`
        ${projects.length > 0 && html`<div class="lbl">Projects</div>
          ${projects.map((p) => {
            const inside = active.filter((c) => c.project_id === p.id && !c.pinned);
            return html`<div key=${p.id}>
              <${ProjectRow} project=${p} open=${!!open[p.id]} count=${inside.length} onToggle=${() => toggleProject(p.id)} onNew=${() => { close(); startInProject(p); }} />
              ${open[p.id] && html`<div class="side-nest">${inside.map(row)}${!inside.length && html`<div class="side-empty" style="padding: 6px 10px; align-items: flex-start">No chats yet.</div>`}</div>`}
            </div>`;
          })}`}
        ${pinned.length > 0 && html`<div class="lbl">Pinned</div>${pinned.map(row)}`}
        ${active.length === 0 && html`<div class="side-empty"><${Icon} name="chat" size=${18} />Your chats will show up here.</div>`}
        ${groups.map((g) => html`<div key=${g.name}><div class="lbl">${g.name}</div>${g.chats.map(row)}</div>`)}
        ${archived.length > 0 && html`<button class="nav" style="margin-top: 8px; color: var(--tx-3)" onClick=${() => setShowArchived(true)}><${Icon} name="archive" /><span class="t">Archived</span><span class="count">${archived.length}</span></button>`}`}
    </div>
    <${Account} />
  </aside>`;
}

function ProjectRow({ project, open, count, onToggle, onNew }) {
  const menu = useToggle();
  return html`<div class=${cx('row-wrap', menu.open && 'menu-open')}>
    <button class="nav" aria-expanded=${open} onClick=${onToggle} title=${project.folder || project.name}>
      <${Icon} name="chevron-right" size=${14} class="chev" style=${open ? 'transform: rotate(90deg)' : ''} />
      <${Icon} name="layers" size=${15} /><span class="t">${project.name}</span>${count > 0 && html`<span class="count">${count}</span>`}</button>
    <button class="row-more" ref=${menu.ref} aria-label=${`Actions for ${project.name}`} aria-haspopup="menu" onClick=${menu.toggle}><${Icon} name="more" size=${14} /></button>
    ${menu.open && html`<${Menu} anchor=${menu.ref} onClose=${menu.close} label="Project actions" width=${210}>
      <${MenuItem} icon="new-chat" onClick=${onNew}>New chat in project<//>
      ${project.folder && store.get().config?.roots?.length > 0 && html`<${MenuItem} icon="folder-open" onClick=${() => navigate(`#/files?path=${encodeURIComponent(project.folder)}`)}>Open its folder<//>`}
      <${MenuItem} icon="edit" onClick=${() => store.set({ overlay: { type: 'project', project } })}>Edit project…<//>
    <//>`}
  </div>`;
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
      <span class="row-mark"><${Logo} name=${targetLogo(`${chat.kind}:${chat.target}`, store.get().config)} size=${14} icon=${chat.kind === 'agent' ? 'agent' : 'chat'} /></span>
      <span class="t">${chat.title || 'New chat'}</span>
      ${waiting
        ? html`<span class="dot" title="Waiting for you" style="background: var(--warn)"></span>`
        : running && html`<span class="dot" title="Replying" style="background: var(--ac-tx)"></span>`}
    </a>
    <button class="row-more" ref=${menu.ref} aria-label=${`Actions for ${chat.title || 'New chat'}`} aria-haspopup="menu"
      aria-expanded=${menu.open} onClick=${menu.toggle}><${Icon} name="more" size=${14} /></button>
    ${menu.open && html`<${Menu} anchor=${menu.ref} onClose=${menu.close} label="Chat actions" width=${210}>
      <${MenuItem} icon="edit" onClick=${() => setRenaming(true)}>Rename<//>
      <${MenuItem} icon="pin" onClick=${() => pinChat(chat.id, !chat.pinned)}>${chat.pinned ? 'Unpin' : 'Pin'}<//>
      <${MenuItem} icon="layers" onClick=${() => store.set({ overlay: { type: 'move', chat } })}>Move to project…<//>
      <${MenuItem} icon="clone" onClick=${() => cloneChat(chat.id)}>Clone<//>
      <${MenuItem} icon="export" onClick=${() => exportChat(chat.id, 'md')}>Export as Markdown<//>
      <${MenuItem} icon="archive" onClick=${() => archiveChat(chat.id, !chat.archived)}>${chat.archived ? 'Unarchive' : 'Archive'}<//>
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
  const to = (hash) => { store.set({ drawer: false }); navigate(hash); };
  return html`<div class="side-foot">
    <button class="account" ref=${menu.ref} aria-haspopup="menu" aria-expanded=${menu.open} onClick=${menu.toggle}>
      <span class="avatar">${name.slice(0, 1).toUpperCase()}</span>
      <span class="who"><span class="n">${name}</span><span class="r">${passwordRequired ? 'Signed in' : 'On this computer'}</span></span>
      <${Icon} name="chevrons-v" style="color: var(--tx-3)" />
    </button>
    ${menu.open && html`<${Menu} anchor=${menu.ref} onClose=${menu.close} label="Account" width=${240} up=${true}>
      <${MenuItem} icon="settings" onClick=${() => to('#/settings/chat')}>Settings<//>
      <${MenuItem} icon="palette" onClick=${() => to('#/settings/appearance')}>Appearance<//>
      <${MenuItem} icon="plug" onClick=${() => to('#/settings/providers')}>Providers and agents<//>
      ${config?.roots?.length > 0 && html`<${MenuItem} icon="folder" onClick=${() => to('#/files')}>Files<//>`}
      <${MenuItem} icon="key" keys="?" onClick=${() => store.set({ overlay: { type: 'shortcuts' } })}>Keyboard shortcuts<//>
      ${passwordRequired && html`<${MenuSep} /><${MenuItem} icon="signout" onClick=${signOut}>Sign out<//>`}
    <//>`}
  </div>`;
}

export function Rail() {
  const { route, config } = useStore((s) => ({ route: s.route, config: s.config }));
  return html`<nav class="rail" aria-label="Sidebar (collapsed)">
    <${BrandLogo} size=${22} alt=${config?.brand?.name || 'AgentWebUI'} style="margin: 9px 0 10px" />
    <button class="ib" aria-label="Expand sidebar" title=${`Expand sidebar  ${mod}\\`} onClick=${toggleSidebar}><${Icon} name="panel" /></button>
    <button class=${cx('ib', route.name === 'home' && 'on')} aria-label="New chat" title=${`New chat  ${mod}N`} onClick=${() => newChat()}><${Icon} name="new-chat" /></button>
    <button class="ib" aria-label="Search" title=${`Search  ${mod}K`} onClick=${openPalette}><${Icon} name="search" /></button>
    ${config?.roots?.length > 0 && html`<button class=${cx('ib', route.name === 'files' && 'on')} aria-label="Files" title="Files" onClick=${() => navigate('#/files')}><${Icon} name="folder" /></button>`}
    <button class="ib" aria-label="Agents" title="Agents" onClick=${() => openPicker({ tab: 'agents' })}><${Icon} name="agent" /></button>
    <span style="flex: 1"></span>
    <button class="ib" aria-label="Settings" title="Settings" onClick=${() => navigate('#/settings/chat')}><${Icon} name="settings" /></button>
  </nav>`;
}
