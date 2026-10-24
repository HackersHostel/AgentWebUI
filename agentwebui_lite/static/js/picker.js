// Model picker (Model picker board): models from every provider in .env and the external agents, searchable.
import { html, useState, useMemo, useRef, useEffect, store, useStore, local, navigate, providerGradient, AGENT_GRADIENT, basename } from './lib.js';
import { Icon } from './icons.js';
import { Logo, agentLogo, modelLogo, providerLogo } from './logos.js';
import { Dialog } from './ui.js';
import { newChat } from './actions.js';

const DOT = ['#3a8ee6', '#3dd68c', '#b3a4ff', '#ffb38a', '#5fd4c4', '#f783ac'];

function entries(config, hidden = {}) {
  const providers = new Map(config.providers.map((p, i) => [p.id, { ...p, color: p.local ? '#a1a1aa' : DOT[i % DOT.length] }]));
  const items = config.models.filter((m) => !hidden[`model:${m.id}`]).map((m) => ({
    value: `model:${m.id}`, name: m.model, raw: m.model, group: m.provider, local: m.local, kind: 'model',
    badge: m.local ? 'Local' : '', logo: providerGradient(m.provider, m.local), mark: modelLogo(m.model) || providerLogo(providers.get(m.provider)),
    desc: m.local ? `Runs on ${providers.get(m.provider)?.host || 'this machine'}. Nothing leaves your network.` : `Served by ${providers.get(m.provider)?.name || m.provider} through your key.`,
  }));
  for (const a of config.agents) {
    const models = !config.lock_model && a.options && a.options.filter((o) => o.category === 'model').flatMap((o) => (o.options || []).flatMap((x) => x.options || [x]));
    items.push({ value: `agent:${a.id}`, name: a.name, raw: a.command, group: '__agents', local: true, kind: 'agent',
      badge: 'Agent', logo: AGENT_GRADIENT, mark: agentLogo(a), cwd: a.cwd, models,
      desc: `An external agent. It works in a folder on this computer (${basename(a.cwd)} by default) and asks before changing files.` });
  }
  // The connected agents come first, above every provider's models.
  const groups = [{ id: '__agents', name: 'Connected Agents', sub: 'In a folder', color: '#f5b94a', where: 'Your computer' },
    ...[...providers.values()].map((p) => ({ id: p.id, name: p.name, sub: `OpenAI-compatible · ${p.host}`, color: p.color, where: p.local ? 'This network' : `${p.name}, through your key` }))];
  return { items, groups };
}

