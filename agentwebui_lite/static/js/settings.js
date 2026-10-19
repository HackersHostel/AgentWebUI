// Settings (Settings · appearance and Settings · providers boards). Lite is configured in .env, so the provider and
// agent forms write the lines to paste there instead of saving anything.
import { html, useState, store, useStore, cx, navigate, notInLite, copyText, api, providerGradient, AGENT_GRADIENT, mod, toast } from './lib.js';
import { Icon } from './icons.js';
import { THEMES, SWATCHES, FONTS, CODES, SIZES, ACCENTS, setPrefs, customVars } from './prefs.js';
import { loadConfig } from './actions.js';

const NAV = [
  ['You', [['account', 'person', 'Account & security'], ['appearance', 'palette', 'Appearance'], ['chat', 'chat', 'Chat'],
    ['notifications', 'notification', 'Notifications'], ['keyboard', 'key', 'Keyboard'], ['voice', 'mic', 'Voice']]],
  ['Connections', [['providers', 'plug', 'Providers'], ['integrations', 'plugin', 'Integrations'], ['workspaces', 'workspace', 'Workspaces & Git']]],
  ['Administration', [['people', 'users', 'People'], ['roles', 'shield', 'Roles & access'], ['defaults', 'settings', 'Defaults']]],
];
const BUILT = new Set(['appearance', 'providers', 'notifications', 'keyboard']);

