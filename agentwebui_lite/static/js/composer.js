// The composer (Main, Home, ChatMore, Agent chat and Agent blocks boards): Send turns into Stop while a reply runs.
import { html, useState, useRef, useEffect, useLayoutEffect, store, useStore, cx, basename, providerGradient, AGENT_GRADIENT, local, toast, api } from './lib.js';
import { Icon } from './icons.js';
import { Menu, MenuItem, MenuHead, MenuSep, useToggle } from './ui.js';
import { send, stop, describeTarget, openPicker, setMode, setConfig, loadAgentOptions, upload, optionChoices, choiceName } from './actions.js';
import { Attachments } from './messages.js';
import { useDictation, canDictate } from './voice.js';

export function TargetButton({ value, onClick, big }) {
  const info = describeTarget(value);
  const gradient = !info ? 'var(--bg-active)' : info.kind === 'agent' ? AGENT_GRADIENT : providerGradient(info.model?.provider, info.model?.local);
  return html`<button class="target-btn" style=${big ? 'height: 32px' : ''} onClick=${onClick} aria-haspopup="dialog" title="Switch model">
    <span class="tdot" style=${`background: ${gradient}`}></span>
    <span class="tname">${info ? info.name : 'Choose a model'}</span>
    <${Icon} name="chevron-down" size=${14} style="color: var(--tx-3)" />
  </button>`;
}

