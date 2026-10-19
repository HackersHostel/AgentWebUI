// Messages and agent blocks (Main, Chat states, ChatMore, Rich reply, Agent chat and Agent blocks boards).
import { html, useState, useMemo, useEffect, useRef, store, useStore, cx, copyText, secs, basename, providerGradient, AGENT_GRADIENT,
  size, isImage, fileUrl, rawUrl, saveFile, navigate, api, toast } from './lib.js';
import { Icon } from './icons.js';
import { Logo, targetLogo, agentLogo } from './logos.js';
import { Menu, MenuItem, MenuSep, useToggle } from './ui.js';
import { parse, highlight } from './markdown.js';
import { Choices } from './choices.js';
import { ReadAloud, canSpeak } from './voice.js';
import { answer, retry, describeTarget, openPicker, switchModel, send, showVersion } from './actions.js';

// A path an agent names, as a URL the server serves from the chat's folder.
export const localUrl = (chat, path, download) => `/api/chats/${chat.id}/local?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`;
const relTo = (path, cwd) => (cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path);

function Versions({ chat, message, disabled }) {
  const siblings = message.siblings || [];
  if (siblings.length < 2) return null;
  const at = siblings.indexOf(message.id);
  const go = (i) => showVersion(chat.id, siblings[i]);
  return html`<span class="versions" aria-label=${`Version ${at + 1} of ${siblings.length}`}>
    <button class="ib" aria-label="Previous version" disabled=${disabled || at <= 0} onClick=${() => go(at - 1)}><${Icon} name="chevron-left" size=${14} /></button>
    <span class="meta">${at + 1} / ${siblings.length}</span>
    <button class="ib" aria-label="Next version" disabled=${disabled || at >= siblings.length - 1} onClick=${() => go(at + 1)}><${Icon} name="chevron-right" size=${14} /></button>
  </span>`;
}

export function Attachments({ files, onRemove, busy = [] }) {
  if (!files?.length && !busy.length) return null;
  return html`<div class="atts">
    ${files.map((f) => html`<span class="att" key=${f.id} title=${`${f.name} · ${size(f.size)}`}>
      ${isImage(f.mime) ? html`<img src=${fileUrl(f.id)} alt="" />` : html`<span class="att-ico"><${Icon} name="file-text" size=${15} /></span>`}
      <span class="att-t"><span>${f.name}</span><span class="meta">${size(f.size)}</span></span>
      ${onRemove ? html`<button class="ib" aria-label=${`Remove ${f.name}`} onClick=${() => onRemove(f.id)}><${Icon} name="close" size=${13} /></button>`
        : html`<a class="ib" href=${fileUrl(f.id, true)} aria-label=${`Download ${f.name}`} download=${f.name}><${Icon} name="download" size=${14} /></a>`}
    </span>`)}
    ${busy.map((name) => html`<span class="att" key=${`busy-${name}`}><span class="att-ico"><span class="spinner"></span></span><span class="att-t"><span>${name}</span><span class="meta">Uploading…</span></span></span>`)}
  </div>`;
}

export function UserMessage({ chat, message, running }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.content);
  const box = useRef(null);
  useEffect(() => {
    if (!editing || !box.current) return;
    box.current.focus();
    box.current.setSelectionRange(box.current.value.length, box.current.value.length);
  }, [editing]);
  const files = message.meta?.files || [];
  const canEdit = chat.kind === 'model' && !running;
  if (editing) {
    const save = async () => {
      if (!text.trim()) return;
      setEditing(false);
      await send(text.trim(), { files, edit: message.id });
    };
    return html`<div class="msg-user"><div class="edit-box">
      <label class="sr" for=${`edit-${message.id}`}>Edit your message</label>
      <textarea id=${`edit-${message.id}`} class="bare" rows="3" value=${text} onInput=${(e) => setText(e.target.value)} ref=${box}
        onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }}></textarea>
      <div class="edit-foot"><span class="meta">The reply below is kept as an earlier version.</span><span style="flex: 1"></span>
        <button class="btn btn-g btn-sm" onClick=${() => setEditing(false)}>Cancel</button><button class="btn btn-p btn-sm" onClick=${save} disabled=${!text.trim()}>Send</button></div>
    </div></div>`;
  }
  return html`<div class="msg-user">
    ${files.length > 0 && html`<${Attachments} files=${files} />`}
    ${message.content && html`<div class="bubble">${message.content}</div>`}
    <div class="msg-user-actions">
      <${Versions} chat=${chat} message=${message} disabled=${running} />
      <button class="ib" aria-label="Copy message" title="Copy" style="width: 28px; height: 28px" onClick=${() => copyText(message.content)}><${Icon} name="copy" size=${14} /></button>
      ${canEdit && html`<button class="ib" aria-label="Edit message" title="Edit" style="width: 28px; height: 28px" onClick=${() => { setText(message.content); setEditing(true); }}><${Icon} name="edit" size=${14} /></button>`}
    </div>
  </div>`;
}

