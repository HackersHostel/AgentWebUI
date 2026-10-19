// New chat home (Home board): greeting, the big composer, starters and recent chats.
import { html, useState, useEffect, store, useStore, greeting, ago, notInLite, navigate, basename } from './lib.js';
import { Icon } from './icons.js';
import { Composer } from './composer.js';
import { defaultTarget, describeTarget, openPalette } from './actions.js';

const STARTERS = [
  ['pencil', 'Write', 'Help me write '],
  ['workspace', 'Code', 'Help me with this code: '],
  ['file-text', 'Analyze a file', null],
  ['sparkle', 'Brainstorm', 'Brainstorm ideas for '],
  ['library', 'From library', null],
];

export function Home() {
  const { config, chats, draftTarget } = useStore((s) => ({ config: s.config, chats: s.chats, draftTarget: s.draftTarget }));
  const [target, setTarget] = useState(() => draftTarget || defaultTarget());
  const info = describeTarget(target, config);
  const [cwd, setCwd] = useState(info?.agent?.cwd || config?.workspace || '');
  useEffect(() => { if (draftTarget) setTarget(draftTarget); }, [draftTarget]);
  useEffect(() => { if (info?.agent) setCwd(info.agent.cwd); }, [target]);
  useEffect(() => { if (!target && config) setTarget(defaultTarget()); }, [config]);
  const nothing = config && config.models.length === 0 && config.agents.length === 0;
  const name = config?.user_name;
  const recent = chats.slice(0, 3);
  const starter = ([, label, text]) => (text
    ? () => window.dispatchEvent(new CustomEvent('awl:prefill', { detail: text }))
    : notInLite(label === 'Analyze a file' ? 'Attaching files' : 'The prompt library'));
  return html`<div class="home">
    <header class="home-header">
      <button class="ib phone-only" aria-label="Open menu" onClick=${() => store.set({ drawer: true })}><${Icon} name="menu" /></button>
      <span style="flex: 1"></span>
      <button class="btn btn-g" onClick=${notInLite('Temporary chats')}><${Icon} name="temporary" size=${15} />Temporary chat</button>
      <button class="ib" aria-label="Notifications" onClick=${() => navigate('#/settings/notifications')}><${Icon} name="notification" /></button>
    </header>
    <div class="home-scroll">
      <div class="home-inner">
        <div class="hero">
          <img src="/assets/logo.svg" alt="" width="40" height="40" style="border-radius: 12px" />
          <h1>${greeting()}${name ? `, ${name}` : ''}</h1>
          <p>${nothing ? 'Connect a model or an agent in .env to start.' : 'Ask anything, or hand a task to an agent.'}</p>
        </div>
        ${nothing ? html`<${NoModels} />` : html`
          <${Composer} big target=${target} onTarget=${(t) => { setTarget(t); store.set({ draftTarget: t }); }} cwd=${cwd} onCwd=${setCwd} />
          <div class="starters">${STARTERS.map((s) => html`<button class="chip big" key=${s[1]} onClick=${starter(s)}><${Icon} name=${s[0]} size=${15} />${s[1]}</button>`)}</div>`}
        ${recent.length > 0 && html`<div class="recent">
          <div class="recent-head"><span>Jump back in</span><a href="#" onClick=${(e) => { e.preventDefault(); openPalette(); }}>All chats</a></div>
          <div class="tiles">${recent.map((chat) => html`<a class="tile" key=${chat.id} href=${`#/c/${chat.id}`}>
            <span class="tile-kind"><${Icon} name=${chat.kind === 'agent' ? 'agent' : 'chat'} size=${14} />
              ${chat.kind === 'agent' ? `${describeTarget(`agent:${chat.target}`, config)?.name || 'Agent'} · ${basename(chat.cwd)}` : 'Chat'}</span>
            <span class="tile-title">${chat.title || 'New chat'}</span>
            <span class="tile-sub">${chat.waiting ? 'Waiting for you' : chat.running ? 'Replying now' : ago(chat.updated_at)}</span>
          </a>`)}</div>
        </div>`}
      </div>
    </div>
  </div>`;
}

function NoModels() {
  return html`<div class="no-models">
    <span class="ico" style="width: 44px; height: 44px; border-radius: 12px"><${Icon} name="model" size=${20} /></span>
    <div><div style="font-size: 16px; font-weight: 600">No models or agents yet</div>
      <div style="font-size: 13.5px; color: var(--tx-3); max-width: 420px">Add a model provider (PROVIDER_*) or an agent (AGENT_*) to the server’s .env file, then restart it.</div></div>
    <div style="display: flex; gap: 8px"><button class="btn btn-p" onClick=${() => navigate('#/settings/providers')}>See how to connect one</button></div>
  </div>`;
}
