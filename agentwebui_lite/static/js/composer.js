// The composer (Main, Home, Agent chat and Agent blocks boards): Send turns into Stop while a reply runs.
import { html, useState, useRef, useEffect, useLayoutEffect, store, useStore, cx, notInLite, basename, providerGradient, AGENT_GRADIENT } from './lib.js';
import { Icon } from './icons.js';
import { Menu, MenuItem, MenuHead, Dialog, useToggle } from './ui.js';
import { send, stop, describeTarget, openPicker, setMode } from './actions.js';

export function TargetButton({ value, onClick, big }) {
  const info = describeTarget(value);
  const gradient = !info ? 'var(--bg-active)' : info.kind === 'agent' ? AGENT_GRADIENT : providerGradient(info.model?.provider, info.model?.local);
  return html`<button class="target-btn" style=${big ? 'height: 32px' : ''} onClick=${onClick} aria-haspopup="dialog" title="Switch model">
    <span class="tdot" style=${`background: ${gradient}`}></span>
    <span class="tname">${info ? info.name : 'Choose a model'}</span>
    <${Icon} name="chevron-down" size=${14} style="color: var(--tx-3)" />
  </button>`;
}

export function Composer({ chat, target, onTarget, cwd, onCwd, big = false, live }) {
  const [text, setText] = useState(() => (chat ? '' : store.get().draftText || ''));
  const area = useRef(null);
  const running = !!live?.running;
  const waiting = !!live?.waiting;
  const info = describeTarget(target);
  const isAgent = info?.kind === 'agent';

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, big ? 280 : 220)}px`;
  }, [text]);
  useEffect(() => {
    const fill = (e) => { setText(e.detail); area.current?.focus(); };
    window.addEventListener('awl:prefill', fill);
    return () => window.removeEventListener('awl:prefill', fill);
  }, []);
  useEffect(() => { if (!chat) store.set({ draftText: text }); }, [text]);

  const submit = async () => {
    const message = text.trim();
    if (!message || running || !target) return;
    setText('');
    if (!chat) store.set({ draftText: '' });
    const ok = await send(message, { target, cwd: isAgent ? cwd : undefined });
    if (!ok) setText(message);
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && running && chat) { e.preventDefault(); stop(chat.id); }
  };
  const name = info?.name || 'the model';
  const placeholder = big ? 'How can I help?'
    : waiting ? 'Answer above, or reply in your own words…'
    : running && isAgent ? 'Add to the task or redirect…'
    : `Reply to ${name}…`;
  const pickTarget = () => openPicker({ value: target, onPick: onTarget, chat, tab: chat && isAgent ? 'agents' : undefined });

  return html`<div class=${cx('composer', big && 'big')}>
    ${isAgent && html`<${AgentBar} chat=${chat} info=${info} cwd=${cwd} onCwd=${onCwd} live=${live} onPick=${pickTarget} />`}
    <label for="composer" class="sr">Message</label>
    <textarea id="composer" ref=${area} rows=${big ? 3 : 2} class="bare" placeholder=${placeholder} value=${text}
      onInput=${(e) => setText(e.target.value)} onKeyDown=${onKey}></textarea>
    <div class="composer-bar">
      <button class="ib attach" aria-label="Attach files" title="Attach files" onClick=${notInLite('Attachments')}><${Icon} name="plus" /></button>
      ${big && html`<button class="chip" onClick=${notInLite('Projects')}><${Icon} name="layers" size=${14} />No project</button>`}
      ${!isAgent && html`<button class="chip hide-sm" onClick=${notInLite('Web search')}><${Icon} name="globe" size=${14} />Web search</button>`}
      <span style="flex: 1"></span>
      ${!isAgent && html`<${TargetButton} value=${target} big=${big} onClick=${pickTarget} />`}
      <button class="ib" aria-label="Dictate" title="Dictate" style="width: 30px; height: 30px" onClick=${notInLite('Dictation')}><${Icon} name="mic" /></button>
      ${running
        ? html`<button class="round-send" aria-label="Stop reply" title="Stop  Esc" onClick=${() => stop(chat.id)}><span class="stop"></span></button>`
        : html`<button class="round-send" aria-label="Send" title="Send  ↵" disabled=${!text.trim() || !target} onClick=${submit}
            style=${big ? 'width: 34px; height: 34px' : ''}><${Icon} name="send" /></button>`}
    </div>
  </div>`;
}

function AgentBar({ chat, info, cwd, onCwd, live, onPick }) {
  const modeMenu = useToggle();
  const [folderOpen, setFolderOpen] = useState(false);
  const modes = live?.modes || chat?.agent?.modes;
  const current = modes?.available.find((m) => m.id === modes.current);
  const folder = chat ? chat.cwd : cwd;
  const connected = !!(live?.running || chat?.agent?.connected);
  const status = live?.waiting ? ['var(--warn)', 'Waiting for you'] : live?.running ? ['var(--ac-tx)', 'Working'] : connected ? ['var(--ok)', 'Connected'] : ['var(--tx-3)', chat ? 'Starts when you send' : 'Not started'];
  return html`<div class="agent-bar">
    <button class="ab" onClick=${chat ? undefined : onPick} disabled=${!!chat} title=${chat ? info.name : 'Choose an agent'}>
      <${Icon} name="agent" size=${14} />${info.name}${!chat && html`<${Icon} name="chevron-down" size=${13} />`}
    </button>
    <span class="vsep"></span>
    <button class="ab" title=${folder} onClick=${chat ? undefined : () => setFolderOpen(true)} disabled=${!!chat}>
      <${Icon} name="folder" size=${14} /><span class="mono-ish">${basename(folder) || 'Folder'}</span>${!chat && html`<${Icon} name="chevron-down" size=${13} />`}
    </button>
    ${modes && modes.available.length > 0 && html`<button class=${cx('ab', modeMenu.open && 'on')} ref=${modeMenu.ref} aria-haspopup="menu"
        aria-expanded=${modeMenu.open} onClick=${modeMenu.toggle}>
        <${Icon} name="shield" size=${14} />${current?.name || 'Mode'}<${Icon} name="chevron-down" size=${13} />
      </button>`}
    <span style="flex: 1"></span>
    <span class="agent-status"><span class="sdot" style=${`background: ${status[0]}`}></span>${status[1]}</span>
    ${modeMenu.open && html`<${Menu} anchor=${modeMenu.ref} onClose=${modeMenu.close} label="Agent mode" width=${330} up=${true}>
      <${MenuHead}>How much can it do alone?<//>
      ${modes.available.map((m) => html`<${MenuItem} key=${m.id} radio checked=${m.id === modes.current} desc=${m.description || undefined}
        icon=${m.id === modes.current ? 'success' : 'waiting'} onClick=${() => setMode(chat.id, m.id)}>${m.name}<//>`)}
    <//>`}
    ${folderOpen && html`<${FolderDialog} value=${cwd} onClose=${() => setFolderOpen(false)} onSave=${onCwd} agent=${info.name} />`}
  </div>`;
}

function FolderDialog({ value, onClose, onSave, agent }) {
  const [path, setPath] = useState(value || '');
  const save = () => { if (path.trim()) { onSave(path.trim()); onClose(); } };
  return html`<${Dialog} onClose=${onClose} label="Choose a folder" width=${480}>
    <div class="dh"><span class="ico"><${Icon} name="folder" /></span><div><h3>Where should ${agent} work?</h3>
      <p>It reads and edits files in this folder, and asks before it acts.</p></div></div>
    <div class="db">
      <div class="f"><label for="cwd">Folder on this computer</label>
        <input id="cwd" class="inp mono" value=${path} onInput=${(e) => setPath(e.target.value)} data-autofocus
          onKeyDown=${(e) => e.key === 'Enter' && save()} placeholder="~/code/my-project" />
        <small>The path must already exist. You can use ~ for your home folder.</small></div>
    </div>
    <div class="df"><button class="btn btn-g" onClick=${onClose}>Cancel</button><button class="btn btn-p" onClick=${save}>Use this folder</button></div>
  <//>`;
}