export function NoteLine({ text }) {
  return html`<div class="note-line" role="status"><span></span>${text}<span></span></div>`;
}

export function Avatar({ chat }) {
  if (chat.kind === 'agent') return null;
  const info = describeTarget(`model:${chat.target}`);
  const mark = targetLogo(`model:${chat.target}`, store.get().config);
  if (mark) return html`<span class="avatar-ai" style="background: none"><${Logo} name=${mark} tile size=${28} radius=${8} /></span>`;
  return html`<span class="avatar-ai" style=${`background: ${providerGradient(info?.model?.provider || chat.target.split('/')[0], info?.model?.local)}`}>
    <${Icon} name="sparkle" size=${15} style="stroke-width: 2" /></span>`;
}

function AgentHead({ chat }) {
  const info = describeTarget(`agent:${chat.target}`);
  return html`<div class="agent-head"><${Logo} name=${agentLogo(info?.agent)} tile size=${24} radius=${7} fallback=${AGENT_GRADIENT} icon="agent" iconSize=${14} />
    <span style="font-weight: 500">${info?.name || chat.target}</span>
    <span style="color: var(--tx-3)">external agent · in ${basename(chat.cwd)}</span></div>`;
}

// One assistant reply: saved (message) or streaming (live).
export function Reply({ chat, message, live, last }) {
  const parts = live ? live.parts : (message.parts.length ? message.parts : [{ type: 'text', text: message.content }]);
  const meta = message?.meta || {};
  const running = !!live?.running;
  const error = live ? live.error : meta.error;
  const stopped = !live && meta.stop_reason === 'cancelled';
  const cutOff = !live && meta.finish === 'length';
  const isAgent = chat.kind === 'agent';
  const waitingCount = parts.filter((p) => p.type === 'permission' && p.state === 'waiting').length;
  let seenWaiting = 0;
  return html`<div class=${cx('msg-ai', isAgent && 'agent')}>
    <${Avatar} chat=${chat} />
    <div class="msg-body">
      ${isAgent && html`<${AgentHead} chat=${chat} />`}
      ${parts.map((part, i) => {
        const first = part.type === 'permission' && part.state === 'waiting' && seenWaiting++ === 0;
        return html`<${Part} key=${`${part.type}-${part.id || i}`} part=${part} chat=${chat} live=${running} last=${last && !live}
          lastPart=${i === parts.length - 1} first=${first} more=${first ? waitingCount - 1 : 0} />`;
      })}
      ${running && html`<${Working} parts=${parts} chat=${chat} live=${live} />`}
      ${error && html`<${Failure} chat=${chat} error=${error} last=${last} />`}
      ${stopped && html`<div class="stopped"><span class="stopped-pill"><span></span>Stopped</span>
        ${last && html`<button class="btn" onClick=${() => send('Continue.')}>Continue</button>
        <button class="btn btn-g" onClick=${() => retry(chat.id)}>Regenerate</button>`}</div>`}
      ${cutOff && last && html`<div class="stopped"><span class="stopped-pill"><span></span>Cut off at the length limit</span>
        <button class="btn" onClick=${() => send('Continue exactly where you stopped.')}>Continue</button></div>`}
      ${!running && message && !error && html`<${Actions} chat=${chat} message=${message} last=${last} />`}
    </div>
  </div>`;
}