export function Settings() {
  const route = useStore((s) => s.route);
  const section = BUILT.has(route.section) ? route.section : 'appearance';
  return html`<div class="settings">
    <aside class="snav" aria-label="Settings">
      <a href="#/" class="sn back" onClick=${(e) => { e.preventDefault(); navigate('#/'); }}><${Icon} name="chevron-left" />Back to chats</a>
      <nav>${NAV.map(([group, items]) => html`<div key=${group}><div class="sg">${group}</div>
        ${items.map(([id, icon, label]) => html`<a key=${id} href=${`#/settings/${id}`} class=${cx('sn', id === section && 'on')} aria-current=${id === section ? 'page' : undefined}
          onClick=${(e) => { if (!BUILT.has(id)) { e.preventDefault(); notInLite(label)(); } }}><${Icon} name=${icon} />${label}</a>`)}</div>`)}</nav>
    </aside>
    <main class="settings-main">
      <div class="settings-phone-head phone-only"><button class="ib" aria-label="Back to chats" onClick=${() => navigate('#/')}><${Icon} name="chevron-left" /></button>
        <select class="sel" value=${section} onChange=${(e) => navigate(`#/settings/${e.target.value}`)} aria-label="Settings section">
          ${[...BUILT].map((id) => html`<option value=${id}>${NAV.flatMap(([, i]) => i).find((x) => x[0] === id)[2]}</option>`)}</select></div>
      ${section === 'appearance' && html`<${Appearance} />`}
      ${section === 'providers' && html`<${Providers} />`}
      ${section === 'notifications' && html`<${Notifications} />`}
      ${section === 'keyboard' && html`<${Keyboard} />`}
    </main>
  </div>`;
}

function Page({ title, sub, action, children }) {
  return html`<div class="settings-page">
    <div style="display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap">
      <div style="flex: 1; min-width: 240px"><h1>${title}</h1><p class="lead">${sub}</p></div>${action}
    </div>
    ${children}
  </div>`;
}

const Seg = ({ items, value, onPick, label }) => html`<div class="seg" role="radiogroup" aria-label=${label}>
  ${items.map(([id, text]) => html`<button key=${id} role="radio" aria-checked=${value === id} class=${value === id ? 'on' : ''} onClick=${() => onPick(id)}>${text}</button>`)}</div>`;

function Appearance() {
  const p = useStore((s) => s.prefs);
  const custom = p.theme === 'custom';
  const [hexDraft, setHexDraft] = useState(p.custom);
  const check = custom ? customVars(p) : null;
  const font = FONTS.find((f) => f.id === p.font) || FONTS[0];
  const code = CODES.find((f) => f.id === p.code) || CODES[0];
  const px = (SIZES.find((s) => s[0] === p.size) || SIZES[1])[2];
  return html`<${Page} title="Appearance" sub="Applies instantly and is remembered on this browser.">
    <section aria-labelledby="h-theme" class="ssec">
      <h2 id="h-theme" class="h2">Theme</h2>
      <div role="radiogroup" aria-labelledby="h-theme" class="theme-grid">
        ${THEMES.map((t) => {
          const isC = t.id === 'custom';
          const bg = isC ? (p.base === 'light' ? '#ffffff' : '#111114') : t.bg;
          const side = isC ? (p.base === 'light' ? '#f4f4f5' : '#0c0c0f') : t.side;
          const bar = isC ? (p.base === 'light' ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.14)') : t.bar;
          const ac = isC ? p.custom : t.ac;
          const on = p.theme === t.id;
          return html`<button key=${t.id} class="th" role="radio" aria-checked=${on} onClick=${() => setPrefs({ theme: t.id })}
            style=${on ? 'border-color: var(--tx-2); box-shadow: 0 0 0 1px var(--tx-2)' : ''}>
            <span class="th-prev" style=${`background: ${bg}`}><span style=${`width: 28%; background: ${side}`}></span>
              <span class="th-lines"><span style=${`width: 70%; background: ${bar}`}></span><span style=${`width: 45%; background: ${bar}`}></span>
              <span class="th-bubble" style=${`background: ${ac}`}></span></span></span>
            <span class="th-text"><span class="th-name">${t.label}${on && html`<span class="th-check"><${Icon} name="check" size=${12} style="stroke-width: 2.6" /></span>`}</span>
              <span class="th-desc">${t.desc}</span></span>
          </button>`;
        })}
      </div>
      ${['dark', 'light', 'system'].includes(p.theme) && html`<div class="srow" style="border-top: 0; padding-top: 4px">
        <div class="lab"><div class="t">Accent</div><div class="sub">Buttons, selection and focus.</div></div>
        <div style="display: flex; gap: 8px">${ACCENTS.map(([id, label, color]) => html`<button key=${id} class="swatch" aria-label=${label} title=${label} aria-pressed=${p.accent === id}
          onClick=${() => setPrefs({ accent: id })} style=${`background: ${color}; ${p.accent === id ? `box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px ${color}` : ''}`}></button>`)}</div>
      </div>`}
      ${custom && html`<div class="card custom-card">
        <div style="display: flex; align-items: flex-start; gap: 12px"><div style="flex: 1"><div style="font-size: 15px; font-weight: 600">Custom theme</div>
          <div class="sub">Pick a few colors. Everything else is derived and checked for readability.</div></div>
          <button class="btn btn-g" style="color: var(--bad)" onClick=${() => setPrefs({ theme: 'dark' })}>Delete</button></div>
        <div class="custom-grid">
          <span class="cl">Base</span><${Seg} label="Base" items=${[['dark', 'Dark'], ['light', 'Light']]} value=${p.base} onPick=${(v) => setPrefs({ base: v })} />
          <span class="cl">Accent</span>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
            ${SWATCHES.map(([name, c]) => html`<button key=${name} class="swatch" aria-label=${name} title=${name} onClick=${() => { setHexDraft(c); setPrefs({ custom: c }); }}
              style=${`background: ${c}; ${p.custom === c ? `box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px ${c}` : ''}`}></button>`)}
            <span class="vsep" style="height: 22px"></span>
            <label for="hex" class="sr">Accent color</label>
            <input id="hex" class="inp mono" style="width: 96px; height: 32px" value=${hexDraft}
              onInput=${(e) => { const v = e.target.value; setHexDraft(v); if (/^#[0-9a-fA-F]{6}$/.test(v)) setPrefs({ custom: v.toLowerCase() }); }} />
            <button class="btn" title="Pick a color from anywhere on screen" onClick=${async () => {
              if (!window.EyeDropper) { toast('This browser can’t pick colors from the screen. Type a hex value instead.'); return; }
              try { const { sRGBHex } = await new window.EyeDropper().open(); setHexDraft(sRGBHex); setPrefs({ custom: sRGBHex }); } catch { /* cancelled */ }
            }}><${Icon} name="eye" />Pick from screen</button>
          </div>
          <span class="cl">Background</span><${Seg} label="Background tint" items=${[['neutral', 'Neutral'], ['accent', 'Match accent']]} value=${p.tint} onPick=${(v) => setPrefs({ tint: v })} />
          <span class="cl">Contrast</span><${Seg} label="Contrast" items=${[['soft', 'Soft'], ['standard', 'Standard'], ['high', 'High']]} value=${p.contrast} onPick=${(v) => setPrefs({ contrast: v })} />
        </div>
        <div class="check ok"><${Icon} name="check" /><span>All text meets WCAG AA · lowest pair ${check.low.toFixed(1)}:1. Buttons were darkened where white text needed it.</span></div>
      </div>`}
    </section>
    <section aria-labelledby="h-font" class="ssec">
      <div><h2 id="h-font" class="h2">Interface font</h2><p class="sub">Used for everything except code. Geist is built in; the others load from Google Fonts when picked.</p></div>
      <div role="radiogroup" aria-labelledby="h-font" class="font-grid">${FONTS.map((f) => html`<button key=${f.id} class="ft" role="radio" aria-checked=${p.font === f.id}
        style=${p.font === f.id ? 'border-color: var(--tx-2); box-shadow: 0 0 0 1px var(--tx-2)' : ''} onClick=${() => setPrefs({ font: f.id })}>
        <span style=${`font-family: ${f.fam}; font-size: 26px; line-height: 1.1; margin-bottom: 6px`}>Aa</span>
        <span style="font-size: 13px; font-weight: 500; font-family: 'Geist', sans-serif">${f.label}</span><span style="font-size: 12px; color: var(--tx-3); font-family: 'Geist', sans-serif">${f.note}</span></button>`)}</div>
    </section>
    <section aria-labelledby="h-code" class="ssec">
      <div><h2 id="h-code" class="h2">Code font</h2><p class="sub">Code blocks, commands and file names.</p></div>
      <div role="radiogroup" aria-labelledby="h-code" class="code-grid">${CODES.map((f) => html`<button key=${f.id} class="ft" role="radio" aria-checked=${p.code === f.id}
        style=${p.code === f.id ? 'border-color: var(--tx-2); box-shadow: 0 0 0 1px var(--tx-2)' : ''} onClick=${() => setPrefs({ code: f.id })}>
        <span style=${`font-family: ${f.fam}; font-size: 16px; margin-bottom: 8px`}>fn → 0x1F</span>
        <span style="font-size: 13px; font-weight: 500">${f.label}</span><span style="font-size: 12px; color: var(--tx-3)">${f.note}</span></button>`)}</div>
    </section>
    <section class="ssec" style="gap: 0">
      <div class="srow" style="border-top: 0; padding-top: 0">
        <div class="lab"><div class="t">Text size</div><div class="sub">Scales text and the spacing around it.</div></div>
        <${Seg} label="Text size" items=${SIZES.map((s) => [s[0], s[1]])} value=${p.size} onPick=${(v) => setPrefs({ size: v })} />
      </div>
      <div class="srow">
        <div class="lab"><div class="t">Density</div><div class="sub">Compact fits more chats on screen.</div></div>
        <${Seg} label="Density" items=${[['comfortable', 'Comfortable'], ['compact', 'Compact']]} value=${p.density} onPick=${(v) => setPrefs({ density: v })} />
      </div>
      <div class="srow">
        <div class="lab"><div class="t">Start page</div><div class="sub">What opens when you launch the app.</div></div>
        <button class="btn" style="min-width: 240px; justify-content: space-between; height: 36px; background: var(--bg-input)" onClick=${notInLite('Choosing a start page')}>
          <span>A new chat</span><${Icon} name="chevron-down" /></button>
      </div>
    </section>
    <section aria-label="Preview" class="preview-box">
      <div class="pv-head">Preview</div>
      <div style=${`display: flex; flex-direction: column; gap: ${p.density === 'compact' ? 8 : 14}px; padding: 20px; font-family: ${font.fam}; font-size: ${px}px; line-height: 1.55; background: var(--bg); color: var(--tx)`}>
        <div style="align-self: flex-end; max-width: 70%; padding: 8px 14px; border-radius: 16px; background: var(--bg-active)">Can you summarize the release notes?</div>
        <div style="max-width: 90%">Three changes stand out: a collapsible sidebar, a searchable model picker, and agents in the same chat. <span style="text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 3px">Read the full notes</span>.</div>
        <div style=${`font-family: ${code.fam}; font-size: .86em; padding: 10px 12px; border-radius: 8px; background: var(--bg-side); border: 1px solid var(--line); color: var(--tx-2)`}>const reply = await model.generate({ prompt });</div>
        <div style="display: flex; gap: 8px"><span style="padding: 5px 12px; border-radius: 8px; background: var(--ac); color: var(--on-ac); font-size: .9em; font-weight: 500">Save changes</span><span style="padding: 5px 12px; border-radius: 8px; border: 1px solid var(--line-2); font-size: .9em">Cancel</span></div>
      </div>
    </section>
  <//>`;
}

