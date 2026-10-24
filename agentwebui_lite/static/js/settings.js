// Settings (Settings · appearance, Settings · providers and Settings more boards). Lite is configured in .env, so
// the provider and agent forms write the lines to paste there; what is yours (chat, voice, notifications) is kept
// in this browser.
import { html, useState, useEffect, store, useStore, cx, navigate, copyText, api, providerGradient, AGENT_GRADIENT, mod, toast, local } from './lib.js';
import { Icon } from './icons.js';
import { Logo, agentLogo, providerLogo } from './logos.js';
import { THEMES, SWATCHES, FONTS, CODES, SIZES, ACCENTS, setPrefs, customVars, setChatPrefs, resetEverything } from './prefs.js';
import { loadConfig, followChecks, targets, defaultTarget } from './actions.js';
import { canDictate, canSpeak, voices, speak } from './voice.js';
import { confirm } from './ui.js';

const NAV = [
  ['You', [['chat', 'chat', 'Chat'], ['appearance', 'palette', 'Appearance'], ['voice', 'mic', 'Voice'],
    ['notifications', 'notification', 'Notifications'], ['keyboard', 'key', 'Keyboard']]],
  ['Connections', [['providers', 'plug', 'Providers'], ['workspaces', 'workspace', 'Workspaces & Git']]],
];
const BUILT = new Set(NAV.flatMap(([, items]) => items.map(([id]) => id)));