function Part({ part, chat, live, last, lastPart, first, more }) {
  switch (part.type) {
    case 'text': return html`<${Markdown} text=${part.text} streaming=${live && lastPart} chat=${chat} open=${last && lastPart} />`;
    case 'thought': return html`<${Reasoning} part=${part} live=${live && lastPart} />`;
    case 'plan': return html`<${Plan} part=${part} />`;
    case 'tool': return html`<${ToolCall} part=${part} chat=${chat} />`;
    case 'permission': return html`<${Permission} part=${part} chat=${chat} first=${first} more=${more} />`;
    case 'notice': return html`<div class="nt info"><${Icon} name="info" /><div><b>${part.text}</b></div></div>`;
    case 'file': return html`<${FileCard} name=${part.name} mime=${part.mime} size=${part.size}
      url=${part.path ? localUrl(chat, part.path) : part.url || fileUrl(part.id)} download=${part.path ? localUrl(chat, part.path, true) : part.url || fileUrl(part.id, true)} path=${part.path} chat=${chat} />`;
    case 'outputs': return html`<${Outputs} paths=${part.paths} chat=${chat} />`;
    default: return null;
  }
}

export function Markdown({ text, streaming, chat, open }) {
  const resolve = chat?.kind === 'agent' ? (path) => localUrl(chat, path.startsWith('/') ? path : `${chat.cwd}/${path}`) : null;
  const blocks = useMemo(() => parse(text, resolve), [text, chat?.id]);
  const onClick = (e) => {
    const img = e.target.closest('img[data-zoom]');
    if (img) store.set({ overlay: { type: 'image', src: img.src, alt: img.alt } });
  };
  return html`<div class=${cx('prose', streaming && 'streaming')} onClick=${onClick}>
    ${blocks.map((b, i) => (b.type === 'code'
      ? html`<${CodeBlock} key=${i} block=${b} chat=${chat} streaming=${streaming && i === blocks.length - 1} open=${open} />`
      : html`<div key=${i} class="md" dangerouslySetInnerHTML=${{ __html: b.html }}></div>`))}
  </div>`;
}

const fileName = (info) => (info.match(/(?:name|filename|title)\s*=\s*"([^"]+)"|(?:name|filename)\s*=\s*(\S+)/) || [])[1] || (info.match(/(?:name|filename)\s*=\s*(\S+)/) || [])[1] || '';

function CodeBlock({ block, chat, streaming, open }) {
  const { lang, code, info } = block;
  const roots = useStore((s) => s.config?.roots || []);
  const l = lang.toLowerCase();
  if (l === 'choices' && !streaming && !block.open) {
    return html`<${Choices} source=${code} answered=${!open} disabled=${!!store.get().live[chat?.id]?.running}
      onAnswer=${(text) => send(text)} />`;
  }
  if (l === 'file' && !block.open) {
    const name = fileName(info) || 'file.txt';
    const type = name.endsWith('.json') ? 'application/json' : name.endsWith('.csv') ? 'text/csv' : name.endsWith('.html') ? 'text/html' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/plain';
    return html`<${FileCard} name=${name} mime=${type} size=${new Blob([code]).size} text=${code} chat=${chat} />`;
  }
  return html`<${Code} lang=${lang} code=${code} canSave=${roots.length > 0} chat=${chat} name=${fileName(info)} />`;
}

function Code({ lang, code, canSave, chat, name }) {
  const highlighted = useMemo(() => highlight(code, lang), [code, lang]);
  const previewable = /^(html|svg|xml)$/i.test(lang) && /<(svg|html|body|div|!doctype)/i.test(code);
  const [preview, setPreview] = useState(false);
  return html`<div class="codeblock">
    <div class="ch"><span><span class="lang">${name || lang || 'text'}</span></span>
      <span style="display: flex; gap: 2px">
        ${previewable && html`<button class="btn" aria-pressed=${preview} onClick=${() => setPreview(!preview)}><${Icon} name=${preview ? 'workspace' : 'eye'} />${preview ? 'Code' : 'Preview'}</button>`}
        ${canSave && html`<button class="btn hide-sm" onClick=${() => store.set({ overlay: { type: 'save', content: code, name: name || `snippet.${extFor(lang)}`, folder: chat?.cwd } })}><${Icon} name="save" />Save to workspace</button>`}
        <button class="btn" onClick=${() => saveFile(name || `snippet.${extFor(lang)}`, code)} aria-label="Download"><${Icon} name="download" /></button>
        <button class="btn" onClick=${() => copyText(code)}><${Icon} name="copy" />Copy</button>
      </span></div>
    ${preview ? html`<iframe class="code-preview" sandbox="allow-scripts" title="Preview" srcdoc=${code}></iframe>`
      : html`<pre><code dangerouslySetInnerHTML=${{ __html: highlighted }}></code></pre>`}
  </div>`;
}

