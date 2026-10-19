// Files and Git (Workspace, Workspace panels and Workspace states boards): browse the folders .env shares
// (FILES_ROOTS), view and edit a file, upload, search, go to file, and run git on the server. Also the file and
// folder picker the composer, the agent's folder button and "Save to workspace" use.
import { html, useState, useEffect, useRef, useMemo, store, useStore, cx, api, toast, navigate, basename, dirname, size, ago,
  readBase64, rawUrl, isImage } from './lib.js';
import { Icon } from './icons.js';
import { Dialog, Menu, MenuItem, MenuSep, confirm, useToggle } from './ui.js';
import { Diff, Markdown } from './messages.js';
import { newChat } from './actions.js';

const q = (path) => encodeURIComponent(path);
const isText = (e) => !/\.(png|jpe?g|gif|webp|avif|bmp|ico|pdf|zip|gz|tar|tgz|7z|rar|mp3|wav|ogg|mp4|mov|webm|woff2?|ttf|otf|exe|bin|so|dylib|class|jar|sqlite|db)$/i.test(e);
const ICONS = { md: 'file-text', txt: 'file-text', py: 'workspace', js: 'workspace', ts: 'workspace', tsx: 'workspace', jsx: 'workspace', json: 'workspace',
  css: 'workspace', html: 'workspace', sh: 'terminal', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image' };
const iconFor = (entry) => (entry.dir ? 'folder' : ICONS[entry.name.split('.').pop().toLowerCase()] || 'file');
const STATUS = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflict: '!' };