const PROVIDER_TYPES = [
  { id: 'openai', label: 'OpenAI-compatible', sub: 'Any server with the OpenAI API', name: 'OpenAI', url: 'https://api.openai.com/v1', key: 'OPENAI_API_KEY', hint: 'Create one at platform.openai.com/api-keys.' },
  { id: 'openrouter', label: 'OpenRouter', sub: 'Hundreds of models, one key', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', key: 'OPENROUTER_API_KEY', hint: 'Create one at openrouter.ai/keys.' },
  { id: 'anthropic', label: 'Anthropic', sub: 'Claude through its OpenAI-compatible API', name: 'Anthropic', url: 'https://api.anthropic.com/v1', key: 'ANTHROPIC_API_KEY', hint: 'List the models you want in MODELS.', models: 'claude-sonnet-5-5,claude-haiku-5-5' },
  { id: 'ollama', label: 'Ollama', sub: 'Models on your own machine', name: 'Ollama', url: 'http://127.0.0.1:11434/v1', key: '', hint: 'Start it with ollama serve. No key needed.' },
];
const AGENT_TYPES = [
  { id: 'claude', name: 'Claude Code', command: 'npx -y @agentclientprotocol/claude-agent-acp', sub: 'Uses your claude login or ANTHROPIC_API_KEY' },
  { id: 'codex', name: 'Codex', command: 'npx -y @agentclientprotocol/codex-acp', sub: 'Uses your codex login or OPENAI_API_KEY' },
  { id: 'hermes', name: 'Hermes', command: 'hermes acp', sub: 'Install Hermes with its ACP extra' },
  { id: 'pi', name: 'Pi', command: 'npx -y pi-acp', sub: 'Needs pi on your PATH' },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini --experimental-acp', sub: 'Check gemini --help for the ACP flag' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode acp', sub: 'Uses the models set up in OpenCode' },
];