const EXT = { python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx', html: 'html', css: 'css', json: 'json',
  bash: 'sh', sh: 'sh', shell: 'sh', yaml: 'yml', yml: 'yml', markdown: 'md', md: 'md', sql: 'sql', go: 'go', rust: 'rs', java: 'java', svg: 'svg', csv: 'csv', toml: 'toml' };
const extFor = (lang) => EXT[(lang || '').toLowerCase()] || 'txt';

// An image, recording or file an agent sent or named, or a file a model wrote out in a ```file block.
export function FileCard({ name, mime, size: bytes, url, download, path, text, chat }) {
  const [blobUrl, setBlobUrl] = useState(null);
  useEffect(() => {
    if (text == null) return undefined;
    const made = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
    setBlobUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [text]);
  const href = url || blobUrl;
  const kind = isImage(mime) || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name) ? 'image' : /^audio\//.test(mime || '') ? 'audio' : /^video\//.test(mime || '') ? 'video' : 'file';
  const inFiles = path && store.get().config?.roots?.length;
  const save = () => (text != null ? saveFile(name, text, mime) : null);
  return html`<div class="filecard">
    ${kind === 'image' && href && html`<button class="fc-image" onClick=${() => store.set({ overlay: { type: 'image', src: href, alt: name } })} aria-label=${`Open ${name}`}>
      <img src=${href} alt=${name} loading="lazy" /></button>`}
    ${kind === 'audio' && href && html`<audio controls src=${href} style="width: 100%"></audio>`}
    ${kind === 'video' && href && html`<video controls src=${href} style="width: 100%; border-radius: 8px"></video>`}
    <div class="fc-row">
      <span class="ico"><${Icon} name=${kind === 'image' ? 'image' : kind === 'file' ? 'file-text' : 'play'} /></span>
      <span class="fc-t"><span>${name}</span><span class="meta">${[mime && mime.split(';')[0], bytes != null && size(bytes), path && relTo(path, chat?.cwd || '') !== name && relTo(path, chat?.cwd || '')].filter(Boolean).join(' · ')}</span></span>
      ${inFiles && html`<button class="btn btn-g btn-sm hide-sm" onClick=${() => navigate(`#/files?file=${encodeURIComponent(path)}`)}><${Icon} name="folder-open" size=${14} />Show in files</button>`}
      ${href && kind === 'file' && text == null && html`<a class="btn btn-g btn-sm" href=${href} target="_blank" rel="noopener">Open</a>`}
      ${text != null ? html`<button class="btn btn-sm" onClick=${save}><${Icon} name="download" size=${14} />Download</button>`
        : html`<a class="btn btn-sm" href=${download || href} download=${name}><${Icon} name="download" size=${14} />Download</a>`}
    </div>
  </div>`;
}

// The files the agent wrote this turn, so they can be opened, previewed or downloaded from the chat.
function Outputs({ paths, chat }) {
  const images = paths.filter((p) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p));
  const roots = useStore((s) => s.config?.roots || []);
  return html`<div class="blk">
    <div class="bh" style="cursor: default"><${Icon} name="folder" style="color: var(--tx-3)" /><span class="g">${paths.length === 1 ? 'Changed 1 file' : `Changed ${paths.length} files`}</span>
      ${roots.length > 0 && html`<button class="btn btn-g btn-sm" onClick=${() => navigate(`#/files?path=${encodeURIComponent(chat.cwd)}`)}>Open folder</button>`}</div>
    ${images.length > 0 && html`<div class="out-images">${images.slice(0, 6).map((p) => html`<button key=${p} class="fc-image small" onClick=${() => store.set({ overlay: { type: 'image', src: localUrl(chat, p), alt: basename(p) } })}>
      <img src=${localUrl(chat, p)} alt=${basename(p)} loading="lazy" /></button>`)}</div>`}
    ${paths.map((p) => html`<div class="out-row" key=${p}>
      <${Icon} name="file" size=${14} style="color: var(--tx-3)" /><span class="mono g" title=${p}>${relTo(p, chat.cwd)}</span>
      ${roots.length > 0 && html`<button class="btn btn-g btn-sm hide-sm" onClick=${() => navigate(`#/files?file=${encodeURIComponent(p)}`)}>View</button>`}
      <a class="btn btn-g btn-sm" href=${localUrl(chat, p, true)} download=${basename(p)} aria-label=${`Download ${basename(p)}`}><${Icon} name="download" size=${14} /></a>
    </div>`)}
  </div>`;
}