export function Settings() {
  const route = useStore((s) => s.route);
  const section = BUILT.has(route.section) ? route.section : 'chat';
  return html`<div class="settings">
    <aside class="snav" aria-label="Settings">
      <a href="#/" class="sn back" onClick=${(e) => { e.preventDefault(); navigate('#/'); }}><${Icon} name="chevron-left" />Back to chats</a>
      <nav>${NAV.map(([group, items]) => html`<div key=${group}><div class="sg">${group}</div>
        ${items.map(([id, icon, label]) => html`<a key=${id} href=${`#/settings/${id}`} class=${cx('sn', id === section && 'on')} aria-current=${id === section ? 'page' : undefined}><${Icon} name=${icon} />${label}</a>`)}</div>`)}</nav>
    </aside>
    <main class="settings-main">
      <div class="settings-phone-head phone-only"><button class="ib" aria-label="Back to chats" onClick=${() => navigate('#/')}><${Icon} name="chevron-left" /></button>
        <select class="sel" value=${section} onChange=${(e) => navigate(`#/settings/${e.target.value}`)} aria-label="Settings section">
          ${[...BUILT].map((id) => html`<option value=${id}>${NAV.flatMap(([, i]) => i).find((x) => x[0] === id)[2]}</option>`)}</select></div>
      ${section === 'chat' && html`<${ChatSettings} />`}
      ${section === 'voice' && html`<${Voice} />`}
      ${section === 'workspaces' && html`<${Workspaces} />`}
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
  const hiddenModels = useStore((s) => s.chatPrefs?.hiddenModels || {});
  const [testing, setTesting] = useState(false);
  const [showModels, setShowModels] = useState(null);
  const test = async () => {
    setTesting(true);
    try { const fresh = await api('/api/config?refresh=1'); store.set({ config: fresh }); followChecks(fresh); toast('Checked every provider again.'); }
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
            <${Logo} name=${providerLogo(p)} tile size=${40} radius=${10} fallback=${providerGradient(p.id, p.local)} />
            <div style="flex: 1; min-width: 0">
              <div class="prov-name"><span>${p.name}</span>
                ${p.error ? html`<span class="pill warn"><${Icon} name="unverified" />Not answering</span>`
                  : html`<span class="pill ok"><span style="width: 6px; height: 6px; border-radius: 50%; background: currentColor"></span>Connected</span>`}
                <span class="pill" style="color: var(--tx-3)">From .env</span></div>
              <div class="prov-sub">OpenAI-compatible · <span class="mono">${p.host}</span> · ${p.has_key ? 'key set' : 'no key'} · ${p.models} model${p.models === 1 ? '' : 's'}${p.listed ? ' listed in .env' : ''}</div>
              <div class="prov-sub">${p.why}</div>
            </div>
            <button class="btn btn-g" onClick=${test}>Test</button>
            <button class="btn btn-g" onClick=${() => setShowModels(showModels === p.id ? null : p.id)} aria-expanded=${showModels === p.id}>Models</button>
          </div>
          ${p.error && html`<div class="prov-note">${p.error}. Its models are hidden from the picker until it answers.${p.endpoint === 'machine' || p.endpoint === 'network' ? html` If it runs on this machine, start it (for Ollama: <code class="mono">ollama serve</code>) and test again.` : ''}</div>`}
          ${showModels === p.id && html`<div class="prov-models" role="group" aria-label=${`Models from ${p.name}`}>
            <span class="meta" style="width: 100%">Shown in the model picker. Tap one to hide it on this browser.</span>
            ${(config.models.filter((m) => m.provider === p.id)).map((m) => {
              const hidden = !!hiddenModels[`model:${m.id}`];
              return html`<button key=${m.id} class=${cx('chip', !hidden && 'on')} aria-pressed=${!hidden}
                onClick=${() => setChatPrefs({ hiddenModels: { ...hiddenModels, [`model:${m.id}`]: !hidden } })}>${!hidden && html`<${Icon} name="check" size=${13} />`}${m.model}</button>`;
            })}
            ${p.models === 0 && html`<span style="color: var(--tx-3)">No models.</span>`}</div>`}
        </div>`)}
      </div>`}
    </section>
    <section aria-labelledby="h-default" class="ssec" style="gap: 0">
      <div class="srow" style="border-top: 0; padding-top: 0">
        <div class="lab"><div class="t" id="h-default">Default for new chats</div><div class="sub">Pick any model or agent from .env. ${mod}↵ in the model picker does the same.</div></div>
        <${DefaultTarget} />
      </div>
    </section>
    <section aria-labelledby="h-agents" class="ssec" style="gap: 10px">
      <h2 id="h-agents" class="h3">Agents</h2>
      ${agents.length === 0 ? html`<div class="card empty-card">No agents connected yet. Add Claude Code, Codex, Hermes or any agent that speaks ACP below.</div>` : html`<div class="card">
        ${agents.map((a, i) => html`<div key=${a.id}>
          ${i > 0 && html`<div class="hr"></div>`}
          <div class="prov-row">
            <${Logo} name=${agentLogo(a)} tile size=${40} radius=${10} fallback=${AGENT_GRADIENT} icon="agent" iconSize=${20} />
            <div style="flex: 1; min-width: 0">
              <div class="prov-name"><span>${a.name}</span>
                <span class=${cx('pill', a.running && 'ok')}>${a.running ? 'Running' : 'Starts when needed'}</span><span class="pill" style="color: var(--tx-3)">From .env</span></div>
              <div class="prov-sub"><span class="mono">${a.command}</span> · works in <span class="mono">${a.cwd}</span>${a.model ? html` · starts on <span class="mono">${a.model}</span>` : ''}</div>
              ${a.options && html`<div class="prov-sub">${a.options.filter((o) => o.category === 'model').flatMap((o) => (o.options || []).flatMap((x) => x.options || [x])).map((c) => c.name).join(' · ') || 'No model choice'}</div>`}
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

const Switch = ({ on, label, onChange }) => html`<button class=${cx('sw', on && 'on')} role="switch" aria-checked=${on} aria-label=${label} onClick=${() => onChange(!on)}><span></span></button>`;

function Notifications() {
  const prefs = useStore((s) => s.chatPrefs);
  const webhook = useStore((s) => s.config?.webhook);
  const supported = 'Notification' in window;
  const [state, setState] = useState(supported ? Notification.permission : 'unsupported');
  const ask = async () => setState(await Notification.requestPermission());
  const rows = [['notifyWaiting', 'An agent waits for you', 'A permission request or a question'], ['notifyFinish', 'A reply finishes', 'In a chat you’re not looking at'],
    ['notifyFail', 'Something fails', 'A reply that stopped with an error']];
  return html`<${Page} title="Notifications" sub="Get told when a reply needs you, finishes or fails while you look elsewhere.">
    <section class="ssec" style="gap: 14px">
      <div class="notify-banner"><${Icon} name="notification" style="color: var(--tx-2)" /><div style="flex: 1"><div class="t">${state === 'granted' ? 'Browser notifications are on' : 'Browser notifications are off'}</div>
        <div class="sub">${state === 'granted' ? 'This browser shows them while the tab is in the background.' : state === 'denied' ? 'Blocked. Allow notifications for this site in your browser settings.' : state === 'unsupported' ? 'This browser can’t show notifications.' : 'Allow them to hear about replies while you’re in another tab.'}</div></div>
        ${state === 'default' && html`<button class="btn" onClick=${ask}>Allow</button>`}</div>
      <div role="table" aria-label="What you’re notified about" class="notify-table">
        <div role="row" class="nrow head"><span role="columnheader">Notify me when</span><span role="columnheader">In app</span><span role="columnheader">Browser</span></div>
        ${rows.map(([key, title, sub]) => html`<div role="row" class="nrow" key=${key}>
          <span role="cell"><span class="t" style="display: block; font-size: 13.5px; font-weight: 500">${title}</span><span class="sub">${sub}</span></span>
          <span role="cell"><button class=${cx('cb', prefs[key] && prefs.inApp && 'on')} role="checkbox" aria-checked=${!!(prefs[key] && prefs.inApp)} aria-label=${`${title}: in app`}
            onClick=${() => setChatPrefs(prefs[key] && prefs.inApp ? { inApp: false } : { [key]: true, inApp: true })}>${prefs[key] && prefs.inApp && html`<${Icon} name="check" />`}</button></span>
          <span role="cell"><button class=${cx('cb', prefs[key] && state === 'granted' && 'on')} role="checkbox" aria-checked=${!!(prefs[key] && state === 'granted')} aria-label=${`${title}: browser`}
            disabled=${state !== 'granted'} style=${state !== 'granted' ? 'opacity: .4' : ''} onClick=${() => setChatPrefs({ [key]: !prefs[key] })}>${prefs[key] && state === 'granted' && html`<${Icon} name="check" />`}</button></span>
        </div>`)}
      </div>
      <div class="srow"><div class="lab"><div class="t">Send to a webhook</div><div class="sub">${webhook ? 'On. The server posts to NOTIFY_WEBHOOK when a reply finishes, fails or waits for you, even with every tab closed.' : 'Post to Slack, Teams, ntfy or any URL, even with every tab closed. Set NOTIFY_WEBHOOK in the server’s .env.'}</div></div>
        <span class=${cx('pill', webhook && 'ok')}>${webhook ? 'On' : 'Off'}</span></div>
    </section>
  <//>`;
}

function DefaultTarget() {
  const config = useStore((s) => s.config);
  const [value, setValue] = useState(defaultTarget());
  const all = targets(config);
  return html`<select class="sel" style="width: 280px" aria-label="Default for new chats" value=${value} onChange=${(e) => { setValue(e.target.value); local.set('defaultTarget', e.target.value); store.set({ draftTarget: e.target.value }); toast('New chats start with it.'); }}>
    ${all.map((t) => html`<option value=${t.value}>${t.kind === 'agent' ? `Agent · ${t.name}` : `${t.model.provider_name} · ${t.name}`}</option>`)}</select>`;
}

const LENGTHS = [['', 'Auto'], ['512', '512 tokens'], ['1024', '1,024 tokens'], ['2048', '2,048 tokens'], ['4096', '4,096 tokens'], ['8192', '8,192 tokens'], ['16384', '16,384 tokens']];

function ChatSettings() {
  const prefs = useStore((s) => s.chatPrefs);
  const [draft, setDraft] = useState(prefs.instructions);
  return html`<${Page} title="Chat" sub="How new chats start on this browser. Each chat can change these in its controls.">
    <section class="ssec" style="gap: 0">
      <div class="srow" style="border-top: 0; padding-top: 0"><div class="lab"><div class="t">Default for new chats</div><div class="sub">The model or agent the home screen starts with.</div></div><${DefaultTarget} /></div>
      <div class="srow" style="flex-direction: column; align-items: stretch; gap: 10px">
        <div><label for="di" class="t" style="font-size: 15px; font-weight: 600">Default instructions</label><div class="sub">Sent with every new model chat. Existing chats keep theirs. Agents have their own.</div></div>
        <textarea id="di" class="inp" rows="4" style="height: auto; padding: 10px 12px; resize: vertical; line-height: 1.55" value=${draft} maxlength="4000"
          placeholder="Answer in British English. Keep replies short unless I ask for detail." onInput=${(e) => setDraft(e.target.value)} onBlur=${() => setChatPrefs({ instructions: draft.trim() })}></textarea>
        <span class="meta" style="align-self: flex-end">${draft.length.toLocaleString()} / 4,000</span>
      </div>
      <div class="srow"><div class="lab"><div class="t">Temperature</div><div class="sub">Lower is more predictable.</div></div>
        <select class="sel" style="width: 200px" aria-label="Temperature" value=${prefs.temperature == null ? '' : String(prefs.temperature)} onChange=${(e) => setChatPrefs({ temperature: e.target.value === '' ? null : +e.target.value })}>
          <option value="">Model default</option>${['0', '0.3', '0.7', '1', '1.3'].map((t) => html`<option value=${t}>${t}</option>`)}</select></div>
      <div class="srow"><div class="lab"><div class="t">Maximum reply length</div><div class="sub">Leave on Auto unless replies get cut off.</div></div>
        <select class="sel" style="width: 200px" aria-label="Maximum reply length" value=${prefs.maxTokens ? String(prefs.maxTokens) : ''} onChange=${(e) => setChatPrefs({ maxTokens: e.target.value ? +e.target.value : null })}>
          ${LENGTHS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select></div>
      <div class="srow"><div class="lab"><div class="t">Send with Enter</div><div class="sub">${prefs.enterToSend ? 'Shift + Enter adds a new line.' : `${mod}Enter sends; Enter adds a new line.`}</div></div>
        <${Switch} on=${prefs.enterToSend} label="Send with Enter" onChange=${(v) => setChatPrefs({ enterToSend: v })} /></div>
      <div class="srow"><div class="lab"><div class="t">Start page</div><div class="sub">What opens when you launch the app.</div></div>
        <div class="seg" role="radiogroup" aria-label="Start page">${[['new', 'A new chat'], ['last', 'The last chat']].map(([id, label]) => html`<button key=${id} role="radio"
          aria-checked=${prefs.startPage === id} class=${prefs.startPage === id ? 'on' : ''} onClick=${() => setChatPrefs({ startPage: id })}>${label}</button>`)}</div></div>
    </section>
    <section class="card add-card" aria-labelledby="h-reset">
      <div><h2 id="h-reset" class="h2">Back to the default session</h2><p class="sub">Forget everything this browser remembers: appearance, these chat settings, voice, each agent’s last model, favorites and the default model. Your chats and projects stay on the server.</p></div>
      <div><button class="btn btn-dq" onClick=${() => confirm({ title: 'Reset this browser?', danger: true, action: 'Reset everything',
        body: 'Every preference on this browser goes back to its default. Chats and projects are kept.', onConfirm: () => { resetEverything(); setDraft(''); toast('Back to the defaults.'); } })}>
        <${Icon} name="refresh" />Reset to defaults</button></div>
    </section>
  <//>`;
}

const LANGUAGES = [['', 'Same as the browser'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['bn-BD', 'Bengali'], ['hi-IN', 'Hindi'], ['es-ES', 'Spanish'],
  ['fr-FR', 'French'], ['de-DE', 'German'], ['it-IT', 'Italian'], ['pt-BR', 'Portuguese (Brazil)'], ['ar-SA', 'Arabic'], ['ja-JP', 'Japanese'], ['zh-CN', 'Chinese'], ['fi-FI', 'Finnish']];

function Voice() {
  const prefs = useStore((s) => s.chatPrefs);
  const [list, setList] = useState(voices());
  useEffect(() => {
    if (!canSpeak) return undefined;
    const update = () => setList(voices());
    speechSynthesis.addEventListener?.('voiceschanged', update);
    return () => speechSynthesis.removeEventListener?.('voiceschanged', update);
  }, []);
  return html`<${Page} title="Voice" sub="Speak instead of typing, hear replies, or talk hands-free in voice mode. It all runs in your browser; audio never reaches the server.">
    <section class="ssec" style="gap: 0">
      <div class="srow" style="border-top: 0; padding-top: 0"><div class="lab"><div class="t">Dictation and voice mode</div><div class="sub">Your words appear in the message box first.</div></div>
        <span class=${cx('pill', canDictate ? 'ok' : 'warn')}>${canDictate ? 'Browser' : 'Not in this browser'}</span></div>
      <div class="srow"><div class="lab"><div class="t">Language</div><div class="sub">What you speak.</div></div>
        <select class="sel" style="width: 220px" aria-label="Language" value=${prefs.voiceLang} onChange=${(e) => setChatPrefs({ voiceLang: e.target.value })}>
          ${LANGUAGES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select></div>
      <div class="srow"><div class="lab"><div class="t">Read replies aloud</div><div class="sub">Automatically, when a reply finishes in the chat you’re looking at.</div></div>
        <${Switch} on=${prefs.autoRead} label="Read replies aloud" onChange=${(v) => setChatPrefs({ autoRead: v })} /></div>
      <div class="srow"><div class="lab"><div class="t">Voice</div><div class="sub">${canSpeak ? 'Used for reading aloud and in voice mode.' : 'This browser can’t read aloud.'}</div></div>
        <div style="display: flex; gap: 8px">
          <select class="sel" style="width: 240px" aria-label="Voice" value=${prefs.voiceName} disabled=${!canSpeak} onChange=${(e) => setChatPrefs({ voiceName: e.target.value })}>
            <option value="">Default</option>${list.map((v) => html`<option value=${v.name}>${v.name} · ${v.lang}</option>`)}</select>
          <button class="btn" aria-label="Play a sample" disabled=${!canSpeak} onClick=${() => speak('Hello. This is how replies will sound.')}><${Icon} name="play" size=${14} />Try</button>
        </div></div>
      <div class="srow"><div class="lab"><div class="t">Speed</div><div class="sub">${prefs.rate.toFixed(1)}×</div></div>
        <input type="range" min="0.6" max="1.8" step="0.1" value=${prefs.rate} aria-label="Speaking speed" style="width: 240px; accent-color: var(--ac)" onInput=${(e) => setChatPrefs({ rate: +e.target.value })} /></div>
    </section>
  <//>`;
}

function Workspaces() {
  const config = useStore((s) => s.config);
  const roots = config?.roots || [];
  return html`<${Page} title="Workspaces & Git" sub="The folders this server shares with you and its agents. They come from FILES_ROOTS in .env."
    action=${roots.length > 0 && html`<button class="btn" style="height: 36px" onClick=${() => navigate('#/files')}><${Icon} name="folder-open" />Open files</button>`}>
    <section class="ssec" style="gap: 10px">
      <h2 class="h3">Shared folders</h2>
      ${roots.length === 0 ? html`<div class="card empty-card">No folders are shared. Set FILES_ROOTS in .env (comma-separated paths) and restart.</div>`
        : html`<div class="card">${roots.map((r, i) => html`<div key=${r.path}>${i > 0 && html`<div class="hr"></div>`}<div class="prov-row">
          <span class="prov-logo" style="display: grid; place-items: center; background: var(--bg-active); color: var(--tx-2)"><${Icon} name="folder" /></span>
          <div style="flex: 1; min-width: 0"><div class="prov-name">${r.name}<span class=${cx('pill', r.exists ? 'ok' : 'warn')}>${r.exists ? 'Available' : 'Missing'}</span><span class="pill" style="color: var(--tx-3)">From .env</span></div>
            <div class="prov-sub mono">${r.path}</div></div>
          <button class="btn btn-g" disabled=${!r.exists} onClick=${() => navigate(`#/files?path=${encodeURIComponent(r.path)}`)}>Browse</button></div></div>`)}</div>`}
    </section>
    <section class="ssec" style="gap: 0">
      <div class="srow" style="border-top: 0"><div class="lab"><div class="t">Agents stay inside them</div><div class="sub">An agent chat can only open in one of these folders, and its file requests stay in its own folder.</div></div><span class="pill ok">On</span></div>
      <div class="srow"><div class="lab"><div class="t">Git sign-in</div><div class="sub">Push, pull and clone use the server’s own Git sign-in. Give it a deploy key per repository, or a bot account’s token in a credential helper.</div></div>
        <span class="pill">Server</span></div>
    </section>
    <${EnvSnippet} lines=${['FILES_ROOTS=~/code,~/notes']} />
  <//>`;
}

function Keyboard() {
  const rows = [[`${mod}N`, 'New chat'], [`${mod}K`, 'Search chats, actions and settings'], [`${mod}M`, 'Switch model'], [`${mod}\\`, 'Collapse or expand the sidebar'],
    ['↵', 'Send, or allow the waiting request'], ['⇧↵', 'New line'], ['Esc', 'Stop the reply, or close the top layer'], ['?', 'Show shortcuts']];
  return html`<${Page} title="Keyboard" sub="Every shortcut, everywhere in the app.">
    <section class="card" style="padding: 4px 16px">${rows.map(([k, d], i) => html`<div class="pr" key=${k} style=${i === 0 ? 'border-top: 0' : ''}>
      <span class="kbd" style="min-width: 52px; text-align: center">${k}</span><span>${d}</span></div>`)}</section>
  <//>`;
}

export async function refreshConfig() { await loadConfig(); }