function Providers() {
  const config = useStore((s) => s.config);
  const [testing, setTesting] = useState(false);
  const [showModels, setShowModels] = useState(null);
  const test = async () => {
    setTesting(true);
    try { store.set({ config: await api('/api/config?refresh=1') }); toast('Checked every provider again.'); }
    catch (e) { toast(e.message); }
    finally { setTesting(false); }
  };
  const providers = config?.providers || [];
  const agents = config?.agents || [];
  return html`<${Page} title="Providers and agents" sub="What this server can talk to. Everything here comes from its .env file; change it there and restart."
    action=${html`<button class="btn" style="height: 36px" onClick=${test} disabled=${testing}><${Icon} name="refresh" />${testing ? 'Checking…' : 'Test all'}</button>`}>
    <section aria-labelledby="h-conn" class="ssec" style="gap: 10px">
      <h2 id="h-conn" class="h3">Model providers</h2>
      ${providers.length === 0 ? html`<div class="card empty-card">No model providers yet. Add one below.</div>` : html`<div class="card">
        ${providers.map((p, i) => html`<div key=${p.id}>
          ${i > 0 && html`<div class="hr"></div>`}
          <div class="prov-row">
            <span class="prov-logo" style=${`background: ${providerGradient(p.id, p.local)}`}></span>
            <div style="flex: 1; min-width: 0">
              <div class="prov-name"><span>${p.name}</span>
                ${p.error ? html`<span class="pill warn"><${Icon} name="unverified" />Not answering</span>`
                  : html`<span class="pill ok"><span style="width: 6px; height: 6px; border-radius: 50%; background: currentColor"></span>Connected</span>`}
                <span class="pill" style="color: var(--tx-3)">From .env</span></div>
              <div class="prov-sub">OpenAI-compatible · <span class="mono">${p.host}</span> · ${p.has_key ? 'key set' : 'no key'} · ${p.models} model${p.models === 1 ? '' : 's'}${p.listed ? ' listed in .env' : ''}</div>
            </div>
            <button class="btn btn-g" onClick=${test}>Test</button>
            <button class="btn btn-g" onClick=${() => setShowModels(showModels === p.id ? null : p.id)} aria-expanded=${showModels === p.id}>Models</button>
          </div>
          ${p.error && html`<div class="prov-note">${p.error}. Its models are hidden from the picker until it answers.${p.local ? html` If it runs on this machine, start it (for Ollama: <code class="mono">ollama serve</code>) and test again.` : ''}</div>`}
          ${showModels === p.id && html`<div class="prov-models">${(config.models.filter((m) => m.provider === p.id)).map((m) => html`<span class="tn" key=${m.id}>${m.model}</span>`)}
            ${p.models === 0 && html`<span style="color: var(--tx-3)">No models.</span>`}</div>`}
        </div>`)}
      </div>`}
    </section>
    <section aria-labelledby="h-agents" class="ssec" style="gap: 10px">
      <h2 id="h-agents" class="h3">Agents</h2>
      ${agents.length === 0 ? html`<div class="card empty-card">No agents connected yet. Add Claude Code, Codex, Hermes or any agent that speaks ACP below.</div>` : html`<div class="card">
        ${agents.map((a, i) => html`<div key=${a.id}>
          ${i > 0 && html`<div class="hr"></div>`}
          <div class="prov-row">
            <span class="prov-logo" style=${`background: ${AGENT_GRADIENT}; display: grid; place-items: center; color: #fff`}><${Icon} name="agent" /></span>
            <div style="flex: 1; min-width: 0">
              <div class="prov-name"><span>${a.name}</span>
                <span class=${cx('pill', a.running && 'ok')}>${a.running ? 'Running' : 'Starts when needed'}</span><span class="pill" style="color: var(--tx-3)">From .env</span></div>
              <div class="prov-sub"><span class="mono">${a.command}</span> · works in <span class="mono">${a.cwd}</span></div>
            </div>
          </div>
        </div>`)}
      </div>`}
    </section>
    <${AddProvider} />
    <${AddAgent} />
  <//>`;
}

function EnvSnippet({ lines }) {
  const text = lines.join('\n');
  return html`<div class="env-snippet"><pre class="mono">${text}</pre>
    <button class="btn btn-sm" onClick=${() => copyText(text)}><${Icon} name="copy" size=${14} />Copy</button></div>`;
}

const envId = (name) => (name || 'provider').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 20) || 'PROVIDER';