function Reasoning({ part, live }) {
  const [open, setOpen] = useState(false);
  const label = live ? 'Thinking…' : part.seconds != null ? `Thought for ${secs(part.seconds)}` : 'Thought';
  const summary = (part.text.split('\n').find((l) => l.trim()) || '').slice(0, 120);
  return html`<div class="blk">
    <button class="bh" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      <${Icon} name="chevron-right" class="chev" /><${Icon} name="sparkle" style="color: var(--tx-3)" />
      <span class=${cx('g', live && 'shim')}>${label}${!live && summary ? html`<span style="color: var(--tx-3)"> · ${summary}</span>` : ''}</span>
    </button>
    ${open && html`<div class="bb sans">${part.text}</div>`}
  </div>`;
}

function Status({ status }) {
  if (status === 'completed') return html`<span class="st ok"><${Icon} name="check" /></span>`;
  if (status === 'failed') return html`<span class="st err"><${Icon} name="close" /></span>`;
  if (status === 'in_progress') return html`<span class="st run" aria-label="Running"></span>`;
  return html`<span class="st wait" aria-label="Waiting"></span>`;
}

function Plan({ part }) {
  const done = part.items.filter((i) => i.status === 'completed').length;
  return html`<div class="blk">
    <div style="display: flex; align-items: center; gap: 8px; padding: 10px 12px 2px; font-size: 12px; color: var(--tx-3)">
      <${Icon} name="plan" size=${14} /><span style="flex: 1; font-weight: 500">Plan</span><span>${done} of ${part.items.length} done</span></div>
    <ul class="tasks">${part.items.map((item, i) => html`<li key=${i} class=${item.status === 'completed' ? 'done' : item.status === 'in_progress' ? 'act' : ''}>
      <${Status} status=${item.status} />${item.text}</li>`)}</ul>
  </div>`;
}

function ToolCall({ part }) {
  const failed = part.status === 'failed';
  const [open, setOpen] = useState(failed);
  useEffect(() => { if (failed) setOpen(true); }, [failed]);
  const running = part.status === 'in_progress' || part.status === 'pending';
  const hasBody = part.input || part.output || part.diffs.length || part.locations.length;
  const added = part.diffs.reduce((n, d) => n + diffLines(d.old, d.new).filter((l) => l.t === 'a').length, 0);
  const removed = part.diffs.reduce((n, d) => n + diffLines(d.old, d.new).filter((l) => l.t === 'd').length, 0);
  return html`<div class="blk">
    <button class="bh" aria-expanded=${open} onClick=${() => hasBody && setOpen(!open)} style=${hasBody ? '' : 'cursor: default'}>
      <${Icon} name="chevron-right" class="chev" style=${hasBody ? '' : 'visibility: hidden'} />
      <${Status} status=${part.status} />
      ${part.kind && html`<span class="tn">${part.kind}</span>`}
      <span class=${cx('g', running && 'shim')}>${part.title || 'Tool call'}</span>
      ${part.diffs.length > 0 && html`<span class="meta" style="color: var(--ok)">+${added}</span><span class="meta" style="color: var(--bad)">−${removed}</span>`}
      ${part.seconds != null && html`<span class="meta">${secs(part.seconds)}</span>`}
    </button>
    ${open && hasBody && html`
      ${part.input && html`<div class="bb">${part.kind === 'execute' ? '$ ' : ''}${part.input}</div>`}
      ${part.output && html`<div class="bb">${part.output}</div>`}
      ${part.diffs.map((d, i) => html`<${Diff} key=${i} diff=${d} />`)}
      ${!part.input && !part.output && !part.diffs.length && part.locations.length > 0 && html`<div class="bb">${part.locations.join('\n')}</div>`}`}
  </div>`;
}