export function Composer({ chat, target, onTarget, cwd, onCwd, agentConfig, onAgentConfig, project, onProject, temporary, big = false, live }) {
  const { config, prefs, projects } = useStore((s) => ({ config: s.config, prefs: s.chatPrefs, projects: s.projects }));
  const [text, setText] = useState(() => (chat ? '' : store.get().draftText || ''));
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [hotCommand, setHotCommand] = useState(0);
  const area = useRef(null);
  const picker = useRef(null);
  const photos = useRef(null);
  const plus = useToggle();
  const projectMenu = useToggle();
  const running = !!live?.running;
  const waiting = !!live?.waiting;
  const info = describeTarget(target);
  const isAgent = info?.kind === 'agent';
  const dictation = useDictation((words) => setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}${words}`));

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, big ? 280 : 220)}px`;
  }, [text]);
  useEffect(() => {
    const fill = (e) => { setText(e.detail); area.current?.focus(); };
    const attach = (e) => attachFiles(e.detail);
    const browse = () => picker.current?.click();
    window.addEventListener('awl:prefill', fill);
    window.addEventListener('awl:attach', attach);
    window.addEventListener('awl:upload', browse);
    return () => {
      window.removeEventListener('awl:prefill', fill);
      window.removeEventListener('awl:attach', attach);
      window.removeEventListener('awl:upload', browse);
    };
  }, []);
  useEffect(() => { if (!chat) store.set({ draftText: text }); }, [text]);

  async function attachFiles(list) {
    for (const file of list) {
      setBusy((b) => [...b, file.name]);
      try { const saved = await upload(file); setFiles((f) => [...f, saved]); }
      catch (e) { toast(e.message); }
      finally { setBusy((b) => b.filter((n) => n !== file.name)); }
    }
  }
  const attachPaths = async (entries) => {
    for (const entry of entries) {
      setBusy((b) => [...b, entry.name]);
      try { const saved = await api('/api/files', { method: 'POST', body: { path: entry.path } }); setFiles((f) => [...f, saved]); }
      catch (e) { toast(e.message); }
      finally { setBusy((b) => b.filter((n) => n !== entry.name)); }
    }
  };

  const commands = isAgent ? (live?.commands || chat?.agent?.commands || []) : [];
  const slash = isAgent && /^\/\S*$/.test(text) ? commands.filter((c) => `/${c.name}`.startsWith(text)) : [];
  useEffect(() => setHotCommand(0), [text]);

  const submit = async () => {
    const message = text.trim();
    if ((!message && !files.length) || running || !target || busy.length) return;
    dictation.stop();
    const sent = files;
    setText('');
    setFiles([]);
    if (!chat) store.set({ draftText: '' });
    const ok = await send(message, { target, cwd: isAgent ? cwd : undefined, files: sent, config: isAgent ? agentConfig : undefined, project, temporary });
    if (!ok) { setText(message); setFiles(sent); }
  };
  const onKey = (e) => {
    if (slash.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHotCommand((hotCommand + 1) % slash.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHotCommand((hotCommand - 1 + slash.length) % slash.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); setText(`/${slash[hotCommand].name} `); return; }
    }
    const enterSends = prefs?.enterToSend !== false;
    if (e.key === 'Enter' && !e.isComposing && (enterSends ? !e.shiftKey : (e.metaKey || e.ctrlKey))) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && running && chat) { e.preventDefault(); stop(chat.id); }
  };
  const onPaste = (e) => {
    const pasted = [...(e.clipboardData?.files || [])];
    if (pasted.length) { e.preventDefault(); attachFiles(pasted); }
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) attachFiles([...e.dataTransfer.files]);
  };
  const name = info?.name || 'the model';
  const placeholder = dictation.listening ? 'Listening…'
    : big ? (temporary ? 'Ask anything. This chat won’t be saved.' : 'How can I help?')
    : waiting ? 'Answer above, or reply in your own words…'
    : running && isAgent ? 'Add to the task or redirect…'
    : `Reply to ${name}…`;
  const pickTarget = () => openPicker({ value: target, onPick: onTarget, chat, tab: chat && isAgent ? 'agents' : undefined });
  const roots = config?.roots || [];
  const currentProject = projects.find((p) => p.id === (chat ? chat.project_id : project));
  const startVoice = () => store.set({ voice: { active: true, target: info?.name, send: (words) => send(words, { target, cwd: isAgent ? cwd : undefined, config: isAgent ? agentConfig : undefined, project, temporary }) } });

  return html`<div class=${cx('composer', big && 'big', dragging && 'dragging')}
    onDragOver=${(e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragging(true); } }}
    onDragLeave=${(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }} onDrop=${onDrop}>
    ${dragging && html`<div class="drop-hint"><${Icon} name="upload" size=${20} /><b>Drop files to attach</b><span>Up to ${config?.upload_mb || 25} MB each · images, PDFs, text and code</span></div>`}
    ${isAgent && html`<${AgentBar} chat=${chat} info=${info} cwd=${cwd} onCwd=${onCwd} live=${live} onPick=${pickTarget} draft=${agentConfig} onDraft=${onAgentConfig} />`}
    ${(files.length > 0 || busy.length > 0) && html`<div style="padding: 10px 12px 0"><${Attachments} files=${files} busy=${busy} onRemove=${(id) => setFiles(files.filter((f) => f.id !== id))} /></div>`}
    ${slash.length > 0 && html`<div class="slash" role="listbox" aria-label="Commands">${slash.map((c, i) => html`<button key=${c.name} role="option" aria-selected=${i === hotCommand}
      class=${cx('mi', i === hotCommand && 'hot')} onMouseEnter=${() => setHotCommand(i)} onClick=${() => { setText(`/${c.name} `); area.current?.focus(); }}>
      <span class="mono" style="color: var(--ac-tx)">/${c.name}</span><span style="flex: 1; color: var(--tx-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${c.description}</span>
      ${c.hint && html`<span class="k">${c.hint}</span>`}</button>`)}</div>`}
    <label for="composer" class="sr">Message</label>
    <textarea id="composer" ref=${area} rows=${big ? 3 : 2} class="bare" placeholder=${placeholder} value=${text}
      onInput=${(e) => setText(e.target.value)} onKeyDown=${onKey} onPaste=${onPaste}></textarea>
    ${dictation.interim && html`<div class="interim">${dictation.interim}</div>`}
    <div class="composer-bar">
      <button class=${cx('ib attach', plus.open && 'on')} ref=${plus.ref} aria-label="Add files and more" title="Add files and more" aria-haspopup="menu" aria-expanded=${plus.open} onClick=${plus.toggle}><${Icon} name="plus" /></button>
      <input type="file" multiple hidden ref=${picker} onChange=${(e) => { attachFiles([...e.target.files]); e.target.value = ''; }} />
      <input type="file" accept="image/*" capture="environment" multiple hidden ref=${photos} onChange=${(e) => { attachFiles([...e.target.files]); e.target.value = ''; }} />
      ${big && !temporary && html`<button class=${cx('chip', currentProject && 'on')} ref=${projectMenu.ref} aria-haspopup="menu" onClick=${projectMenu.toggle}>
        <${Icon} name="layers" size=${14} />${currentProject ? currentProject.name : 'No project'}</button>`}
      ${temporary && html`<span class="chip on" title="Not saved; gone when you leave"><${Icon} name="temporary" size=${14} />Temporary</span>`}
      <span style="flex: 1"></span>
      ${!isAgent && html`<${TargetButton} value=${target} big=${big} onClick=${pickTarget} />`}
      ${canDictate && html`<button class=${cx('ib', dictation.listening && 'rec')} aria-label=${dictation.listening ? 'Stop dictating' : 'Dictate'} aria-pressed=${dictation.listening}
        title=${dictation.listening ? 'Stop dictating' : 'Dictate'} style="width: 30px; height: 30px" onClick=${dictation.toggle}><${Icon} name="mic" /></button>`}
      ${canDictate && !text.trim() && !files.length && !running && target && html`<button class="round-send voice-btn" aria-label="Voice mode" title="Voice mode" onClick=${startVoice}
        style=${big ? 'width: 34px; height: 34px' : ''}><${Icon} name="waveform" /></button>`}
      ${running
        ? html`<button class="round-send" aria-label="Stop reply" title="Stop  Esc" onClick=${() => stop(chat.id)}><span class="stop"></span></button>`
        : (text.trim() || files.length || !canDictate || !target) && html`<button class="round-send" aria-label="Send" title="Send  ↵" disabled=${(!text.trim() && !files.length) || !target || busy.length > 0} onClick=${submit}
            style=${big ? 'width: 34px; height: 34px' : ''}><${Icon} name="send" /></button>`}
    </div>
    ${plus.open && html`<${Menu} anchor=${plus.ref} onClose=${plus.close} label="Add" width=${230}>
      <${MenuItem} icon="upload" onClick=${() => picker.current?.click()}>Upload files<//>
      <${MenuItem} icon="camera" onClick=${() => photos.current?.click()}>Add photos<//>
      ${roots.length > 0 && html`<${MenuItem} icon="folder-open" onClick=${() => store.set({ overlay: { type: 'files', mode: 'files', start: chat?.cwd || cwd, onPick: attachPaths } })}>From files<//>`}
      ${canDictate && html`<${MenuSep} /><${MenuItem} icon="waveform" onClick=${startVoice}>Voice mode<//>`}
    <//>`}
    ${projectMenu.open && html`<${Menu} anchor=${projectMenu.ref} onClose=${projectMenu.close} label="Project" width=${260}>
      <${MenuHead}>Project<//>
      <${MenuItem} radio checked=${!currentProject} onClick=${() => onProject?.(null)}>No project<//>
      ${projects.map((p) => html`<${MenuItem} key=${p.id} radio checked=${currentProject?.id === p.id} desc=${p.folder ? basename(p.folder) : undefined} onClick=${() => onProject?.(p.id)}>${p.name}<//>`)}
      <${MenuSep} />
      <${MenuItem} icon="plus" onClick=${() => store.set({ overlay: { type: 'project' } })}>New project…<//>
    <//>`}
  </div>`;
}

// What the model menu lists: the chat's live options, or for a new chat the agent's cached ones with the draft
// choices on top.
function agentOptions(chat, live, agent, draft) {
  if (chat) return live?.config || chat.agent?.config || null;
  if (!agent?.options) return null;
  return agent.options.map((o) => {
    const value = draft?.[o.id];
    if (value === undefined) return o;
    if (o.type === 'boolean' ? typeof value === 'boolean' : optionChoices(o).some((c) => c.value === value)) return { ...o, currentValue: value };
    return o;
  });
}

const CATEGORY_ORDER = { model: 0, thought_level: 1, model_config: 2 };

function modelLabel(options) {
  const model = options.find((o) => o.category === 'model' && o.type === 'select');
  const effort = options.find((o) => o.category === 'thought_level' && o.type === 'select');
  return [model && choiceName(model), effort && choiceName(effort)].filter(Boolean).join(' · ');
}

function AgentBar({ chat, info, cwd, onCwd, live, onPick, draft, onDraft }) {
  const config = useStore((s) => s.config);
  const modeMenu = useToggle();
  const modelMenu = useToggle();
  const [probing, setProbing] = useState(false);
  const agent = config?.agents.find((a) => a.id === info.agent?.id);
  const options = agentOptions(chat, live, agent, draft);
  const modes = live?.modes || chat?.agent?.modes;
  const current = modes?.available.find((m) => m.id === modes.current);
  const folder = chat ? chat.cwd : cwd;
  const connected = !!(live?.running || chat?.agent?.connected);
  const running = !!live?.running;
  const status = live?.waiting ? ['var(--warn)', 'Waiting for you'] : running ? ['var(--ac-tx)', 'Working'] : connected ? ['var(--ok)', 'Connected'] : ['var(--tx-3)', chat ? 'Starts when you send' : 'Not started'];
  const hasModel = options ? options.some((o) => o.category === 'model') : !chat && agent && agent.options == null;
  useEffect(() => {
    const open = () => { if (hasModel) modelMenu.setOpen(true); };
    window.addEventListener('awl:model-menu', open);
    return () => window.removeEventListener('awl:model-menu', open);
  }, [hasModel]);
  const openModels = async () => {
    modelMenu.toggle();
    if (!chat && agent && agent.options == null && !probing) {
      setProbing(true);
      try { await loadAgentOptions(agent.id); } catch (e) { toast(e.message); modelMenu.close(); }
      finally { setProbing(false); }
    }
  };
  const choose = (option, value) => {
    if (chat) setConfig(chat.id, option, value);
    else onDraft?.({ ...(draft || {}), [option.id]: value });
  };
  const pickFolder = () => store.set({ overlay: { type: 'files', mode: 'folder', start: cwd, onPick: onCwd, title: `Where should ${info.name} work?` } });
  return html`<div class="agent-bar">
    <button class="ab" onClick=${chat ? undefined : onPick} disabled=${!!chat} title=${chat ? info.name : 'Choose an agent'}>
      <${Icon} name="agent" size=${14} />${info.name}${!chat && html`<${Icon} name="chevron-down" size=${13} />`}
    </button>
    ${hasModel && html`<${Icon} name="chevron-right" size=${12} style="color: var(--tx-3)" />
      <button class=${cx('ab', modelMenu.open && 'on')} ref=${modelMenu.ref} aria-haspopup="menu" aria-expanded=${modelMenu.open} onClick=${openModels}
        title=${running ? 'Change the model after this reply' : 'Model'} disabled=${running}>
        <${Icon} name="model" size=${14} />${options ? modelLabel(options) || 'Model' : 'Model'}<${Icon} name="chevron-down" size=${13} />
      </button>`}
    <${Icon} name="chevron-right" size=${12} style="color: var(--tx-3)" />
    <button class="ab" title=${folder} onClick=${chat ? undefined : pickFolder} disabled=${!!chat}>
      <${Icon} name="folder" size=${14} /><span class="mono-ish">${basename(folder) || 'Folder'}</span>${!chat && html`<${Icon} name="chevron-down" size=${13} />`}
    </button>
    ${modes && modes.available.length > 0 && html`<span class="vsep"></span><button class=${cx('ab', modeMenu.open && 'on')} ref=${modeMenu.ref} aria-haspopup="menu"
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
    ${modelMenu.open && html`<${ModelMenu} anchor=${modelMenu.ref} onClose=${modelMenu.close} options=${options} probing=${probing} running=${running} onChoose=${choose} agent=${info.name} />`}
  </div>`;
}

function ModelMenu({ anchor, onClose, options, probing, running, onChoose, agent }) {
  const [find, setFind] = useState('');
  if (probing || !options) {
    return html`<${Menu} anchor=${anchor} onClose=${onClose} label="Model" width=${300} up=${true}>
      <div style="display: flex; align-items: center; gap: 10px; padding: 14px 10px; font-size: 13px; color: var(--tx-2)"><span class="spinner"></span>Starting ${agent} to see its models…</div>
    <//>`;
  }
  const shown = options.filter((o) => o.category !== 'mode').sort((a, b) => (CATEGORY_ORDER[a.category] ?? 3) - (CATEGORY_ORDER[b.category] ?? 3) || (a.type === 'boolean') - (b.type === 'boolean'));
  const selects = shown.filter((o) => o.type === 'select');
  const toggles = shown.filter((o) => o.type === 'boolean');
  const needle = find.trim().toLowerCase();
  return html`<${Menu} anchor=${anchor} onClose=${onClose} label="Model" width=${340} up=${true} class="model-menu">
    ${running && html`<div class="mh">Change the model after this reply</div>`}
    ${selects.map((option, si) => {
      const many = optionChoices(option).length > 8;
      const groups = (option.options || []).some((o) => o.options) ? option.options : [{ name: '', options: option.options || [] }];
      return html`<div key=${option.id}>
        ${si > 0 && html`<${MenuSep} />`}
        <${MenuHead}>${option.category === 'model' ? 'Model' : option.category === 'thought_level' ? 'Effort' : option.name}<//>
        ${many && option.category === 'model' && html`<div class="menu-find"><${Icon} name="search" size=${14} /><label class="sr" for="model-find">Search models</label>
          <input id="model-find" class="bare" placeholder="Search models" value=${find} onInput=${(e) => setFind(e.target.value)} onKeyDown=${(e) => e.stopPropagation()} /></div>`}
        ${groups.map((g) => html`<div key=${g.name}>
          ${g.name && html`<div class="mh" style="padding-top: 4px">${g.name}</div>`}
          ${g.options.filter((c) => !needle || option.category !== 'model' || `${c.name} ${c.value}`.toLowerCase().includes(needle)).map((c) => html`<${MenuItem} key=${c.value}
            radio checked=${c.value === option.currentValue} desc=${c.description || undefined} disabled=${running}
            onClick=${() => c.value !== option.currentValue && onChoose(option, c.value)}>${c.name}<//>`)}
        </div>`)}
      </div>`;
    })}
    ${toggles.length > 0 && html`${selects.length > 0 && html`<${MenuSep} />`}${toggles.map((option) => html`<button key=${option.id} class="mi" role="menuitemcheckbox"
      aria-checked=${String(!!option.currentValue)} disabled=${running} onClick=${() => onChoose(option, !option.currentValue)} style=${option.description ? 'height: auto; padding: 7px 8px' : ''}>
      <span style="display: flex; flex-direction: column; flex: 1; min-width: 0"><span>${option.name}</span>${option.description && html`<span style="font-size: 12px; color: var(--tx-3)">${option.description}</span>`}</span>
      <span class=${cx('sw', option.currentValue && 'on')} aria-hidden="true"><span></span></span></button>`)}`}
    ${!selects.length && !toggles.length && html`<div class="mh">${agent} offers no choices here.</div>`}
  <//>`;
}

// The model a new agent chat starts on: this browser's last choice for that agent, else .env's AGENT_<ID>_MODEL.
export function startingConfig(agentId) {
  return local.get(`agentConfig:${agentId}`, null);
}