export function FilesScreen() {
  const route = useStore((s) => s.route);
  const config = useStore((s) => s.config);
  const roots = config?.roots || [];
  const [listing, setListing] = useState(null);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null); // { path, text, saved, info } or { path, diff }
  const [git, setGit] = useState(null);
  const [panel, setPanel] = useState(() => (innerWidth > 1180 ? 'git' : null)); // git | search | null
  const [finder, setFinder] = useState(false);
  const upload = useRef(null);
  const folder = route.path || (route.file ? dirname(route.file) : '');

  const load = async (path = folder) => {
    if (!path) { setListing(null); return; }
    try { setListing(await api(`/api/fs/list?path=${q(path)}`)); setError(''); }
    catch (e) { setError(e.message); setListing(null); }
  };
  const loadGit = async (path = folder) => {
    if (!path) { setGit(null); return; }
    try { setGit(await api(`/api/git/status?path=${q(path)}`)); } catch { setGit(null); }
  };
  const open = async (path) => {
    if (file && file.text != null && file.text !== file.saved && !window.confirm('Discard your unsaved changes?')) return;
    try { const info = await api(`/api/fs/read?path=${q(path)}`); setFile({ path, info, text: info.text, saved: info.text }); }
    catch (e) { toast(e.message); }
  };
  useEffect(() => { load(); loadGit(); }, [folder]);
  useEffect(() => { if (route.file) open(route.file); else setFile(null); }, [route.file]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p' && folder) { e.preventDefault(); setFinder(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [folder]);

  const go = (path) => navigate(`#/files?path=${q(path)}`);
  const view = (path) => navigate(`#/files?path=${q(dirname(path))}&file=${q(path)}`);
  const refresh = () => { load(); loadGit(); };
  const save = async () => {
    if (!file || file.text == null) return;
    try { await api('/api/fs/write', { method: 'POST', body: { path: file.path, content: file.text } }); setFile({ ...file, saved: file.text }); toast('Saved.'); loadGit(); }
    catch (e) { toast(e.message); }
  };
  const create = async (dir) => {
    const name = window.prompt(dir ? 'New folder name' : 'New file name');
    if (!name || !listing) return;
    const path = `${listing.path}/${name}`;
    try {
      if (dir) await api('/api/fs/mkdir', { method: 'POST', body: { path } });
      else { await api('/api/fs/write', { method: 'POST', body: { path, content: '', create: true } }); view(path); }
      refresh();
    } catch (e) { toast(e.message); }
  };
  const onUpload = async (files) => {
    for (const f of files) {
      try { await api('/api/fs/upload', { method: 'POST', body: { folder: listing.path, name: f.name, data: await readBase64(f) } }); }
      catch (e) { toast(`${f.name}: ${e.message}`); }
    }
    toast(files.length === 1 ? `Uploaded ${files[0].name}.` : `Uploaded ${files.length} files.`);
    refresh();
  };
  const showDiff = async (path) => {
    try {
      const { files } = await api(`/api/git/diff?path=${q(git.root)}&file=${q(path)}`);
      if (files[0]) setFile({ path, diff: files[0] });
    } catch (e) { toast(e.message); }
  };

  if (!roots.length) return html`<${FilesFrame}><div class="state-center"><span class="ico" style="width: 44px; height: 44px; border-radius: 12px"><${Icon} name="folder" size=${20} /></span>
    <div class="big">No shared folders</div><div class="sub">Set FILES_ROOTS in the server’s .env to the folders you want to browse here, then restart it.</div></div><//>`;
  if (!folder) return html`<${FilesFrame}><${Roots} roots=${roots} onOpen=${go} /><//>`;

  const crumbs = [];
  const root = roots.find((r) => folder === r.path || folder.startsWith(`${r.path}/`));
  if (root) {
    crumbs.push([root.name, root.path]);
    let at = root.path;
    for (const part of folder.slice(root.path.length).split('/').filter(Boolean)) { at = `${at}/${part}`; crumbs.push([part, at]); }
  }
  const dirty = file && file.text != null && file.text !== file.saved;
  const changes = Object.fromEntries((git?.changes || []).map((c) => [c.path, c.status]));
  return html`<${FilesFrame}>
    <div class="fm-bar">
      <nav class="fm-crumbs" aria-label="Folder">
        <a href="#/files" class="crumb-root" onClick=${(e) => { e.preventDefault(); navigate('#/files'); }}><${Icon} name="layers" size=${14} />Folders</a>
        ${crumbs.map(([name, path], i) => html`<span class="crumb-sep">/</span><a key=${path} href=${`#/files?path=${q(path)}`} class=${cx('crumb-root', i === crumbs.length - 1 && 'here')}
          onClick=${(e) => { e.preventDefault(); go(path); }}>${name}</a>`)}
      </nav>
      <span style="flex: 1"></span>
      <button class="btn btn-g hide-sm" onClick=${() => setFinder(true)} title="Go to file  ⌘P"><${Icon} name="search" />Go to file</button>
      <${FolderMenu} onNewFile=${() => create(false)} onNewFolder=${() => create(true)} onUpload=${() => upload.current?.click()} onRefresh=${refresh}
        onAgent=${() => askAgent(listing?.path)} />
      <button class=${cx('ib', panel === 'search' && 'on')} aria-label="Search in files" title="Search in files" onClick=${() => setPanel(panel === 'search' ? null : 'search')}><${Icon} name="list" /></button>
      <button class=${cx('ib', panel === 'git' && 'on')} aria-label="Git" title="Git" onClick=${() => setPanel(panel === 'git' ? null : 'git')}><${Icon} name="branch" /></button>
      <input type="file" multiple hidden ref=${upload} onChange=${(e) => { onUpload([...e.target.files]); e.target.value = ''; }} />
    </div>
    <div class="fm-body">
      <div class=${cx('fm-list', file && 'has-file')}>
        ${error && html`<div class="nt err" style="margin: 12px"><${Icon} name="error" /><div><b>${error}</b></div></div>`}
        ${listing && listing.parent && html`<button class="fm-row" onClick=${() => go(listing.parent)}><${Icon} name="chevron-left" size=${15} /><span class="t">..</span></button>`}
        ${listing && listing.entries.length === 0 && html`<div class="side-empty"><${Icon} name="folder" size=${18} />This folder is empty.</div>`}
        ${listing && listing.entries.map((entry) => html`<${EntryRow} key=${entry.path} entry=${entry} on=${file?.path === entry.path} status=${changes[entry.path]}
          onOpen=${() => (entry.dir ? go(entry.path) : view(entry.path))} onChange=${refresh} />`)}
      </div>
      ${file && html`<div class="fm-view">
        <div class="fm-view-head">
          <button class="ib phone-only" aria-label="Back to the folder" onClick=${() => go(folder)}><${Icon} name="chevron-left" /></button>
          <${Icon} name=${file.diff ? 'branch' : 'file'} style="color: var(--tx-3)" /><span class="mono g" title=${file.path}>${basename(file.path)}${dirty ? ' •' : ''}</span>
          ${file.diff && html`<span class="pill">${file.diff.status}</span>`}
          <span style="flex: 1"></span>
          ${file.text != null && !file.diff && html`<button class="btn btn-sm" disabled=${!dirty} onClick=${save}><${Icon} name="save" size=${14} />Save</button>`}
          <a class="btn btn-g btn-sm" href=${rawUrl(file.path, true)} download=${basename(file.path)} aria-label="Download"><${Icon} name="download" size=${14} /></a>
          <button class="ib" aria-label="Close file" onClick=${() => (dirty && !window.confirm('Discard your unsaved changes?') ? null : go(folder))}><${Icon} name="close" /></button>
        </div>
        <${FileView} file=${file} onEdit=${(text) => setFile({ ...file, text })} onSave=${save} />
      </div>`}
      ${panel === 'git' && html`<${GitPanel} git=${git} folder=${listing?.path || folder} onChange=${refresh} onDiff=${showDiff} onClose=${() => setPanel(null)} />`}
      ${panel === 'search' && html`<${SearchPanel} folder=${listing?.path || folder} onOpen=${view} onClose=${() => setPanel(null)} />`}
    </div>
    ${finder && html`<${GoToFile} folder=${listing?.path || folder} onOpen=${(p) => { setFinder(false); view(p); }} onClose=${() => setFinder(false)} />`}
  <//>`;
}

