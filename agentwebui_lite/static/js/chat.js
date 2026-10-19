// The conversation screen (Main and Agent chat boards) with its context panel.
import { html, useEffect, useRef, useState, useLayoutEffect, store, useStore, cx, notInLite, basename, secs, navigate, toast } from './lib.js';
import { Icon } from './icons.js';
import { Menu, MenuItem, MenuSep, confirm, useToggle } from './ui.js';
import { UserMessage, Reply } from './messages.js';
import { Composer } from './composer.js';
import { chatTarget, describeTarget, toggleInspector, deleteChat, switchModel, newChat, openPicker } from './actions.js';
import { SystemState } from './states.js';

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
    if (wasRunning.current && !live?.running) setAnnounce(live?.error ? 'The reply failed.' : 'Reply finished.');
    if (live?.waiting) setAnnounce('Waiting for your answer.');
    wasRunning.current = !!live?.running;
  }, [live?.running, live?.waiting]);
  if (!chat) return null;
  if (chat.missing) return html`<${SystemState} kind="missing" />`;
  if (chat.error) return html`<${SystemState} kind="error" detail=${chat.error} />`;
  const onScroll = (e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
  const messages = chat.messages || [];
  const showLive = live && (live.running || live.error) && live.parts;
  return html`<div class="chat-screen">
    <${ChatHeader} chat=${chat} live=${live} />
    <div class="chat-body">
      <div class="chat-main">
        <div class="messages" ref=${scroller} onScroll=${onScroll} aria-busy=${!!live?.running}>
          <div class="column">
            ${chat.loading && html`<div class="skeleton"><span></span><span></span><span style="width: 40%"></span></div>`}
            ${messages.map((m, i) => (m.role === 'user'
              ? html`<${UserMessage} key=${m.id} message=${m} />`
              : html`<${Reply} key=${m.id} chat=${chat} message=${m} last=${!showLive && i === messages.length - 1} />`))}
            ${showLive && html`<${Reply} key="live" chat=${chat} live=${live} last=${true} />`}
          </div>
        </div>
        <div class="composer-wrap">
          <div class="column">
            <${Composer} key=${chat.id} chat=${chat} target=${chatTarget(chat)} live=${live}
              onTarget=${(t) => switchModel(chat.id, t)} />
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
  const { inspector, config } = useStore((s) => ({ inspector: s.inspector, config: s.config }));
  const titleMenu = useToggle();
  const more = useToggle();
  const bell = useToggle();
  const isAgent = chat.kind === 'agent';
  const info = describeTarget(chatTarget(chat), config);
  const remove = () => confirm({ title: 'Delete this chat?', danger: true, action: 'Delete chat',
    body: `“${chat.title || 'New chat'}” and its messages are removed for good.`, onConfirm: () => deleteChat(chat.id) });
  const rename = () => store.set({ overlay: { type: 'rename', id: chat.id, title: chat.title || '' } });
  const titleItems = html`
    <${MenuItem} icon="edit" onClick=${rename}>Rename<//>
    <${MenuItem} icon="pin" onClick=${notInLite('Pinning')}>Pin<//>
    <${MenuItem} icon="share" onClick=${notInLite('Sharing')}>Share…<//>
    <${MenuItem} icon="archive" onClick=${notInLite('Archiving')}>Archive<//>
    <${MenuSep} />
    <${MenuItem} icon="delete" danger onClick=${remove}>Delete…<//>`;
  return html`<header class="chat-header">
    <button class="ib phone-only" aria-label="Open menu" onClick=${() => store.set({ drawer: true })}><${Icon} name="menu" /></button>
    <div class="crumbs">
      ${isAgent
        ? html`<span class="crumb-root" title=${chat.cwd}>${basename(chat.cwd)}</span>`
        : html`<a class="crumb-root" href="#/" onClick=${(e) => { e.preventDefault(); newChat(); }}><span class="crumb-dot"></span>AgentWebUI</a>`}
      <span class="crumb-sep">/</span>
      <button class="crumb-title" ref=${titleMenu.ref} aria-haspopup="menu" aria-expanded=${titleMenu.open} onClick=${titleMenu.toggle}>
        <span>${chat.title || 'New chat'}</span><${Icon} name="chevron-down" size=${14} style="color: var(--tx-3)" />
      </button>
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
      <button class="ib hide-sm" ref=${bell.ref} aria-label="Notifications" title="Notifications" onClick=${bell.toggle}><${Icon} name="notification" /></button>
      <span class="hsep hide-sm"></span>
      <button class="btn hide-sm" onClick=${notInLite('Sharing')}><${Icon} name="share" size=${15} />Share</button>
      <button class="ib hide-sm" aria-label="More actions" ref=${more.ref} aria-haspopup="menu" onClick=${more.toggle}><${Icon} name="more" /></button>
      <button class="ib phone-only" aria-label="New chat" onClick=${() => newChat()}><${Icon} name="new-chat" /></button>
    </div>
    ${titleMenu.open && html`<${Menu} anchor=${titleMenu.ref} onClose=${titleMenu.close} label="Chat" width=${200}>${titleItems}<//>`}
    ${more.open && html`<${Menu} anchor=${more.ref} onClose=${more.close} label="More actions" width=${220} align="end">
      <${MenuItem} icon="gauge" onClick=${() => toggleInspector('context')}>Context panel<//>
      <${MenuItem} icon="export" onClick=${notInLite('Exporting chats')}>Export…<//>
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
    ${state === 'default' && html`<div style="padding: 4px 6px 6px"><button class="btn btn-p btn-sm" data-close="1" onClick=${ask}>Turn on notifications</button></div>`}
  <//>`;
}

function Inspector({ chat, live, tab }) {
  const isAgent = chat.kind === 'agent';
  const tabs = isAgent ? [['context', 'Context'], ['permissions', 'Permissions'], ['trace', 'Trace']] : [['context', 'Context'], ['controls', 'Controls']];
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
      ${current === 'controls' && html`<${Controls} />`}
      ${current === 'permissions' && html`<${Permissions} chat=${chat} live=${live} />`}
      ${current === 'trace' && html`<${Trace} chat=${chat} live=${live} />`}
    </div>
  </aside>`;
}

const estimate = (text) => Math.ceil((text || '').length / 4);
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function ModelContext({ chat }) {
  const config = useStore((s) => s.config);
  const info = describeTarget(chatTarget(chat), config);
  const messages = chat.messages || [];
  const history = messages.reduce((n, m) => n + estimate(m.content), 0);
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.meta?.usage);
  const prompt = last?.meta.usage.prompt_tokens;
  const sent = prompt || history;
  return html`
    <div>
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px"><span style="font-size: 13px; font-weight: 500">Context sent</span>
        <span style="font-size: 12.5px; color: var(--tx-3)"><span style="color: var(--tx)">${k(prompt || history)}</span> tokens${prompt ? '' : ' (estimate)'}</span></div>
      <div class="ctx-bar">
        ${config?.system_prompt && html`<div style="width: 6%; background: var(--ac)"></div>`}
        <div style="flex: 1; background: #3a8ee6"></div>
      </div>
      <div class="ctx-legend">
        ${config?.system_prompt && html`<span><span style="background: var(--ac)"></span>Instructions</span>`}
        <span><span style="background: #3a8ee6"></span>History${config?.system_prompt ? ' and instructions' : ''} · ${k(sent)}</span>
      </div>
    </div>
    <div class="hr"></div>
    <div style="display: flex; flex-direction: column; gap: 4px">
      <span style="font-size: 13px; font-weight: 500; margin-bottom: 6px">Sent with each reply</span>
      ${config?.system_prompt && html`<div class="ctx-item"><${Icon} name="library" style="color: var(--ac-tx)" /><span>Server instructions</span><span class="n">from .env</span></div>`}
      <div class="ctx-item"><${Icon} name="chat" style="color: #3a8ee6" /><span>${messages.length} message${messages.length === 1 ? '' : 's'} in this chat</span><span class="n">≈ ${k(history)}</span></div>
    </div>
    <div class="hr"></div>
    <div class="kv-list">
      <div><span>Model</span><span>${info?.name || chat.target}</span></div>
      <div><span>Provider</span><span>${info?.provider || chat.target.split('/')[0]}</span></div>
      ${last && html`<div><span>Last reply</span><span>${[last.meta.usage.completion_tokens != null && `${last.meta.usage.completion_tokens} tokens`, last.meta.seconds != null && secs(last.meta.seconds)].filter(Boolean).join(' · ')}</span></div>`}
    </div>`;
}

function Controls() {
  return html`
    <div style="display: flex; flex-direction: column; gap: 14px">
      <span style="font-size: 13px; font-weight: 500">Parameters</span>
      <label class="range"><span>Temperature<span class="mono">Provider default</span></span>
        <input type="range" min="0" max="2" step="0.1" value="0.7" onInput=${notInLite('Changing parameters')} /></label>
      <label class="range"><span>Max reply length<span class="mono">Auto</span></span>
        <input type="range" min="0" max="100" value="100" onInput=${notInLite('Changing parameters')} /></label>
      <p style="margin: 0; font-size: 12.5px; color: var(--tx-3)">Lite sends each request with the provider’s defaults. Server instructions come from SYSTEM_PROMPT in .env.</p>
    </div>`;
}

function AgentContext({ chat, live }) {
  const config = useStore((s) => s.config);
  const info = describeTarget(chatTarget(chat), config);
  const modes = live?.modes || chat.agent?.modes;
  const mode = modes?.available.find((m) => m.id === modes.current);
  return html`<div class="kv-list">
      <div><span>Agent</span><span>${info?.name || chat.target}</span></div>
      <div><span>Command</span><span class="mono">${info?.agent?.command || '—'}</span></div>
      <div><span>Folder</span><span class="mono" title=${chat.cwd}>${chat.cwd}</span></div>
      <div><span>Mode</span><span>${mode?.name || 'The agent’s default'}</span></div>
      <div><span>Status</span><span>${live?.waiting ? 'Waiting for you' : live?.running ? 'Working' : chat.agent?.connected ? 'Connected' : 'Starts when you send'}</span></div>
      <div><span>Session</span><span class="mono">${chat.session_id || 'not started'}</span></div>
    </div>
    <div class="hr"></div>
    <p style="margin: 0; font-size: 12.5px; color: var(--tx-3)">The agent runs on this computer as you, with its own sign-in, tools and memory. It can read and write files only inside this folder through AgentWebUI, and asks before it acts.</p>`;
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
