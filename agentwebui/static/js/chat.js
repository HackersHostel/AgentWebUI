// The conversation screen (Main and Agent chat boards) with its context panel.
import { html, useEffect, useRef, useState, useLayoutEffect, store, useStore, cx, basename, secs, toast, navigate, size, isImage, fileUrl } from './lib.js';
import { Icon } from './icons.js';
import { Menu, MenuItem, MenuSep, confirm, useToggle } from './ui.js';
import { UserMessage, Reply, NoteLine, localUrl } from './messages.js';
import { Composer } from './composer.js';
import { chatTarget, describeTarget, toggleInspector, deleteChat, switchModel, newChat, openPicker, pinChat, archiveChat, cloneChat,
  exportChat, updateChat } from './actions.js';
import { SystemState } from './states.js';
import { speak } from './voice.js';

export function ChatScreen() {
  const { chat, live, inspector } = useStore((s) => ({ chat: s.chat, live: s.chat ? s.live[s.chat.id] : null, inspector: s.inspector }));
  const scroller = useRef(null);
  const stick = useRef(true);
  const [announce, setAnnounce] = useState('');
  const wasRunning = useRef(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => { stick.current = true; }, [chat?.id]);
  useEffect(() => {
    if (wasRunning.current && !live?.running) {
      setAnnounce(live?.error ? 'The reply failed.' : 'Reply finished.');
      const { chatPrefs, voice } = store.get();
      if (chatPrefs.autoRead && !voice?.active && live?.lastReply?.content && !document.hidden) speak(live.lastReply.content);
    }
    if (live?.waiting) setAnnounce('Waiting for your answer.');
    wasRunning.current = !!live?.running;
  }, [live?.running, live?.waiting]);
  if (!chat) return null;
  if (chat.missing) return html`<${SystemState} kind="missing" />`;
  if (chat.error) return html`<${SystemState} kind="error" detail=${chat.error} />`;
  const onScroll = (e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
  const messages = chat.messages || [];
  const showLive = live && (live.running || live.error) && live.parts;
  const lastReal = messages.reduce((n, m, i) => (m.role === 'note' ? n : i), -1);
  return html`<div class="chat-screen">
    <${ChatHeader} chat=${chat} live=${live} />
    ${chat.temporary && html`<div class="banner temp"><${Icon} name="temporary" /><span>Temporary chat. It isn’t saved and disappears when you leave it.</span></div>`}
    <div class="chat-body">
      <div class="chat-main">
        <div class="messages" ref=${scroller} onScroll=${onScroll} aria-busy=${!!live?.running}>
          <div class="column">
            ${chat.loading && html`<div class="skeleton"><span></span><span></span><span style="width: 40%"></span></div>`}
            ${messages.map((m, i) => (m.role === 'note' ? html`<${NoteLine} key=${m.id} text=${m.content} />`
              : m.role === 'user'
              ? html`<${UserMessage} key=${m.id} chat=${chat} message=${m} running=${!!live?.running} />`
              : html`<${Reply} key=${m.id} chat=${chat} message=${m} last=${!showLive && i === lastReal} />`))}
            ${showLive && html`<${Reply} key="live" chat=${chat} live=${live} last=${true} />`}
          </div>
        </div>
        <div class="composer-wrap">
          <div class="column">
            <${Composer} key=${chat.id} chat=${chat} target=${chatTarget(chat)} live=${live}
              onTarget=${(t) => switchModel(chat.id, t)} temporary=${chat.temporary} />
            <p class="disclaimer">${chat.kind === 'agent' ? 'Agents can make mistakes. Check changes before you keep them.' : 'Replies can be wrong. Check anything important.'}</p>
          </div>
        </div>
      </div>
      ${inspector && html`<${Inspector} chat=${chat} live=${live} tab=${inspector} />`}
    </div>
    <div class="sr" aria-live="polite">${announce}</div>
  </div>`;
}

function ChatHeader({ chat, live }) {
  const { inspector, config, projects } = useStore((s) => ({ inspector: s.inspector, config: s.config, projects: s.projects }));
  const titleMenu = useToggle();
  const more = useToggle();
  const bell = useToggle();
  const exportMenu = useToggle();
  const isAgent = chat.kind === 'agent';
  const info = describeTarget(chatTarget(chat), config);
  const project = projects.find((p) => p.id === chat.project_id);
  const remove = () => confirm({ title: 'Delete this chat?', danger: true, action: 'Delete chat',
    body: `“${chat.title || 'New chat'}” and its messages are removed for good.`, onConfirm: () => deleteChat(chat.id) });
  const rename = () => store.set({ overlay: { type: 'rename', id: chat.id, title: chat.title || '' } });
  const titleItems = chat.temporary ? html`<${MenuItem} icon="delete" danger onClick=${() => deleteChat(chat.id)}>Delete now<//>` : html`
    <${MenuItem} icon="edit" onClick=${rename}>Rename<//>
    <${MenuItem} icon="pin" onClick=${() => pinChat(chat.id, !chat.pinned)}>${chat.pinned ? 'Unpin' : 'Pin'}<//>
    <${MenuItem} icon="layers" onClick=${() => store.set({ overlay: { type: 'move', chat } })}>Move to project…<//>
    <${MenuItem} icon="clone" onClick=${() => cloneChat(chat.id)}>Clone<//>
    <${MenuItem} icon="archive" onClick=${() => archiveChat(chat.id, !chat.archived)}>${chat.archived ? 'Unarchive' : 'Archive'}<//>
    <${MenuSep} />
    <${MenuItem} icon="delete" danger onClick=${remove}>Delete…<//>`;
  return html`<header class="chat-header">
    <button class="ib phone-only" aria-label="Open menu" onClick=${() => store.set({ drawer: true })}><${Icon} name="menu" /></button>
    <div class="crumbs">
      ${isAgent
        ? html`<a class="crumb-root" href=${config?.roots?.length ? `#/files?path=${encodeURIComponent(chat.cwd)}` : '#/'} title=${chat.cwd}
            onClick=${(e) => { if (!config?.roots?.length) { e.preventDefault(); } }}><${Icon} name="folder" size=${13} />${basename(chat.cwd)}</a>`
        : project ? html`<span class="crumb-root"><${Icon} name="layers" size=${13} />${project.name}</span>`
        : html`<a class="crumb-root" href="#/" onClick=${(e) => { e.preventDefault(); newChat(); }}><span class="crumb-dot"></span>${config?.brand?.name || 'AgentWebUI'}</a>`}
      <span class="crumb-sep">/</span>
      <button class="crumb-title" ref=${titleMenu.ref} aria-haspopup="menu" aria-expanded=${titleMenu.open} onClick=${titleMenu.toggle}>
        <span>${chat.title || 'New chat'}</span><${Icon} name="chevron-down" size=${14} style="color: var(--tx-3)" />
      </button>
      ${chat.pinned && html`<${Icon} name="pin" size=${13} style="color: var(--tx-3)" />`}
      ${chat.temporary && html`<span class="pill"><${Icon} name="temporary" />Temporary</span>`}
      ${live?.waiting
        ? html`<span class="pill warn"><${Icon} name="waiting" />Waiting for you</span>`
        : live?.running && isAgent && html`<span class="pill ac"><span class="st run" style="width: 12px; height: 12px; border-width: 1.5px"></span>Working</span>`}
    </div>
    <div class="phone-title phone-only" onClick=${() => !isAgent && openPicker({ value: chatTarget(chat), chat, onPick: (t) => switchModel(chat.id, t) })}>
      <span class="pt">${chat.title || 'New chat'}</span>
      <span class="ps">${info?.name || ''}${!isAgent && html`<${Icon} name="chevron-down" size=${12} />`}</span>
    </div>
    <div class="header-actions">
      ${!isAgent && html`<button class=${cx('ib hide-sm', inspector === 'controls' && 'on')} aria-label="Chat controls" title="Chat controls" onClick=${() => toggleInspector('controls')}><${Icon} name="settings" /></button>`}
      <button class=${cx('ib hide-sm', inspector === 'context' && 'on')} aria-label=${isAgent ? 'Context panel' : 'Context'} title="Context for this chat" onClick=${() => toggleInspector('context')}><${Icon} name="gauge" /></button>
      <button class=${cx('ib hide-sm', inspector === 'files' && 'on')} aria-label="Files in this chat" title="Files in this chat" onClick=${() => toggleInspector('files')}><${Icon} name="attach" /></button>
      <button class="ib hide-sm" ref=${bell.ref} aria-label="Notifications" title="Notifications" onClick=${bell.toggle}><${Icon} name="notification" /></button>
      <span class="hsep hide-sm"></span>
      <button class="btn hide-sm" ref=${exportMenu.ref} aria-haspopup="menu" onClick=${exportMenu.toggle}><${Icon} name="export" size=${15} />Export</button>
      <button class="ib" aria-label="More actions" ref=${more.ref} aria-haspopup="menu" onClick=${more.toggle}><${Icon} name="more" /></button>
      <button class="ib phone-only" aria-label="New chat" onClick=${() => newChat()}><${Icon} name="new-chat" /></button>
    </div>
    ${titleMenu.open && html`<${Menu} anchor=${titleMenu.ref} onClose=${titleMenu.close} label="Chat" width=${210}>${titleItems}<//>`}
    ${exportMenu.open && html`<${Menu} anchor=${exportMenu.ref} onClose=${exportMenu.close} label="Export" width=${220} align="end">
      <${MenuItem} icon="file-text" onClick=${() => exportChat(chat.id, 'md')}>Markdown (.md)<//>
      <${MenuItem} icon="workspace" onClick=${() => exportChat(chat.id, 'json')}>JSON (.json)<//>
    <//>`}
    ${more.open && html`<${Menu} anchor=${more.ref} onClose=${more.close} label="More actions" width=${230} align="end">
      <${MenuItem} icon="gauge" onClick=${() => toggleInspector('context')}>Context panel<//>
      <${MenuItem} icon="attach" onClick=${() => toggleInspector('files')}>Files in this chat<//>
      ${!isAgent && html`<${MenuItem} icon="settings" onClick=${() => toggleInspector('controls')}>Chat controls<//>`}
      <${MenuItem} icon="export" onClick=${() => exportChat(chat.id, 'md')}>Export as Markdown<//>
      <${MenuSep} />
      ${titleItems}
    <//>`}
    ${bell.open && html`<${NotifyMenu} anchor=${bell.ref} onClose=${bell.close} />`}
  </header>`;
}

function NotifyMenu({ anchor, onClose }) {
  const supported = 'Notification' in window;
  const state = supported ? Notification.permission : 'unsupported';
  const ask = async () => {
    const result = await Notification.requestPermission();
    toast(result === 'granted' ? 'You’ll be notified when a reply needs you or finishes while this tab is in the background.' : 'Notifications stay off. You can allow them in your browser’s site settings.');
  };
  return html`<${Menu} anchor=${anchor} onClose=${onClose} label="Notifications" width=${300} align="end">
    <div style="padding: 10px 10px 6px; font-size: 13px">
      <div style="font-weight: 600; margin-bottom: 2px">Notifications</div>
      <div style="color: var(--tx-3)">${state === 'granted' ? 'On. This browser tells you when a reply needs you or finishes in the background.'
        : state === 'denied' ? 'Blocked in this browser. Allow them in the site settings to turn them on.'
        : state === 'unsupported' ? 'This browser can’t show notifications.' : 'Get told when a reply needs your answer or finishes while you’re in another tab.'}</div>
    </div>
    <div style="display: flex; gap: 6px; padding: 4px 6px 6px">
      ${state === 'default' && html`<button class="btn btn-p btn-sm" data-close="1" onClick=${ask}>Turn on notifications</button>`}
      <button class="btn btn-g btn-sm" data-close="1" onClick=${() => navigate('#/settings/notifications')}>Settings</button>
    </div>
  <//>`;
}

function Inspector({ chat, live, tab }) {
  const isAgent = chat.kind === 'agent';
  const tabs = isAgent ? [['context', 'Context'], ['files', 'Files'], ['permissions', 'Permissions'], ['trace', 'Trace']] : [['context', 'Context'], ['files', 'Files'], ['controls', 'Controls']];
  const current = tabs.some(([id]) => id === tab) ? tab : 'context';
  const close = () => store.set({ inspector: null });
  return html`<aside class="inspector" aria-label="Context panel">
    <div class="insp-head">
      <div class="seg" role="tablist">${tabs.map(([id, label]) => html`<button key=${id} role="tab" aria-selected=${id === current}
        class=${id === current ? 'on' : ''} onClick=${() => store.set({ inspector: id })}>${label}</button>`)}</div>
      <span style="flex: 1"></span>
      <button class="ib" aria-label="Close panel" onClick=${close}><${Icon} name="close" /></button>
    </div>
    <div class="insp-body">
      ${current === 'context' && (isAgent ? html`<${AgentContext} chat=${chat} live=${live} />` : html`<${ModelContext} chat=${chat} />`)}
      ${current === 'controls' && html`<${Controls} chat=${chat} />`}
      ${current === 'files' && html`<${ChatFiles} chat=${chat} live=${live} />`}
      ${current === 'permissions' && html`<${Permissions} chat=${chat} live=${live} />`}
      ${current === 'trace' && html`<${Trace} chat=${chat} live=${live} />`}
    </div>
  </aside>`;
}

const estimate = (text) => Math.ceil((text || '').length / 4);
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function ModelContext({ chat }) {
  const { config, projects } = useStore((s) => ({ config: s.config, projects: s.projects }));
  const info = describeTarget(chatTarget(chat), config);
  const messages = (chat.messages || []).filter((m) => m.role !== 'note');
  const history = messages.reduce((n, m) => n + estimate(m.content), 0);
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.meta?.usage);
  const prompt = last?.meta.usage.prompt_tokens;
  const sent = prompt || history;
  const project = projects.find((p) => p.id === chat.project_id);
  const instructions = config?.system_prompt || chat.config?.instructions || project?.instructions;
  const files = messages.flatMap((m) => m.meta?.files || []);
  return html`
    <div>
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px"><span style="font-size: 13px; font-weight: 500">Context sent</span>
        <span style="font-size: 12.5px; color: var(--tx-3)"><span style="color: var(--tx)">${k(prompt || history)}</span> tokens${prompt ? '' : ' (estimate)'}</span></div>
      <div class="ctx-bar">
        ${instructions && html`<div style="width: 6%; background: var(--ac)"></div>`}
        ${files.length > 0 && html`<div style="width: 10%; background: var(--warn)"></div>`}
        <div style="flex: 1; background: #3a8ee6"></div>
      </div>
      <div class="ctx-legend">
        ${instructions && html`<span><span style="background: var(--ac)"></span>Instructions</span>`}
        ${files.length > 0 && html`<span><span style="background: var(--warn)"></span>Files</span>`}
        <span><span style="background: #3a8ee6"></span>History · ${k(sent)}</span>
      </div>
    </div>
    <div class="hr"></div>
    <div style="display: flex; flex-direction: column; gap: 4px">
      <span style="font-size: 13px; font-weight: 500; margin-bottom: 6px">Sent with each reply</span>
      ${config?.system_prompt && html`<div class="ctx-item"><${Icon} name="library" style="color: var(--ac-tx)" /><span>Server instructions</span><span class="n">from .env</span></div>`}
      ${project?.instructions && html`<div class="ctx-item"><${Icon} name="layers" style="color: var(--ac-tx)" /><span>${project.name} instructions</span><span class="n">project</span></div>`}
      ${chat.config?.instructions && html`<div class="ctx-item"><${Icon} name="pencil" style="color: var(--ac-tx)" /><span>This chat’s instructions</span><span class="n">controls</span></div>`}
      ${files.length > 0 && html`<div class="ctx-item"><${Icon} name="attach" style="color: var(--warn)" /><span>${files.length} attached file${files.length === 1 ? '' : 's'}</span><span class="n">${size(files.reduce((n, f) => n + f.size, 0))}</span></div>`}
      <div class="ctx-item"><${Icon} name="chat" style="color: #3a8ee6" /><span>${messages.length} message${messages.length === 1 ? '' : 's'} in this chat</span><span class="n">≈ ${k(history)}</span></div>
    </div>
    <div class="hr"></div>
    <div class="kv-list">
      <div><span>Model</span><span>${info?.name || chat.target}</span></div>
      <div><span>Provider</span><span>${info?.provider || chat.target.split('/')[0]}</span></div>
      ${chat.config?.temperature != null && html`<div><span>Temperature</span><span>${chat.config.temperature}</span></div>`}
      ${chat.config?.max_tokens && html`<div><span>Max reply</span><span>${chat.config.max_tokens} tokens</span></div>`}
      ${last && html`<div><span>Last reply</span><span>${[last.meta.usage.completion_tokens != null && `${last.meta.usage.completion_tokens} tokens`, last.meta.seconds != null && secs(last.meta.seconds)].filter(Boolean).join(' · ')}</span></div>`}
    </div>`;
}

// Chat controls (ChatPanels board): instructions, temperature and maximum reply length, saved on the chat.
function Controls({ chat }) {
  const saved = chat.config || {};
  const [instructions, setInstructions] = useState(saved.instructions || '');
  const [temperature, setTemperature] = useState(saved.temperature ?? null);
  const [maxTokens, setMaxTokens] = useState(saved.max_tokens ?? null);
  const [state, setState] = useState('');
  const timer = useRef(null);
  const save = (patch) => {
    clearTimeout(timer.current);
    setState('Saving…');
    timer.current = setTimeout(async () => {
      const next = { instructions, temperature, max_tokens: maxTokens, ...patch };
      const body = { ...(next.instructions ? { instructions: next.instructions } : {}), ...(next.temperature != null ? { temperature: next.temperature } : {}),
        ...(next.max_tokens ? { max_tokens: next.max_tokens } : {}) };
      const done = await updateChat(chat.id, { config: body });
      setState(done ? 'Saved' : '');
    }, 400);
  };
  const LENGTHS = [null, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
  const lengthAt = Math.max(0, LENGTHS.indexOf(maxTokens));
  return html`
    <div style="display: flex; flex-direction: column; gap: 8px">
      <div style="display: flex; align-items: baseline"><label for="ctl-ins" style="font-size: 13px; font-weight: 500; flex: 1">Instructions</label><span class="meta">${state}</span></div>
      <textarea id="ctl-ins" class="inp" rows="5" style="height: auto; padding: 8px 12px; resize: vertical; line-height: 1.5" value=${instructions}
        placeholder="How this chat should answer, like “Be concise” or “Answer in Finnish”." onInput=${(e) => { setInstructions(e.target.value); save({ instructions: e.target.value }); }}></textarea>
      <span class="meta">Sent first with every reply in this chat.</span>
    </div>
    <div class="hr"></div>
    <div style="display: flex; flex-direction: column; gap: 14px">
      <div style="display: flex; align-items: center"><span style="font-size: 13px; font-weight: 500; flex: 1">Parameters</span>
        <button class="btn btn-g btn-sm" onClick=${() => { setTemperature(null); setMaxTokens(null); save({ temperature: null, max_tokens: null }); }}>Reset all</button></div>
      <label class="range"><span>Temperature<span class="mono">${temperature == null ? 'Model default' : temperature.toFixed(1)}</span></span>
        <input type="range" min="0" max="2" step="0.1" value=${temperature ?? 0.7} onInput=${(e) => { const v = +e.target.value; setTemperature(v); save({ temperature: v }); }} /></label>
      <label class="range"><span>Max reply length<span class="mono">${maxTokens ? `${maxTokens.toLocaleString()} tokens` : 'Auto'}</span></span>
        <input type="range" min="0" max=${LENGTHS.length - 1} step="1" value=${lengthAt} onInput=${(e) => { const v = LENGTHS[+e.target.value]; setMaxTokens(v); save({ max_tokens: v }); }} /></label>
      <p style="margin: 0; font-size: 12.5px; color: var(--tx-3)">Lower temperature is more predictable. Leave the length on Auto unless replies get cut off.</p>
    </div>`;
}

// Every file in this chat: what you attached, what the agent sent, and what it changed in its folder.
function ChatFiles({ chat, live }) {
  const messages = chat.messages || [];
  const attached = messages.filter((m) => m.role === 'user').flatMap((m) => m.meta?.files || []);
  const parts = [...messages.filter((m) => m.role === 'assistant').flatMap((m) => m.parts || []), ...(live?.parts || [])];
  const sent = parts.filter((p) => p.type === 'file');
  const changed = [...new Set(parts.filter((p) => p.type === 'outputs').flatMap((p) => p.paths))];
  const Row = ({ name, href, download, mime, meta }) => html`<div class="pr">
    ${isImage(mime) ? html`<img src=${href} alt="" style="width: 28px; height: 28px; object-fit: cover; border-radius: 6px" />` : html`<${Icon} name="file" style="color: var(--tx-3)" />`}
    <a href=${href} target="_blank" rel="noopener" style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx); text-decoration: none" title=${name}>${name}</a>
    ${meta && html`<span class="meta">${meta}</span>`}
    <a class="ib" href=${download} download=${name} aria-label=${`Download ${name}`}><${Icon} name="download" size=${14} /></a></div>`;
  return html`
    <div style="font-size: 13px; color: var(--tx-3)">What you attached, and what ${chat.kind === 'agent' ? 'the agent sent or changed' : 'came back'} in this chat.</div>
    ${!attached.length && !sent.length && !changed.length && html`<div class="pr" style="border-top: 0; color: var(--tx-3)">No files yet. Attach some with + or drop them on the message box.</div>`}
    ${attached.length > 0 && html`<div><div class="cap">You attached</div>${attached.map((f) => html`<${Row} key=${f.id} name=${f.name} mime=${f.mime} meta=${size(f.size)} href=${fileUrl(f.id)} download=${fileUrl(f.id, true)} />`)}</div>`}
    ${sent.length > 0 && html`<div><div class="cap">Sent back</div>${sent.map((f) => html`<${Row} key=${f.id} name=${f.name} mime=${f.mime} meta=${f.size != null ? size(f.size) : ''}
      href=${f.path ? localUrl(chat, f.path) : f.url || fileUrl(f.id)} download=${f.path ? localUrl(chat, f.path, true) : f.url || fileUrl(f.id, true)} />`)}</div>`}
    ${changed.length > 0 && html`<div><div class="cap">Changed in ${basename(chat.cwd)}</div>${changed.map((p) => html`<${Row} key=${p} name=${p.startsWith(`${chat.cwd}/`) ? p.slice(chat.cwd.length + 1) : p}
      mime=${/\.(png|jpe?g|gif|webp|svg)$/i.test(p) ? 'image/png' : ''} href=${localUrl(chat, p)} download=${localUrl(chat, p, true)} />`)}</div>`}`;
}

function AgentContext({ chat, live }) {
  const config = useStore((s) => s.config);
  const info = describeTarget(chatTarget(chat), config);
  const modes = live?.modes || chat.agent?.modes;
  const mode = modes?.available.find((m) => m.id === modes.current);
  const options = live?.config || chat.agent?.config || [];
  const commands = live?.commands || chat.agent?.commands || [];
  return html`<div class="kv-list">
      <div><span>Agent</span><span>${info?.name || chat.target}</span></div>
      <div><span>Command</span><span class="mono">${info?.agent?.command || '—'}</span></div>
      <div><span>Folder</span><span class="mono" title=${chat.cwd}>${chat.cwd}</span></div>
      ${options.filter((o) => o.category !== 'mode').map((o) => html`<div key=${o.id}><span>${o.name}</span><span>${o.type === 'boolean' ? (o.currentValue ? 'On' : 'Off') : (o.options || []).flatMap((x) => x.options || [x]).find((c) => c.value === o.currentValue)?.name || o.currentValue}</span></div>`)}
      <div><span>Mode</span><span>${mode?.name || 'The agent’s default'}</span></div>
      <div><span>Status</span><span>${live?.waiting ? 'Waiting for you' : live?.running ? 'Working' : chat.agent?.connected ? 'Connected' : 'Starts when you send'}</span></div>
      <div><span>Session</span><span class="mono">${chat.session_id || 'not started'}</span></div>
    </div>
    ${commands.length > 0 && html`<div class="hr"></div><div><div class="cap" style="margin-bottom: 6px">Commands · type / in the message box</div>
      ${commands.map((c) => html`<div key=${c.name} class="pr"><span class="mono" style="color: var(--ac-tx)">/${c.name}</span><span style="flex: 1; color: var(--tx-3); font-size: 12.5px">${c.description}</span></div>`)}</div>`}
    <div class="hr"></div>
    <p style="margin: 0; font-size: 12.5px; color: var(--tx-3)">The agent runs on this server with its own sign-in, tools and memory. It can read and write files only inside this folder, and asks before it acts.</p>`;
}

function allParts(chat, live) {
  const saved = (chat.messages || []).filter((m) => m.role === 'assistant').flatMap((m) => m.parts || []);
  return live?.parts ? [...saved, ...live.parts] : saved;
}

function Permissions({ chat, live }) {
  const parts = allParts(chat, live).filter((p) => p.type === 'permission');
  const waiting = parts.filter((p) => p.state === 'waiting');
  const answered = parts.filter((p) => p.state !== 'waiting').reverse();
  return html`
    <div style="font-size: 13px; color: var(--tx-3)">What the agent asked to do in this chat, and what you said. The agent keeps its own “always allow” choices.</div>
    ${waiting.length > 0 && html`<div style="font-size: 12px; font-weight: 500; color: var(--tx-3)">Waiting for approval</div>
      <div class="card" style="padding: 12px; display: flex; flex-direction: column; gap: 8px">
        ${waiting.map((p, i) => html`<div style="display: flex; align-items: center; gap: 8px; font-size: 13px"><${Icon} name=${p.kind === 'execute' ? 'terminal' : 'shield'} style="color: var(--warn)" />
          <span class="mono" style="font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${p.input || p.title}</span>${i > 0 && html`<span style="font-size: 11.5px; color: var(--tx-3)">next</span>`}</div>`)}
      </div>`}
    <div>
      ${answered.length === 0 && html`<div class="pr" style="border-top: 0; color: var(--tx-3)">Nothing asked yet.</div>`}
      ${answered.map((p, i) => html`<div class="pr" key=${p.id} style=${i === 0 ? 'border-top: 0' : ''}>
        <${Icon} name=${p.kind === 'execute' ? 'terminal' : p.kind === 'edit' ? 'edit' : 'shield'} style="color: var(--tx-3)" />
        <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap" title=${p.input}>${p.title}</span>
        <span class=${cx('pill', p.answer_kind?.startsWith('allow') ? 'ok' : p.state === 'answered' ? 'bad' : '')}>${p.answer_name || (p.state === 'expired' ? 'No answer' : 'Cancelled')}</span>
      </div>`)}
    </div>`;
}

function Trace({ chat, live }) {
  const tools = allParts(chat, live).filter((p) => p.type === 'tool').reverse();
  return html`
    <div style="font-size: 13px; color: var(--tx-3)">Every tool call the agent reported, newest first.</div>
    <div>
      ${tools.length === 0 && html`<div class="pr" style="border-top: 0; color: var(--tx-3)">No tool calls yet.</div>`}
      ${tools.map((p, i) => html`<div class="pr" key=${p.id + i} style=${i === 0 ? 'border-top: 0' : ''}>
        <span class=${cx('st', p.status === 'completed' ? 'ok' : p.status === 'failed' ? 'err' : p.status === 'in_progress' ? 'run' : 'wait')}>${p.status === 'completed' ? html`<${Icon} name="check" />` : p.status === 'failed' ? html`<${Icon} name="close" />` : ''}</span>
        <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${p.title}</span>
        ${p.kind && html`<span class="tn">${p.kind}</span>`}<span class="meta">${p.seconds != null ? secs(p.seconds) : ''}</span>
      </div>`)}
    </div>`;
}