function AddProvider() {
  const [type, setType] = useState(PROVIDER_TYPES[1]);
  const [name, setName] = useState(type.name);
  const [url, setUrl] = useState(type.url);
  const pick = (t) => { setType(t); setName(t.name); setUrl(t.url); };
  const id = envId(name);
  const lines = [`PROVIDER_${id}_URL=${url}`, ...(type.key ? [`PROVIDER_${id}_KEY=\${${type.key}}`] : []), `PROVIDER_${id}_NAME=${name}`,
    ...(type.models ? [`PROVIDER_${id}_MODELS=${type.models}`] : [])];
  return html`<section aria-labelledby="h-add" class="card add-card">
    <div><h2 id="h-add" class="h2">Add a provider</h2><p class="sub">Pick a type, then paste these lines into .env and restart the server.${type.key ? ` Keep the key in your shell as ${type.key}; .env only names it.` : ''}</p></div>
    <div class="opt-grid">${PROVIDER_TYPES.map((t) => html`<button key=${t.id} class=${cx('opt', t.id === type.id && 'on')} aria-pressed=${t.id === type.id} onClick=${() => pick(t)}>
      <span style="display: flex; align-items: center; justify-content: space-between; font-size: 13.5px; font-weight: 500">${t.label}${t.id === type.id && html`<${Icon} name="check" style="color: var(--ac-tx)" />`}</span>
      <span style="font-size: 12px; color: var(--tx-3)">${t.sub}</span></button>`)}</div>
    <div class="two-col">
      <div class="f"><label for="pn">Name</label><input id="pn" class="inp" value=${name} onInput=${(e) => setName(e.target.value)} /><small>Shown in the model picker.</small></div>
      <div class="f"><label for="pu">Base URL</label><input id="pu" class="inp mono" value=${url} onInput=${(e) => setUrl(e.target.value)} /><small>${type.hint}</small></div>
    </div>
    <${EnvSnippet} lines=${lines} />
  </section>`;
}

