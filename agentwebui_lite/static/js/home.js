// New chat home (Home board): greeting, the big composer, starters and recent chats. A temporary chat starts here too.
import { html, useState, useEffect, store, useStore, greeting, ago, navigate, basename, cx, local } from './lib.js';
import { Icon } from './icons.js';
import { Logo, targetLogo } from './logos.js';
import { Composer, startingConfig } from './composer.js';
import { defaultTarget, describeTarget, openPalette } from './actions.js';

const STARTERS = [
  ['pencil', 'Write', 'Help me write '],
  ['workspace', 'Code', 'Help me with this code: '],
  ['file-text', 'Analyze a file', null],
  ['sparkle', 'Brainstorm', 'Brainstorm ideas for '],
  ['list', 'Make a plan', 'Make a step-by-step plan for '],
];

export function Home() {
  const { config, chats, draftTarget, draftTemporary, draftProject, draftCwd, projects } = useStore((s) => ({ config: s.config, chats: s.chats,
    draftTarget: s.draftTarget, draftTemporary: s.draftTemporary, draftProject: s.draftProject, draftCwd: s.draftCwd, projects: s.projects }));
  const [target, setTarget] = useState(() => draftTarget || defaultTarget());
  const info = describeTarget(target, config);
  const [cwd, setCwd] = useState(draftCwd || info?.agent?.cwd || config?.workspace || '');
  const [agentConfig, setAgentConfig] = useState(() => (info?.agent ? startingConfig(info.agent.id) : null));
  const [project, setProject] = useState(draftProject || null);
  const temporary = !!draftTemporary;
  const chosen = projects.find((p) => p.id === project);
  useEffect(() => { if (draftTarget) setTarget(draftTarget); }, [draftTarget]);
  useEffect(() => { if (draftProject !== undefined) setProject(draftProject); }, [draftProject]);
  useEffect(() => {
    if (!info?.agent) return;
    setCwd(store.get().draftCwd || chosen?.folder || info.agent.cwd);
    setAgentConfig(startingConfig(info.agent.id));
    store.set({ draftCwd: null });
  }, [target]);
  useEffect(() => { if (!target && config) setTarget(defaultTarget()); }, [config]);
  // A project brings its folder and its default agent or model.
  const pickProject = (id) => {
    setProject(id);
    store.set({ draftProject: id });
    const p = projects.find((x) => x.id === id);
    if (p?.target && describeTarget(p.target, config) && !describeTarget(p.target, config).missing) setTarget(p.target);
    if (p?.folder) setCwd(p.folder);
  };
  const setDraft = (next) => { setAgentConfig(next); if (info?.agent) local.set(`agentConfig:${info.agent.id}`, next); };
  const nothing = config && config.models.length === 0 && config.agents.length === 0;
  const name = config?.user_name;
  const brand = config?.brand || {};
  const recent = chats.filter((c) => !c.archived).slice(0, 3);
  const starter = ([, , text]) => (text
    ? () => window.dispatchEvent(new CustomEvent('awl:prefill', { detail: text }))
    : () => window.dispatchEvent(new Event('awl:upload')));
  return html`<div class=${cx('home', temporary && 'temporary')}>
    <header class="home-header">
      <button class="ib phone-only" aria-label="Open menu" onClick=${() => store.set({ drawer: true })}><${Icon} name="menu" /></button>
      <span style="flex: 1"></span>
      <button class=${cx('btn', temporary ? 'btn-p' : 'btn-g')} aria-pressed=${temporary} onClick=${() => store.set({ draftTemporary: !temporary })}
        title=${temporary ? 'Turn off temporary chat' : 'Start a chat that isn’t saved'}><${Icon} name="temporary" size=${15} />Temporary chat</button>
      <button class="ib" aria-label="Notifications" onClick=${() => navigate('#/settings/notifications')}><${Icon} name="notification" /></button>
    </header>
    <div class="home-scroll">
      <div class="home-inner">
        <div class="hero">
          ${temporary
            ? html`<span class="ico" style="width: 40px; height: 40px; border-radius: 12px"><${Icon} name="temporary" size=${20} /></span>
              <h1>Temporary chat</h1><p>Not saved, not in your history, and gone when you leave it. Agents still change files they’re allowed to.</p>`
            : html`<img src=${brand.logo || '/brand/logo'} alt="" width="40" height="40" style="border-radius: 12px" />
              <h1>${brand.greeting || `${greeting()}${name ? `, ${name}` : ''}`}</h1>
              <p>${nothing ? 'Connect a model or an agent in .env to start.' : 'Ask anything, or hand a task to an agent.'}</p>`}
        </div>
        ${nothing ? html`<${NoModels} />` : html`
          <${Composer} big target=${target} onTarget=${(t) => { setTarget(t); store.set({ draftTarget: t }); }} cwd=${cwd} onCwd=${setCwd}
            agentConfig=${agentConfig} onAgentConfig=${setDraft} project=${project} onProject=${pickProject} temporary=${temporary} />
          <div class="starters">${STARTERS.map((s) => html`<button class="chip big" key=${s[1]} onClick=${starter(s)}><${Icon} name=${s[0]} size=${15} />${s[1]}</button>`)}</div>`}
        ${recent.length > 0 && !temporary && html`<div class="recent">
          <div class="recent-head"><span>Jump back in</span><a href="#" onClick=${(e) => { e.preventDefault(); openPalette(); }}>All chats</a></div>
          <div class="tiles">${recent.map((chat) => html`<a class="tile" key=${chat.id} href=${`#/c/${chat.id}`}>
            <span class="tile-kind"><${Logo} name=${targetLogo(`${chat.kind}:${chat.target}`, config)} size=${14} icon=${chat.kind === 'agent' ? 'agent' : 'chat'} />
              ${chat.kind === 'agent' ? `${describeTarget(`agent:${chat.target}`, config)?.name || 'Agent'} · ${basename(chat.cwd)}` : describeTarget(`model:${chat.target}`, config)?.name || 'Chat'}</span>
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