function askAgent(folder) {
  const agents = store.get().config?.agents || [];
  if (!agents.length) { toast('No agent is set up in .env.'); return; }
  store.set({ draftCwd: folder });
  newChat(`agent:${agents[0].id}`);
}

function FilesFrame({ children }) {
  return html`<div class="files">
    <header class="chat-header">
      <button class="ib phone-only" aria-label="Open menu" onClick=${() => store.set({ drawer: true })}><${Icon} name="menu" /></button>
      <div class="crumbs"><span class="crumb-title" style="cursor: default"><${Icon} name="folder" size=${15} style="color: var(--tx-3)" /><span>Files</span></span></div>
      <div class="phone-title phone-only"><span class="pt">Files</span></div>
    </header>
    ${children}
  </div>`;
}

function Roots({ roots, onOpen }) {
  const [cloning, setCloning] = useState(null);
  return html`<div class="settings-page" style="max-width: 760px">
    <div><h1>Files</h1><p class="lead">The folders this server shares. Agents work in them too, and Git runs with the server’s own sign-in.</p></div>
    <div class="card">${roots.map((r, i) => html`<div key=${r.path}>${i > 0 && html`<div class="hr"></div>`}
      <div class="prov-row">
        <span class="prov-logo" style="display: grid; place-items: center; background: var(--bg-active); color: var(--tx-2)"><${Icon} name="folder" /></span>
        <div style="flex: 1; min-width: 0"><div class="prov-name">${r.name}${!r.exists && html`<span class="pill warn">Missing</span>`}</div><div class="prov-sub mono">${r.path}</div></div>
        <button class="btn btn-g" onClick=${() => setCloning(r.path)} disabled=${!r.exists}>Clone a repository here</button>
        <button class="btn" onClick=${() => onOpen(r.path)} disabled=${!r.exists}>Open</button>
      </div></div>`)}</div>
    ${cloning && html`<${CloneDialog} into=${cloning} onClose=${() => setCloning(null)} onDone=${(e) => onOpen(e.path)} />`}
  </div>`;
}

function CloneDialog({ into, onClose, onDone }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const entry = await api('/api/git/clone', { method: 'POST', body: { url: url.trim(), into } }); toast(`Cloned into ${entry.name}.`); onClose(); onDone(entry); }
    catch (e) { toast(e.message); }
    finally { setBusy(false); }
  };
  return html`<${Dialog} onClose=${onClose} label="Clone a repository" width=${500}>
    <div class="dh"><span class="ico"><${Icon} name="branch" /></span><div><h3>Clone a repository</h3><p>Into ${basename(into)}. Private ones need the server’s Git sign-in (a deploy key or a token).</p></div></div>
    <div class="db"><div class="f"><label for="clone-url">Address</label>
      <input id="clone-url" class="inp mono" value=${url} onInput=${(e) => setUrl(e.target.value)} placeholder="https://github.com/you/project.git" data-autofocus
        onKeyDown=${(e) => e.key === 'Enter' && url.trim() && go()} /></div></div>
    <div class="df"><button class="btn btn-g" onClick=${onClose}>Cancel</button><button class="btn btn-p" disabled=${busy || !url.trim()} onClick=${go}>${busy ? 'Cloning…' : 'Clone'}</button></div>
  <//>`;
}