// Line diff: longest common subsequence for ordinary files, a plain replace for very large ones.
export function diffLines(oldText, newText) {
  const a = (oldText || '').split('\n'), b = (newText || '').split('\n');
  if (!oldText) return b.map((l) => ({ t: 'a', l }));
  if (a.length * b.length > 4e6) return [...a.map((l) => ({ t: 'd', l })), ...b.map((l) => ({ t: 'a', l }))];
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ t: 'c', l: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: 'd', l: a[i++] });
    else out.push({ t: 'a', l: b[j++] });
  }
  while (i < m) out.push({ t: 'd', l: a[i++] });
  while (j < n) out.push({ t: 'a', l: b[j++] });
  return out;
}

export function Diff({ diff, head = true }) {
  const lines = useMemo(() => {
    const all = diffLines(diff.old, diff.new);
    const keep = all.map((x, i) => x.t !== 'c' || all.slice(Math.max(0, i - 3), i + 4).some((y) => y.t !== 'c'));
    const out = [];
    all.forEach((x, i) => {
      if (keep[i]) out.push(x);
      else if (out.length && out[out.length - 1].t !== 'gap') out.push({ t: 'gap', l: '⋯' });
    });
    return out;
  }, [diff.old, diff.new]);
  const sign = { a: '+ ', d: '- ', c: '  ', gap: '' };
  return html`<div>
    ${head && html`<div class="bh" style="border-top: 1px solid var(--line)"><${Icon} name="file" /><span class="g mono" style="font-size: 12.5px" title=${diff.path}>${diff.path.split('/').slice(-3).join('/')}</span></div>`}
    <div class="diff">${lines.map((x, i) => html`<div key=${i} class=${x.t === 'gap' ? 'gap' : x.t}>${sign[x.t]}${x.l}</div>`)}</div>
  </div>`;
}

// Paths inside the chat's folder read better relative to it.
const rel = (text, cwd) => (cwd && typeof text === 'string' ? text.split(`${cwd}/`).join('') : text);
const ANSWERED = { allow_once: 'Allowed once', allow_always: 'Always allowed', reject_once: 'Denied', reject_always: 'Always denied' };