export function ModelPicker({ value, onPick, chat, tab: initialTab, onClose }) {
  const config = useStore((s) => s.config);
  const hidden = useStore((s) => s.chatPrefs?.hiddenModels || {});
  const [q, setQ] = useState('');
  const [tab, setTab] = useState(initialTab || 'all');
  const [favs, setFavs] = useState(() => local.get('favorites', {}));
  const { items, groups } = useMemo(() => entries(config, hidden), [config, hidden]);
  const lockKind = chat ? chat.kind : null;
  const needle = q.trim().toLowerCase();
  const visible = items.filter((m) => {
    if (lockKind && m.kind !== lockKind) return false;
    if (tab === 'fav' && !favs[m.value]) return false;
    if (tab === 'local' && !m.local) return false;
    if (tab === 'agents' && m.kind !== 'agent') return false;
    if (!needle) return true;
    const g = groups.find((x) => x.id === m.group);
    return `${m.name} ${m.raw} ${g?.name} ${m.badge}`.toLowerCase().includes(needle);
  });
  const shown = groups.map((g) => ({ ...g, items: visible.filter((m) => m.group === g.id) })).filter((g) => g.items.length);
  const flat = shown.flatMap((g) => g.items);
  const [hot, setHot] = useState(value);
  const hotItem = flat.find((m) => m.value === hot) || flat[0];
  const list = useRef(null);
  useEffect(() => { list.current?.querySelector('[data-hot="1"]')?.scrollIntoView({ block: 'nearest' }); }, [hotItem?.value]);

  const use = (item, asDefault) => {
    if (!item) return;
    if (asDefault) local.set('defaultTarget', item.value);
    onClose();
    if (onPick) onPick(item.value);
    else newChat(item.value);
  };
  const toggleFav = (item) => { const next = { ...favs, [item.value]: !favs[item.value] }; setFavs(next); local.set('favorites', next); };
  const onKey = (e) => {
    const i = flat.indexOf(hotItem);
    if (e.key === 'ArrowDown') { e.preventDefault(); setHot(flat[Math.min(i + 1, flat.length - 1)]?.value); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHot(flat[Math.max(i - 1, 0)]?.value); }
    if (e.key === 'Enter') { e.preventDefault(); use(hotItem, e.metaKey || e.ctrlKey); }
  };
  const tabs = [['all', 'All'], ['agents', 'Connected Agents'], ['local', 'On this machine'], ['fav', 'Favorites']];
  const hotGroup = groups.find((g) => g.id === hotItem?.group);
  return html`<${Dialog} onClose=${onClose} label="Choose a model" width=${720} top=${96} class="picker">
    <div class="picker-list" onKeyDown=${onKey}>
      <div class="picker-search">
        <${Icon} name="search" style="color: var(--tx-3)" />
        <label for="mq" class="sr">Search models</label>
        <input id="mq" class="bare" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Search models, providers, agents" autocomplete="off" data-autofocus />
        <span class="kbd">Esc</span>
      </div>
      <div role="tablist" class="picker-tabs">${tabs.filter(([id]) => !(lockKind === 'agent' && (id === 'local' || id === 'fav'))).map(([id, label]) => html`<button key=${id} class="tab" role="tab"
        aria-selected=${tab === id} style=${tab === id ? 'background: var(--bg-active); color: var(--tx)' : ''} onClick=${() => setTab(id)}>${label}</button>`)}</div>
      <div class="picker-rows" ref=${list} role="listbox" aria-label="Models">
        ${shown.map((g) => html`<div key=${g.id}>
          <div class="picker-group"><span style=${`width: 6px; height: 6px; border-radius: 50%; background: ${g.color}`}></span>${g.name}<span class="gsub">${g.sub}</span></div>
          ${g.items.map((m) => html`<button key=${m.value} class="row" role="option" aria-selected=${m.value === value} data-hot=${m.value === hotItem?.value ? '1' : '0'}
            style=${m.value === hotItem?.value ? 'background: var(--bg-active)' : ''} onClick=${() => use(m)} onMouseEnter=${() => setHot(m.value)}>
            <${Logo} name=${m.mark} tile size=${22} radius=${6} fallback=${m.logo} />
            <span class="row-name"><span>${m.name}</span>${m.badge && html`<span class="badge">${m.badge}</span>`}${favs[m.value] && html`<${Icon} name="star" size=${12} style="fill: var(--warn); color: var(--warn)" />`}</span>
            <span class="row-check">${m.value === value && html`<${Icon} name="check" />`}</span>
          </button>`)}
        </div>`)}
        ${flat.length === 0 && html`<div class="picker-empty">${needle ? html`No model matches “${q}”.` : tab === 'fav' ? 'No favorites yet. Star a model to keep it here.' : 'Nothing here yet.'}<br />
          <a href="#/settings/providers" onClick=${(e) => { e.preventDefault(); onClose(); navigate('#/settings/providers'); }} style="color: var(--ac-tx)">Connect another provider</a></div>`}
      </div>
      <div class="picker-foot">
        <span><span class="kbd">↑↓</span>Move</span><span><span class="kbd">↵</span>Use</span><span class="hide-sm"><span class="kbd">⌘↵</span>Use for new chats</span>
        <a href="#/settings/providers" onClick=${(e) => { e.preventDefault(); onClose(); navigate('#/settings/providers'); }}><${Icon} name="settings" size=${14} />Manage models</a>
      </div>
    </div>
    ${hotItem && html`<div class="picker-detail">
      <div style="display: flex; flex-direction: column; gap: 10px">
        <${Logo} name=${hotItem.mark} tile size=${40} radius=${11} fallback=${hotItem.logo} />
        <div><div style="font-size: 16px; font-weight: 600; letter-spacing: -0.01em">${hotItem.name}</div>
          <div class="mono" style="font-size: 11.5px; color: var(--tx-3); margin-top: 2px; word-break: break-all">${hotItem.raw}</div></div>
        <p style="margin: 0; font-size: 13px; line-height: 1.55; color: var(--tx-2)">${hotItem.desc}</p>
      </div>
      <div class="kv-list small">
        <div><span>Provider</span><span>${hotGroup?.name}</span></div>
        <div><span>Runs</span><span>${hotGroup?.where}</span></div>
        <div><span>Can</span><span>${hotItem.kind === 'agent' ? 'read and edit files, run commands' : 'chat, read images and files'}</span></div>
      </div>
      ${hotItem.kind === 'agent' && html`<div><div class="cap" style="margin-bottom: 6px">Models</div>
        ${hotItem.models?.length ? html`<div style="display: flex; flex-wrap: wrap; gap: 6px">${hotItem.models.map((m) => html`<span class="tn" key=${m.value} title=${m.description}>${m.name}</span>`)}</div>`
          : html`<div class="sub" style="margin: 0">${config.lock_model ? 'The server sets this agent’s model.' : hotItem.models ? 'This agent offers no model choice.' : 'Pick the model after choosing the agent: the agent bar shows its models.'}</div>`}</div>`}
      <div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px">
        <button class="btn btn-p" style="height: 36px" onClick=${() => use(hotItem)}>Use ${hotItem.name}</button>
        <button class="btn" style="height: 36px" onClick=${() => toggleFav(hotItem)}>
          <${Icon} name="star" style=${favs[hotItem.value] ? 'fill: var(--warn); color: var(--warn)' : ''} />${favs[hotItem.value] ? 'Remove from favorites' : 'Add to favorites'}</button>
      </div>
    </div>`}
  <//>`;
}