function FolderMenu({ onNewFile, onNewFolder, onUpload, onRefresh, onAgent }) {
  const menu = useToggle();
  return html`<button class="btn" ref=${menu.ref} aria-haspopup="menu" aria-expanded=${menu.open} onClick=${menu.toggle}><${Icon} name="plus" />New</button>
    ${menu.open && html`<${Menu} anchor=${menu.ref} onClose=${menu.close} label="New" width=${230} align="end">
      <${MenuItem} icon="file-plus" onClick=${onNewFile}>New file<//>
      <${MenuItem} icon="folder-plus" onClick=${onNewFolder}>New folder<//>
      <${MenuItem} icon="upload" onClick=${onUpload}>Upload files<//>
      <${MenuSep} />
      <${MenuItem} icon="agent" onClick=${onAgent}>New agent chat in this folder<//>
      <${MenuItem} icon="refresh" onClick=${onRefresh}>Refresh<//>
    <//>`}`;
}

function EntryRow({ entry, on, status, onOpen, onChange }) {
  const menu = useToggle();
  const rename = async () => {
    const name = window.prompt('New name', entry.name);
    if (!name || name === entry.name) return;
    try { await api('/api/fs/rename', { method: 'POST', body: { path: entry.path, to: `${dirname(entry.path)}/${name}` } }); onChange(); }
    catch (e) { toast(e.message); }
  };
  const remove = () => confirm({ title: `Delete ${entry.name}?`, danger: true, action: 'Delete',
    body: entry.dir ? 'The folder and everything in it are removed from the server for good.' : 'The file is removed from the server for good.',
    onConfirm: async () => { try { await api('/api/fs/delete', { method: 'POST', body: { path: entry.path } }); onChange(); } catch (e) { toast(e.message); } } });
  return html`<div class=${cx('row-wrap', menu.open && 'menu-open')}>
    <button class=${cx('fm-row', on && 'on')} onClick=${onOpen} title=${entry.path}>
      <${Icon} name=${iconFor(entry)} size=${15} style=${entry.dir ? 'color: var(--ac-tx)' : 'color: var(--tx-3)'} />
      <span class="t">${entry.name}</span>
      ${status && html`<span class=${cx('git-st', status)} title=${status}>${STATUS[status]}</span>`}
      <span class="meta hide-sm">${entry.dir ? '' : size(entry.size)}</span>
      <span class="meta hide-sm" style="width: 84px; text-align: right">${entry.mtime ? ago(entry.mtime) : ''}</span>
    </button>
    <button class="row-more" ref=${menu.ref} aria-label=${`Actions for ${entry.name}`} aria-haspopup="menu" onClick=${menu.toggle}><${Icon} name="more" size=${14} /></button>
    ${menu.open && html`<${Menu} anchor=${menu.ref} onClose=${menu.close} label="File actions" width=${220} align="end">
      ${entry.dir ? html`<${MenuItem} icon="agent" onClick=${() => askAgent(entry.path)}>New agent chat here<//>`
        : html`<a class="mi" role="menuitem" data-close="1" href=${rawUrl(entry.path, true)} download=${entry.name}><${Icon} name="download" />Download</a>`}
      <${MenuItem} icon="edit" onClick=${rename}>Rename…<//>
      <${MenuSep} />
      <${MenuItem} icon="delete" danger onClick=${remove}>Delete…<//>
    <//>`}
  </div>`;
}

function FileView({ file, onEdit, onSave }) {
  const [mode, setMode] = useState('edit');
  const area = useRef(null);
  if (file.diff) {
    return html`<div class="fm-scroll"><div class="blk" style="margin: 12px"><${Diff} diff=${{ path: file.diff.rel, old: file.diff.old, new: file.diff.new }} head=${false} /></div></div>`;
  }
  const { info } = file;
  if (isImage(info.mime)) return html`<div class="fm-scroll fm-center"><img src=${rawUrl(file.path)} alt=${basename(file.path)} style="max-width: 100%; max-height: 100%; border-radius: 8px" /></div>`;
  if (info.mime === 'application/pdf') return html`<iframe class="fm-pdf" src=${rawUrl(file.path)} title=${basename(file.path)}></iframe>`;
  if (file.text == null) {
    return html`<div class="fm-scroll fm-center"><div class="state-center" style="height: auto"><span class="ico"><${Icon} name="file" /></span>
      <div class="big">${info.reason === 'too_big' ? 'Too large to show' : 'Not a text file'}</div><div class="sub">${size(info.size)} · ${info.mime}</div>
      <a class="btn" href=${rawUrl(file.path, true)} download=${basename(file.path)}><${Icon} name="download" />Download</a></div></div>`;
  }
  const markdown = /\.(md|markdown)$/i.test(file.path);
  const lines = file.text.split('\n').length;
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); onSave(); }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = e.target, at = el.selectionStart;
      onEdit(`${file.text.slice(0, at)}  ${file.text.slice(el.selectionEnd)}`);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = at + 2; });
    }
  };
  return html`<div class="fm-edit">
    ${markdown && html`<div class="fm-tabs"><div class="seg" role="tablist">${[['edit', 'Edit'], ['preview', 'Preview']].map(([id, label]) => html`<button key=${id} role="tab"
      aria-selected=${mode === id} class=${mode === id ? 'on' : ''} onClick=${() => setMode(id)}>${label}</button>`)}</div></div>`}
    ${markdown && mode === 'preview' ? html`<div class="fm-scroll" style="padding: 20px 24px"><${Markdown} text=${file.text} /></div>`
      : html`<div class="fm-code"><div class="fm-gutter" aria-hidden="true">${Array.from({ length: Math.min(lines, 20000) }, (_, i) => i + 1).join('\n')}</div>
        <label class="sr" for="fm-text">Contents of ${basename(file.path)}</label>
        <textarea id="fm-text" ref=${area} class="bare mono" spellcheck="false" value=${file.text} onInput=${(e) => onEdit(e.target.value)} onKeyDown=${onKey}
          onScroll=${(e) => { const g = e.target.previousElementSibling?.previousElementSibling; if (g) g.scrollTop = e.target.scrollTop; }}></textarea></div>`}
    <div class="fm-status"><span>${info.mime.split('/').pop()}</span><span>UTF-8</span><span>${lines} lines</span><span style="margin-left: auto">${file.text !== file.saved ? 'Unsaved · ⌘S saves' : 'Saved'}</span></div>
  </div>`;
}

function GitPanel({ git, folder, onChange, onDiff, onClose }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState([]);
  const branchMenu = useToggle();
  const [branches, setBranches] = useState(null);
  useEffect(() => { if (git?.repo) api(`/api/git/log?path=${q(git.root)}`).then(setLog).catch(() => setLog([])); }, [git?.root, git?.changes?.length, git?.ahead]);
  const run = async (label, fn, done) => {
    setBusy(label);
    try { await fn(); if (done) toast(done); onChange(); }
    catch (e) { toast(e.message); }
    finally { setBusy(''); }
  };
  if (!git) return html`<aside class="inspector fm-panel" aria-label="Git"><div class="insp-head"><span class="h2">Git</span><span style="flex: 1"></span><button class="ib" aria-label="Close" onClick=${onClose}><${Icon} name="close" /></button></div>
    <div class="insp-body"><div class="skeleton"><span></span><span style="width: 60%"></span></div></div></aside>`;
  if (!git.repo) {
    return html`<aside class="inspector fm-panel" aria-label="Git"><div class="insp-head"><span class="h2">Git</span><span style="flex: 1"></span><button class="ib" aria-label="Close" onClick=${onClose}><${Icon} name="close" /></button></div>
      <div class="insp-body"><p class="sub" style="margin: 0">This folder isn’t a Git repository.</p>
        <button class="btn" disabled=${!!busy} onClick=${() => run('init', () => api('/api/git/init', { method: 'POST', body: { path: folder } }), 'Started a repository.')}><${Icon} name="branch" />Start a repository here</button></div></aside>`;
  }
  const openBranches = async () => { branchMenu.toggle(); try { setBranches(await api(`/api/git/branches?path=${q(git.root)}`)); } catch (e) { toast(e.message); } };
  const switchTo = (branch, create) => run('switch', () => api('/api/git/switch', { method: 'POST', body: { path: git.root, branch, create } }), `On ${branch}.`);
  const sync = (action) => run(action, () => api('/api/git/sync', { method: 'POST', body: { path: git.root, action } }), action === 'push' ? 'Pushed.' : action === 'pull' ? 'Pulled.' : 'Fetched.');
  const commit = () => run('commit', async () => { await api('/api/git/commit', { method: 'POST', body: { path: git.root, message } }); setMessage(''); }, 'Committed.');
  return html`<aside class="inspector fm-panel" aria-label="Git">
    <div class="insp-head">
      <button class="ab" ref=${branchMenu.ref} aria-haspopup="menu" onClick=${openBranches}><${Icon} name="branch" size=${14} />${git.branch || 'detached'}<${Icon} name="chevron-down" size=${13} /></button>
      <span style="flex: 1"></span>
      <button class="ib" aria-label="Pull" title=${`Pull${git.behind ? ` (${git.behind} behind)` : ''}`} disabled=${!!busy} onClick=${() => sync('pull')}><${Icon} name="arrow-down" /></button>
      <button class="ib" aria-label="Push" title=${`Push${git.ahead ? ` (${git.ahead} ahead)` : ''}`} disabled=${!!busy} onClick=${() => sync('push')}><${Icon} name="arrow-up" /></button>
      <button class="ib" aria-label="Close" onClick=${onClose}><${Icon} name="close" /></button>
    </div>
    ${branchMenu.open && html`<${Menu} anchor=${branchMenu.ref} onClose=${branchMenu.close} label="Branches" width=${260}>
      <${MenuItem} icon="plus" onClick=${() => { const name = window.prompt('New branch name'); if (name) switchTo(name.trim(), true); }}>New branch…<//>
      <${MenuSep} />
      ${!branches ? html`<div class="mh">Loading…</div>` : branches.branches.map((b) => html`<${MenuItem} key=${b} radio checked=${b === branches.current}
        onClick=${() => b !== branches.current && switchTo(b.replace(/^origin\//, ''), false)}>${b}<//>`)}
    <//>`}
    <div class="insp-body">
      <div style="display: flex; gap: 8px; flex-wrap: wrap; font-size: 12.5px; color: var(--tx-3)">
        ${git.upstream ? html`<span>Tracks <span class="mono">${git.upstream}</span></span>` : html`<span>Not pushed yet</span>`}
        ${git.ahead > 0 && html`<span class="pill ac">${git.ahead} to push</span>`}${git.behind > 0 && html`<span class="pill warn">${git.behind} to pull</span>`}
        ${busy && html`<span class="spinner"></span>`}
      </div>
      <div>
        <div class="cap" style="margin-bottom: 6px">${git.changes.length ? `${git.changes.length} changed file${git.changes.length === 1 ? '' : 's'}` : 'No changes'}</div>
        ${git.changes.map((c) => html`<button key=${c.path} class="fm-row" onClick=${() => onDiff(c.path)} title=${c.rel}>
          <span class=${cx('git-st', c.status)}>${STATUS[c.status]}</span><span class="t mono" style="font-size: 12.5px">${c.rel}</span></button>`)}
      </div>
      ${git.changes.length > 0 && html`<div class="f">
        <label for="commit-msg">Commit message</label>
        <textarea id="commit-msg" class="inp" rows="3" style="height: auto; padding: 8px 12px; resize: vertical" value=${message} onInput=${(e) => setMessage(e.target.value)}
          placeholder="Describe the change" onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && message.trim()) commit(); }}></textarea>
        <button class="btn btn-p" disabled=${!!busy || !message.trim()} onClick=${commit}><${Icon} name="commit" />Commit all changes</button>
      </div>`}
      <div>
        <div class="cap" style="margin-bottom: 6px">History</div>
        ${log.length === 0 && html`<div class="sub">No commits yet.</div>`}
        ${log.map((c) => html`<div key=${c.sha} class="git-log"><span class="mono meta">${c.sha}</span><span class="t" title=${c.subject}>${c.subject}</span>
          <span class="meta">${c.author} · ${ago(c.at)}</span></div>`)}
      </div>
    </div>
  </aside>`;
}

function SearchPanel({ folder, onOpen, onClose }) {
  const [query, setQuery] = useState('');
  const [opts, setOpts] = useState({ regex: false, case: false, include: '' });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try { setResult(await api(`/api/fs/grep?path=${q(folder)}&q=${q(query)}${opts.regex ? '&regex=1' : ''}${opts.case ? '&case=1' : ''}${opts.include ? `&include=${q(opts.include)}` : ''}`)); }
    catch (e) { toast(e.message); }
    finally { setBusy(false); }
  };
  return html`<aside class="inspector fm-panel" aria-label="Search in files">
    <div class="insp-head"><span class="h2">Search</span><span style="flex: 1"></span><button class="ib" aria-label="Close" onClick=${onClose}><${Icon} name="close" /></button></div>
    <div class="insp-body" style="gap: 10px">
      <div class="fm-search"><label class="sr" for="grep-q">Search in files</label>
        <input id="grep-q" class="bare" value=${query} onInput=${(e) => setQuery(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && run()} placeholder="Search in files" data-autofocus />
        <button class=${cx('btn btn-sm', opts.case && 'on')} aria-pressed=${opts.case} title="Match case" onClick=${() => setOpts({ ...opts, case: !opts.case })}>Aa</button>
        <button class=${cx('btn btn-sm', opts.regex && 'on')} aria-pressed=${opts.regex} title="Regular expression" onClick=${() => setOpts({ ...opts, regex: !opts.regex })}>.*</button></div>
      <label class="sr" for="grep-inc">Files to include</label>
      <input id="grep-inc" class="inp mono" style="height: 30px; font-size: 12.5px" value=${opts.include} placeholder="Files to include, like src/**" onInput=${(e) => setOpts({ ...opts, include: e.target.value })} />
      ${busy && html`<div class="spinner"></div>`}
      ${result && html`<div class="meta">${result.total} match${result.total === 1 ? '' : 'es'} in ${result.files.length} file${result.files.length === 1 ? '' : 's'}${result.truncated ? ' (first ones)' : ''}</div>`}
      ${result && result.files.map((f) => html`<div key=${f.path}>
        <button class="fm-row" onClick=${() => onOpen(f.path)}><${Icon} name="file" size=${14} /><span class="t">${basename(f.path)}</span><span class="meta">${dirname(f.rel) === '/' ? '' : dirname(f.rel)}</span><span class="pill">${f.hits.length}</span></button>
        ${f.hits.slice(0, 20).map((h) => html`<button key=${h.line} class="fm-hit" onClick=${() => onOpen(f.path)}><span class="n">${h.line}</span><span>${h.text.trim()}</span></button>`)}
      </div>`)}
    </div>
  </aside>`;
}

function GoToFile({ folder, onOpen, onClose }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [hot, setHot] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => api(`/api/fs/find?path=${q(folder)}&q=${q(query)}`).then((r) => { setFound(r); setHot(0); }).catch(() => setFound([])), 120);
    return () => clearTimeout(t);
  }, [query]);
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHot(Math.min(hot + 1, found.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHot(Math.max(hot - 1, 0)); }
    if (e.key === 'Enter' && found[hot]) { e.preventDefault(); onOpen(found[hot].path); }
  };
  return html`<${Dialog} onClose=${onClose} label="Go to file" width=${560} top=${96}>
    <div onKeyDown=${onKey}>
      <div class="pal-search"><${Icon} name="file-text" size=${18} style="color: var(--tx-3)" /><label for="gf" class="sr">File name</label>
        <input id="gf" class="bare" value=${query} onInput=${(e) => setQuery(e.target.value)} placeholder="File name" autocomplete="off" data-autofocus /><span class="kbd">Esc</span></div>
      <div class="pal-list">${found.map((f, i) => html`<button key=${f.path} class="row pal-row" style=${i === hot ? 'background: var(--bg-active)' : ''} onMouseEnter=${() => setHot(i)} onClick=${() => onOpen(f.path)}>
        <${Icon} name=${iconFor({ name: f.name })} size=${15} style="color: var(--tx-3)" /><span class="pal-label">${f.name}</span><span class="mono meta">${dirname(f.rel) === '/' ? '' : dirname(f.rel)}</span></button>`)}
        ${found.length === 0 && html`<div class="pal-empty">${query ? 'No file matches.' : 'Type part of a file name.'}</div>`}</div>
    </div>
  <//>`;
}

// The file and folder picker. mode: 'files' (pick several to attach), 'folder' (where an agent works),
// 'save' (a name in a folder for "Save to workspace").
export function FilePicker({ mode = 'files', start, title, onPick, onClose, name: initialName = '', content }) {
  const config = useStore((s) => s.config);
  const roots = config?.roots || [];
  const startAt = start && roots.some((r) => start === r.path || start.startsWith(`${r.path}/`)) ? start : '';
  const [at, setAt] = useState(startAt);
  const [listing, setListing] = useState(null);
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState(initialName);
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!at) { setListing(null); return; }
    api(`/api/fs/list?path=${q(at)}`).then(setListing).catch((e) => { toast(e.message); setAt(''); });
  }, [at]);
  const toggle = (entry) => setPicked((p) => (p.some((x) => x.path === entry.path) ? p.filter((x) => x.path !== entry.path) : [...p, entry]));
  const done = async () => {
    if (mode === 'files') { onPick(picked); onClose(); return; }
    if (mode === 'folder') { onPick(typed.trim() || at); onClose(); return; }
    if (!name.trim() || !at) return;
    const path = `${at}/${name.trim()}`;
    try {
      const exists = listing?.entries.some((e) => e.name === name.trim());
      if (exists && !window.confirm(`${name.trim()} already exists. Replace it?`)) return;
      await api('/api/fs/write', { method: 'POST', body: { path, content } });
      toast(`Saved ${name.trim()}.`, { action: 'Open', onAction: () => navigate(`#/files?path=${q(at)}&file=${q(path)}`) });
      onPick?.(path);
      onClose();
    } catch (e) { toast(e.message); }
  };
  const label = title || (mode === 'folder' ? 'Choose a folder' : mode === 'save' ? 'Save to workspace' : 'Attach from files');
  return html`<${Dialog} onClose=${onClose} label=${label} width=${560}>
    <div class="dh"><span class="ico"><${Icon} name=${mode === 'save' ? 'save' : 'folder'} /></span><div style="flex: 1; min-width: 0"><h3>${label}</h3>
      <p class="mono" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${at || 'Shared folders'}</p></div></div>
    <div class="db" style="padding-top: 12px">
      <div class="picker-files">
        ${!at && roots.map((r) => html`<button key=${r.path} class="fm-row" onClick=${() => setAt(r.path)} disabled=${!r.exists}><${Icon} name="folder" size=${15} style="color: var(--ac-tx)" /><span class="t">${r.name}</span><span class="meta mono">${r.path}</span></button>`)}
        ${at && html`<button class="fm-row" onClick=${() => setAt(listing?.parent || '')}><${Icon} name="chevron-left" size=${15} /><span class="t">${listing?.parent ? '..' : 'Shared folders'}</span></button>`}
        ${listing && listing.entries.filter((e) => e.dir || mode !== 'folder').map((entry) => {
          const on = picked.some((p) => p.path === entry.path);
          return html`<button key=${entry.path} class=${cx('fm-row', on && 'on')} role=${!entry.dir && mode === 'files' ? 'checkbox' : undefined} aria-checked=${!entry.dir && mode === 'files' ? on : undefined}
            onClick=${() => (entry.dir ? setAt(entry.path) : mode === 'files' ? toggle(entry) : mode === 'save' ? setName(entry.name) : null)}>
            ${!entry.dir && mode === 'files' ? html`<span class=${cx('cb', on && 'on')}>${on && html`<${Icon} name="check" />`}</span>` : html`<${Icon} name=${iconFor(entry)} size=${15} style=${entry.dir ? 'color: var(--ac-tx)' : 'color: var(--tx-3)'} />`}
            <span class="t">${entry.name}</span><span class="meta">${entry.dir ? '' : size(entry.size)}</span>
            ${entry.dir && html`<${Icon} name="chevron-right" size=${14} style="color: var(--tx-3)" />`}</button>`;
        })}
        ${listing && !listing.entries.length && html`<div class="side-empty" style="padding: 24px">Empty folder.</div>`}
      </div>
      ${mode === 'save' && html`<div class="f"><label for="save-name">File name</label><input id="save-name" class="inp mono" value=${name} onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && done()} /></div>`}
      ${mode === 'folder' && !roots.length && html`<div class="f"><label for="typed-folder">Folder on the server</label>
        <input id="typed-folder" class="inp mono" value=${typed} onInput=${(e) => setTyped(e.target.value)} placeholder="~/code/my-project" data-autofocus />
        <small>The path must already exist. Set FILES_ROOTS in .env to browse instead.</small></div>`}
    </div>
    <div class="df">
      ${mode === 'files' && html`<span class="meta" style="margin-right: auto">${picked.length ? `${picked.length} selected` : 'Pick one or more files'}</span>`}
      <button class="btn btn-g" onClick=${onClose}>Cancel</button>
      <button class="btn btn-p" onClick=${done} disabled=${mode === 'files' ? !picked.length : mode === 'folder' ? !(at || typed.trim()) : !(at && name.trim())}>
        ${mode === 'files' ? 'Attach' : mode === 'folder' ? 'Use this folder' : 'Save'}</button>
    </div>
  <//>`;
}