function Permission({ part, chat, first, more }) {
  const ref = useRef(null);
  const agent = describeTarget(`agent:${chat.target}`)?.name || 'The agent';
  useEffect(() => {
    if (!first || part.state !== 'waiting') return undefined;
    const onKey = (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
      if (document.activeElement && document.activeElement.id === 'composer' && document.activeElement.value.trim()) return;
      const allow = part.options.find((o) => o.kind === 'allow_once') || part.options[0];
      if (allow && (document.activeElement === document.body || ref.current?.contains(document.activeElement))) {
        e.preventDefault();
        answer(chat.id, part.id, allow.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [first, part.state]);
  if (part.state !== 'waiting') {
    const allowed = part.answer_kind?.startsWith('allow');
    const said = ANSWERED[part.answer_kind] || part.answer_name || 'Denied';
    const label = part.state === 'answered'
      ? (allowed ? said : `${said}. ${agent} will find another way or ask you.`)
      : part.state === 'expired' ? 'No answer in time, so it was not allowed' : 'Cancelled';
    return html`<div class="blk"><div class="bh">
      <span class=${cx('st', allowed ? 'ok' : part.state === 'answered' ? 'err' : 'wait')}>${part.state === 'answered' && html`<${Icon} name=${allowed ? 'check' : 'close'} />`}</span>
      <span class="g" style="color: var(--tx-2)">${label}${allowed && part.input ? html` · <span class="mono" style="font-size: 12px">${rel(part.input, chat.cwd)}</span>` : ''}${allowed && !part.input ? ` · ${part.title}` : ''}</span>
    </div></div>`;
  }
  const command = part.kind === 'execute';
  const danger = part.kind === 'delete';
  const question = command ? `Allow ${agent} to run a command?` : `Allow ${agent} to ${part.title.charAt(0).toLowerCase()}${part.title.slice(1)}?`;
  const order = { allow_once: 0, allow_always: 1, reject_once: 2, reject_always: 3 };
  const options = part.options.slice().sort((x, y) => (order[x.kind] ?? 9) - (order[y.kind] ?? 9));
  return html`<div class="perm" role="alertdialog" aria-labelledby=${`q-${part.id}`} ref=${ref} style=${danger ? 'border-color: color-mix(in srgb, var(--bad) 35%, transparent)' : ''}>
    <div class="top">
      <span class="ico" style=${danger ? 'background: var(--bad-soft); color: var(--bad)' : 'background: var(--warn-soft); color: var(--warn)'}><${Icon} name=${command ? 'terminal' : danger ? 'delete' : 'shield'} /></span>
      <div style="flex: 1; min-width: 0">
        <div id=${`q-${part.id}`} style="font-size: 14px; font-weight: 600">${question}</div>
        ${command && part.title && part.title !== part.input && html`<div style="font-size: 13px; color: var(--tx-2); margin-top: 2px">${part.title}</div>`}
        ${part.input && html`<div class="cmd">${command && html`<span style="color: var(--tx-3)">$ </span>`}${rel(part.input, chat.cwd)}</div>`}
        <div class="perm-notes"><span><${Icon} name="folder" size=${13} />In ${basename(chat.cwd)}</span><span><${Icon} name="waiting" size=${13} />Not allowed after 10 min without an answer</span></div>
      </div>
    </div>
    <div class="bot">
      ${options.map((o, i) => html`<button key=${o.id} class=${cx('btn', o.kind === 'allow_once' ? 'btn-p' : o.kind.startsWith('reject') ? 'btn-g' : '', o.kind === 'allow_once' && danger && 'btn-d')}
        onClick=${() => answer(chat.id, part.id, o.id)} data-autofocus=${i === 0 ? '1' : undefined}>
        ${o.name}${o.kind === 'allow_once' && first && html`<span class="kbd" style="border-color: rgba(255,255,255,.35); color: #fff">↵</span>`}</button>`)}
      <span style="flex: 1"></span>
      ${more > 0 && html`<span style="font-size: 12px; color: var(--tx-3)">${more} more waiting</span>`}
    </div>
  </div>`;
}

function Working({ parts, chat, live }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (live.waiting) return null;
  const last = parts[parts.length - 1];
  const tool = [...parts].reverse().find((p) => p.type === 'tool' && (p.status === 'in_progress' || p.status === 'pending'));
  if (!parts.length && chat.kind === 'model') {
    return html`<div class="typing" aria-label="Writing a reply"><span class="dot"></span><span class="dot" style="animation-delay: .2s"></span><span class="dot" style="animation-delay: .4s"></span></div>`;
  }
  if (last && last.type === 'text') return null;
  const label = tool ? `${tool.title || 'Working'}…` : last?.type === 'thought' ? 'Thinking…' : chat.kind === 'agent' && !parts.length ? 'Starting the agent…' : 'Working…';
  const elapsed = live.sentAt ? Math.round((now - live.sentAt) / 1000) : null;
  return html`<div class="blk status-line"><div class="bh">
    <span class="st run" aria-hidden="true"></span><span class="g shim">${label}</span>
    ${elapsed != null && html`<span class="meta">${elapsed} s</span>`}
    <button class="btn btn-g btn-sm" onClick=${() => api(`/api/chats/${chat.id}/cancel`, { method: 'POST' }).catch((e) => toast(e.message))}>Stop<span class="kbd">Esc</span></button>
  </div></div>`;
}

function Failure({ chat, error, last }) {
  const name = chat.kind === 'agent' ? describeTarget(`agent:${chat.target}`)?.name : describeTarget(`model:${chat.target}`)?.name;
  const [details, setDetails] = useState(false);
  const short = error.length > 160 ? `${error.slice(0, 160)}…` : error;
  return html`<div role="alert" class="failure">
    <${Icon} name="error" style="color: var(--bad); margin-top: 2px" />
    <div style="flex: 1; min-width: 0; font-size: 13.5px; line-height: 1.5">
      <div style="font-weight: 500">${name || 'The model'} stopped answering</div>
      <div style="color: var(--tx-2); overflow-wrap: anywhere">${details ? error : short} The text so far is kept.</div>
      ${last && html`<div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap">
        <button class="btn" onClick=${() => retry(chat.id)}>Retry</button>
        ${chat.kind === 'model' && html`<button class="btn btn-g" onClick=${() => openPicker({ value: `model:${chat.target}`, chat, onPick: async (t) => { await switchModel(chat.id, t); retry(chat.id); } })}>Try another model</button>`}
        ${error.length > 160 && html`<button class="btn btn-g" onClick=${() => setDetails(!details)}>${details ? 'Less' : 'Details'}</button>`}
      </div>`}
    </div>
  </div>`;
}

async function branchFrom(chat, message) {
  try {
    const copy = await api(`/api/chats/${chat.id}/clone`, { method: 'POST', body: { upto: message.id } });
    navigate(`#/c/${copy.id}`);
    toast('Branched into a new chat. The original is unchanged.');
  } catch (e) { toast(e.message); }
}

function Actions({ chat, message, last }) {
  const [vote, setVote] = useState(null);
  const [reading, setReading] = useState(false);
  const regen = useToggle();
  const more = useToggle();
  const meta = message.meta || {};
  const tokens = meta.usage && (meta.usage.completion_tokens ?? meta.usage.outputTokens ?? meta.usage.output_tokens);
  const who = chat.kind === 'agent' ? [meta.agent, meta.agent_model].filter(Boolean).join(' · ') : describeTarget(`model:${meta.model || chat.target}`)?.name;
  const info = [who, tokens != null && `${tokens} tokens`, meta.seconds != null && secs(meta.seconds)].filter(Boolean).join(' · ');
  return html`<div class="msg-actions">
    <${Versions} chat=${chat} message=${message} />
    <button class="ib" aria-label="Copy" title="Copy" onClick=${() => copyText(message.content)}><${Icon} name="copy" /></button>
    ${canSpeak && html`<button class=${cx('ib', reading && 'on')} aria-label="Read aloud" title="Read aloud" aria-pressed=${reading} onClick=${() => setReading(!reading)}><${Icon} name="volume" /></button>`}
    <button class=${cx('ib', vote === 'up' && 'on')} aria-label="Good reply" title="Good reply" aria-pressed=${vote === 'up'} onClick=${() => setVote(vote === 'up' ? null : 'up')}><${Icon} name="thumb-up" /></button>
    <button class=${cx('ib', vote === 'down' && 'on')} aria-label="Bad reply" title="Bad reply" aria-pressed=${vote === 'down'} onClick=${() => setVote(vote === 'down' ? null : 'down')}><${Icon} name="thumb-up" style="transform: rotate(180deg)" /></button>
    ${last && html`<button class="btn regen" ref=${regen.ref} title="Regenerate, or pick another model" aria-haspopup="menu" onClick=${regen.toggle}>
      <${Icon} name="regenerate" /><${Icon} name="chevron-down" size=${13} /></button>`}
    ${!chat.temporary && html`<button class="ib" aria-label="Branch in a new chat" title="Branch in a new chat" onClick=${() => branchFrom(chat, message)}><${Icon} name="branch" /></button>`}
    <button class="ib" aria-label="More" ref=${more.ref} aria-haspopup="menu" onClick=${more.toggle}><${Icon} name="more" /></button>
    <span class="msg-meta">${info}</span>
    ${reading && html`<${ReadAloud} text=${message.content} onClose=${() => setReading(false)} />`}
    ${regen.open && html`<${Menu} anchor=${regen.ref} onClose=${regen.close} label="Regenerate" width=${240}>
      <${MenuItem} icon="regenerate" onClick=${() => retry(chat.id)}>Try again<//>
      ${chat.kind === 'model' && html`<${MenuItem} icon="model" onClick=${() => openPicker({ value: `model:${chat.target}`, chat, onPick: async (t) => { await switchModel(chat.id, t); retry(chat.id); } })}>Try another model…<//>`}
    <//>`}
    ${more.open && html`<${Menu} anchor=${more.ref} onClose=${more.close} label="More" width=${230}>
      <${MenuItem} icon="copy" onClick=${() => copyText(message.content)}>Copy as Markdown<//>
      <${MenuItem} icon="download" onClick=${() => saveFile('reply.md', message.content, 'text/markdown')}>Download as Markdown<//>
      <${MenuSep} />
      <${MenuItem} icon="info" onClick=${() => copyText(JSON.stringify(message.meta, null, 2))}>Copy reply details<//>
    <//>`}
  </div>`;
}