function AddAgent() {
  const [type, setType] = useState(AGENT_TYPES[0]);
  const lines = [`AGENT_${type.id.toUpperCase()}_COMMAND=${type.command}`, `AGENT_${type.id.toUpperCase()}_NAME=${type.name}`, `# AGENT_${type.id.toUpperCase()}_CWD=~/code`];
  return html`<section aria-labelledby="h-add-agent" class="card add-card">
    <div><h2 id="h-add-agent" class="h2">Add an agent</h2><p class="sub">Any agent that speaks the Agent Client Protocol. It runs as you, with its own sign-in, so log in to it in a terminal once.</p></div>
    <div class="opt-grid three">${AGENT_TYPES.map((t) => html`<button key=${t.id} class=${cx('opt', t.id === type.id && 'on')} aria-pressed=${t.id === type.id} onClick=${() => setType(t)}>
      <span style="display: flex; align-items: center; justify-content: space-between; font-size: 13.5px; font-weight: 500">${t.name}${t.id === type.id && html`<${Icon} name="check" style="color: var(--ac-tx)" />`}</span>
      <span style="font-size: 12px; color: var(--tx-3)">${t.sub}</span></button>`)}</div>
    <${EnvSnippet} lines=${lines} />
  </section>`;
}

function Notifications() {
  const supported = 'Notification' in window;
  const [state, setState] = useState(supported ? Notification.permission : 'unsupported');
  const ask = async () => setState(await Notification.requestPermission());
  return html`<${Page} title="Notifications" sub="Get told when a reply needs you or finishes while you’re in another tab.">
    <section class="ssec" style="gap: 0">
      <div class="srow" style="border-top: 0; padding-top: 0">
        <div class="lab"><div class="t">Browser notifications</div><div class="sub">${state === 'granted' ? 'On for this browser.' : state === 'denied' ? 'Blocked. Allow notifications for this site in your browser settings.' : state === 'unsupported' ? 'This browser can’t show notifications.' : 'Off. Your browser asks once when you turn them on.'}</div></div>
        ${state === 'default' ? html`<button class="btn btn-p" onClick=${ask}>Turn on</button>` : html`<span class=${cx('pill', state === 'granted' ? 'ok' : 'warn')}>${state === 'granted' ? 'On' : state === 'denied' ? 'Blocked' : 'Unavailable'}</span>`}
      </div>
      <div class="srow"><div class="lab"><div class="t">When an agent waits for you</div><div class="sub">A permission request or a question.</div></div><span class="pill ok">Always</span></div>
      <div class="srow"><div class="lab"><div class="t">When a reply finishes</div><div class="sub">Only while the tab is in the background.</div></div><span class="pill ok">Always</span></div>
    </section>
  <//>`;
}

function Keyboard() {
  const rows = [[`${mod}N`, 'New chat'], [`${mod}K`, 'Search chats, actions and settings'], [`${mod}M`, 'Switch model'], [`${mod}\\`, 'Collapse or expand the sidebar'],
    ['↵', 'Send, or allow the waiting request'], ['⇧↵', 'New line'], ['Esc', 'Stop the reply, or close the top layer'], ['?', 'Show shortcuts']];
  return html`<${Page} title="Keyboard" sub="Every shortcut in AgentWebUI Lite.">
    <section class="card" style="padding: 4px 16px">${rows.map(([k, d], i) => html`<div class="pr" key=${k} style=${i === 0 ? 'border-top: 0' : ''}>
      <span class="kbd" style="min-width: 52px; text-align: center">${k}</span><span>${d}</span></div>`)}</section>
  <//>`;
}

export async function refreshConfig() { await loadConfig(); }
