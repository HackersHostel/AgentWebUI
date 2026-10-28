// Everything the screens do: load, send, stream, stop, answer, retry, switch, and move between screens.
import { api, readEvents, store, local, navigate, toast, ApiError, readBase64, saveFile } from './lib.js';
import { logoUrl } from './brand.js';

export async function loadConfig() {
  const config = await api('/api/config');
  store.set({ config });
  followChecks(config);
  return config;
}

// Where each provider runs is checked in the background (#16): read the config again until no provider is checking.
let following = 0;
export function followChecks(config, tries = 0) {
  clearTimeout(following);
  if (tries >= 20 || !config?.providers?.some((p) => p.checking)) return;
  following = setTimeout(async () => {
    try {
      const next = await api('/api/config');
      store.set({ config: next });
      followChecks(next, tries + 1);
    } catch { /* the next loadConfig() tries again */ }
  }, 1000);
}

export async function loadChats() {
  try {
    const chats = await api('/api/chats');
    const chat = store.get().chat;
    const fresh = chat && chats.find((c) => c.id === chat.id);
    const patch = fresh && (fresh.title !== chat.title || fresh.pinned !== chat.pinned || fresh.archived !== chat.archived || fresh.project_id !== chat.project_id)
      ? { chats, chat: { ...chat, title: fresh.title, pinned: fresh.pinned, archived: fresh.archived, project_id: fresh.project_id } } : { chats };
    store.set(patch);
  }
  catch (e) { if (e.status !== 401) store.set({ offline: e.status === 0 }); }
}

export async function loadProjects() {
  try { store.set({ projects: await api('/api/projects') }); }
  catch { /* the sidebar shows none */ }
}

export function targets(config = store.get().config) {
  if (!config) return [];
  const hidden = store.get().chatPrefs?.hiddenModels || {};
  return [
    ...config.agents.map((a) => ({ value: `agent:${a.id}`, kind: 'agent', name: a.name, agent: a })),
    ...config.models.filter((m) => !hidden[`model:${m.id}`]).map((m) => ({ value: `model:${m.id}`, kind: 'model', name: m.model, model: m })),
  ];
}

export function describeTarget(value, config = store.get().config) {
  if (!value || !config) return null;
  const [kind, rest] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
  if (kind === 'agent') {
    const agent = config.agents.find((a) => a.id === rest);
    return { kind, value, name: agent ? agent.name : rest, agent, missing: !agent };
  }
  const model = config.models.find((m) => m.id === rest);
  const name = model ? model.model : rest.slice(rest.indexOf('/') + 1);
  return { kind, value, name, model, provider: model?.provider_name, missing: !model };
}

export const chatTarget = (chat) => (chat && chat.kind ? `${chat.kind}:${chat.target}` : null);

export function defaultTarget() {
  const all = targets();
  const saved = local.get('defaultTarget', null);
  if (saved && all.some((t) => t.value === saved)) return saved;
  return (all.find((t) => t.kind === 'model') || all[0])?.value || null;
}

// --- routing ---
export function parseRoute(hash = location.hash) {
  const path = hash.replace(/^#\/?/, '');
  const [head, query = ''] = path.split('?');
  const [first, second] = head.split('/');
  const params = new URLSearchParams(query);
  if (first === 'c' && second) return { name: 'chat', id: second };
  if (first === 'settings') return { name: 'settings', section: second || 'appearance' };
  if (first === 'files') return { name: 'files', path: params.get('path') || '', file: params.get('file') || '' };
  if (!first) return { name: 'home' };
  return { name: 'missing' };
}

export async function onRoute() {
  const route = parseRoute();
  const previous = store.get().chat;
  store.set({ route, drawer: false });
  // A temporary chat disappears once you leave it.
  if (previous?.temporary && !(route.name === 'chat' && route.id === previous.id)) forgetTemporary(previous.id);
  if (route.name === 'chat') await openChat(route.id);
  else store.set({ chat: null });
}

function forgetTemporary(id) {
  if (store.get().live[id]?.running) return;
  api(`/api/chats/${id}`, { method: 'DELETE' }).catch(() => {});
}

export function newChat(target, { temporary = false, project = null } = {}) {
  const patch = { draftTemporary: temporary };
  if (target) patch.draftTarget = target;
  if (project !== undefined) patch.draftProject = project;
  store.set(patch);
  navigate('#/');
  requestAnimationFrame(() => document.getElementById('composer')?.focus());
}

export async function openChat(id) {
  if (store.get().chat?.id !== id) store.set({ chat: { id, loading: true, messages: [] } });
  try {
    const chat = await api(`/api/chats/${id}`);
    if (store.get().route.id !== id) return;
    store.set({ chat });
    if (chat.running && !store.get().live[id]?.following) {
      setLive(id, { running: true, parts: [], following: true });
      const response = await api(`/api/chats/${id}/events`, { raw: true });
      follow(id, response);
    }
  } catch (e) {
    if (e.status === 404) store.set({ chat: { id, missing: true, messages: [] } });
    else if (e.status !== 401) store.set({ chat: { id, error: e.message, messages: [] } });
  }
}

// --- live replies ---
function setLive(id, patch) {
  store.set((s) => ({ live: { ...s.live, [id]: { ...(s.live[id] || { parts: [] }), ...patch } } }));
}

function upsert(parts, part) {
  const i = parts.findIndex((p) => p.type === part.type && p.id === part.id);
  if (i < 0) return [...parts, part];
  const next = parts.slice();
  next[i] = part;
  return next;
}

function fold(live, event) {
  const parts = live.parts || [];
  switch (event.type) {
    case 'delta':
    case 'thought': {
      const kind = event.type === 'delta' ? 'text' : 'thought';
      const last = parts[parts.length - 1];
      if (last && last.type === kind) return { ...live, parts: [...parts.slice(0, -1), { ...last, text: last.text + event.text }] };
      return { ...live, parts: [...parts, { type: kind, text: event.text, started: Date.now() }] };
    }
    case 'plan': case 'tool': case 'part':
      return { ...live, parts: upsert(parts, event.part) };
    case 'permission':
      return { ...live, parts: upsert(parts, event.part), waiting: true };
    case 'permission_answered': {
      const next = upsert(parts, event.part);
      return { ...live, parts: next, waiting: next.some((p) => p.type === 'permission' && p.state === 'waiting') };
    }
    case 'notice':
      return { ...live, parts: [...parts, { type: 'notice', text: event.text }] };
    case 'modes':
      return { ...live, modes: event.modes };
    case 'config':
      return { ...live, config: event.config, modes: event.modes || live.modes };
    case 'commands':
      return { ...live, commands: event.commands };
    case 'error':
      return { ...live, error: event.message };
    default:
      return live;
  }
}

// What the agent reported during the turn becomes part of the chat's agent state when the turn ends.
function agentState(chat, live) {
  if (chat.kind !== 'agent') return chat.agent;
  const next = { ...(chat.agent || {}), connected: true };
  if (live.modes) next.modes = live.modes;
  if (live.config) next.config = live.config;
  if (live.commands) next.commands = live.commands;
  return next;
}

async function follow(id, response) {
  let queue = [];
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const events = queue;
    queue = [];
    let live = store.get().live[id] || { parts: [] };
    for (const event of events) {
      if (event.type === 'user') {
        const chat = store.get().chat;
        if (chat?.id === id && !chat.messages.some((m) => m.id === event.message.id)) {
          store.set({ chat: { ...chat, messages: [...chat.messages, event.message] } });
        }
      } else if (event.type === 'message') {
        const chat = store.get().chat;
        if (chat?.id === id) store.set({ chat: { ...chat, messages: [...chat.messages, event.message], agent: agentState(chat, live) } });
        live = { ...live, parts: [], error: null, done: true, lastReply: event.message };
      } else if (event.type === 'end') {
        live = { ...live, running: false, waiting: false, following: false };
      } else {
        live = fold(live, event);
      }
    }
    setLive(id, live);
    if (events.some((e) => e.type === 'end')) {
      loadChats();
      notifyDone(id, live);
    }
    if (events.some((e) => e.type === 'permission')) notifyWaiting(id);
  };
  try {
    await readEvents(response, (event) => {
      queue.push(event);
      if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
    });
  } catch {
    // The connection dropped; the reply keeps running on the server and the chat picks it up again on open.
  }
  if (queue.length) flush();
  const live = store.get().live[id];
  if (live?.running) {
    setLive(id, { running: false, following: false });
    if (store.get().chat?.id === id) setTimeout(() => openChat(id), 800);
  }
}

// Send a message. A new chat is created first from the home screen's choices (target, folder, the agent's
// model and options, project, temporary). `edit` sends a new version of an earlier message.
export async function send(text, { target, cwd, files = [], config, project, temporary, edit } = {}) {
  const state = store.get();
  let chat = state.chat;
  try {
    if (!chat || state.route.name !== 'chat') {
      const prefs = state.chatPrefs || {};
      const isModel = target?.startsWith('model:');
      const modelConfig = isModel ? {
        ...(prefs.instructions ? { instructions: prefs.instructions } : {}),
        ...(prefs.temperature != null ? { temperature: prefs.temperature } : {}),
        ...(prefs.maxTokens ? { max_tokens: prefs.maxTokens } : {}),
      } : config;
      chat = await api('/api/chats', { method: 'POST', body: { target, cwd, config: modelConfig, project_id: project || undefined, temporary: !!temporary } });
      const title = (text || files[0]?.name || '').split('\n')[0].slice(0, 60);
      chat = { ...chat, title };
      store.set({ chat: { ...chat, messages: [], running: true }, draftTarget: null, draftTemporary: false });
      if (!chat.temporary) store.set((s) => ({ chats: [{ ...chat, running: true }, ...s.chats] }));
      history.pushState(null, '', `#/c/${chat.id}`);
      store.set({ route: { name: 'chat', id: chat.id } });
    }
    if (edit != null) {
      const at = chat.messages.findIndex((m) => m.id === edit);
      if (at >= 0) store.set({ chat: { ...chat, messages: chat.messages.slice(0, at) } });
    }
    setLive(chat.id, { running: true, parts: [], error: null, following: true, sentAt: Date.now(), voice: state.voice?.active });
    const response = await api(`/api/chats/${chat.id}/messages`, { method: 'POST', body: { text, files: files.map((f) => f.id), edit: edit ?? undefined }, raw: true });
    if (!chat.temporary) loadChats();
    await follow(chat.id, response);
    return true;
  } catch (e) {
    if (chat?.id) setLive(chat.id, { running: false, following: false });
    toast(e instanceof ApiError ? e.message : 'Couldn’t send the message.');
    if (edit != null && chat?.id) openChat(chat.id);
    return false;
  }
}

export async function upload(file) {
  const limit = (store.get().config?.upload_mb || 25) * 1024 * 1024;
  if (file.size > limit) throw new ApiError(413, `${file.name} is larger than ${store.get().config?.upload_mb || 25} MB.`);
  const data = await readBase64(file);
  return api('/api/files', { method: 'POST', body: { name: file.name || 'pasted image.png', type: file.type || '', data } });
}

export async function retry(chatId) {
  const chat = store.get().chat;
  if (chat?.id === chatId) {
    const messages = chat.messages.slice();
    if (messages.length && messages[messages.length - 1].role === 'assistant') messages.pop();
    store.set({ chat: { ...chat, messages } });
  }
  setLive(chatId, { running: true, parts: [], error: null, following: true, sentAt: Date.now() });
  try {
    const response = await api(`/api/chats/${chatId}/retry`, { method: 'POST', raw: true });
    await follow(chatId, response);
  } catch (e) {
    setLive(chatId, { running: false, following: false });
    toast(e.message);
    openChat(chatId);
  }
}

export async function showVersion(chatId, messageId) {
  try {
    const { messages } = await api(`/api/chats/${chatId}/version`, { method: 'POST', body: { message: messageId } });
    const chat = store.get().chat;
    if (chat?.id === chatId) store.set({ chat: { ...chat, messages } });
  } catch (e) { toast(e.message); }
}

export async function stop(chatId) {
  try { await api(`/api/chats/${chatId}/cancel`, { method: 'POST' }); }
  catch (e) { toast(e.message); }
}

export async function answer(chatId, questionId, option) {
  try { await api(`/api/chats/${chatId}/permissions/${questionId}`, { method: 'POST', body: { option } }); }
  catch (e) { toast(e.status === 404 ? 'That question was already answered or has expired.' : e.message); }
}

export async function setMode(chatId, mode) {
  try {
    const { modes } = await api(`/api/chats/${chatId}/mode`, { method: 'POST', body: { mode } });
    const chat = store.get().chat;
    if (chat?.id === chatId) store.set({ chat: { ...chat, agent: { ...(chat.agent || {}), modes } } });
    setLive(chatId, { modes });
  } catch (e) { toast(e.message); }
}

// --- the agent's model, effort and toggles ---
export const optionChoices = (option) => (option.options || []).flatMap((o) => (o.options ? o.options : [o]));
export const choiceName = (option) => optionChoices(option).find((c) => c.value === option.currentValue)?.name || String(option.currentValue);

export async function setConfig(chatId, option, value) {
  const chat = store.get().chat;
  if (!chat || chat.id !== chatId) return;
  const before = chat.agent;
  const optimistic = (before?.config || []).map((o) => (o.id === option.id ? { ...o, currentValue: value } : o));
  store.set({ chat: { ...chat, agent: { ...(before || {}), config: optimistic } } });
  setLive(chatId, { config: undefined });
  try {
    const { config } = await api(`/api/chats/${chatId}/config`, { method: 'POST', body: { id: option.id, value } });
    const current = store.get().chat;
    if (current?.id !== chatId) return;
    const mode = config.find((o) => o.category === 'mode' && o.type === 'select');
    const agent = { ...(current.agent || {}), config };
    if (mode && agent.modes) agent.modes = { ...agent.modes, current: mode.currentValue };
    const note = option.type === 'boolean' ? `${option.name} ${value ? 'on' : 'off'}` : `Switched to ${choiceName({ ...option, currentValue: value })}`;
    const marker = { id: `note-${Date.now()}`, role: 'note', content: note };
    store.set({ chat: { ...current, agent, messages: [...current.messages, marker] } });
    if (option.category === 'model' || option.id === 'model') local.set(`agentConfig:${chat.target}`, { ...local.get(`agentConfig:${chat.target}`, {}), [option.id]: value });
  } catch (e) {
    const current = store.get().chat;
    if (current?.id === chatId) store.set({ chat: { ...current, agent: before } });
    toast(e.message);
  }
}

// The options an agent offers, before any chat with it exists (the server starts it once and remembers).
export async function loadAgentOptions(agentId, refresh = false) {
  const { options } = await api(`/api/agents/${agentId}/options${refresh ? '?refresh=1' : ''}`);
  const config = store.get().config;
  store.set({ config: { ...config, agents: config.agents.map((a) => (a.id === agentId ? { ...a, options } : a)) } });
  return options;
}

export async function switchModel(chatId, target) {
  try {
    const updated = await api(`/api/chats/${chatId}`, { method: 'PATCH', body: { target } });
    const chat = store.get().chat;
    if (chat?.id === chatId) store.set({ chat: { ...chat, ...updated } });
    loadChats();
  } catch (e) { toast(e.message); }
}

export async function updateChat(id, patch, done) {
  try {
    const updated = await api(`/api/chats/${id}`, { method: 'PATCH', body: patch });
    const chat = store.get().chat;
    if (chat?.id === id) store.set({ chat: { ...chat, ...updated } });
    await loadChats();
    if (done) toast(done);
    return updated;
  } catch (e) { toast(e.message); return null; }
}

export const renameChat = (id, title) => updateChat(id, { title });
export const pinChat = (id, pinned) => updateChat(id, { pinned }, pinned ? 'Pinned.' : 'Unpinned.');
export const archiveChat = (id, archived) => updateChat(id, { archived }, archived ? 'Archived. Find it under Archived in the sidebar.' : 'Moved back to your chats.');
export const moveToProject = (id, projectId) => updateChat(id, { project_id: projectId || '' }, projectId ? 'Moved to the project.' : 'Removed from the project.');

export async function cloneChat(id) {
  try {
    const copy = await api(`/api/chats/${id}/clone`, { method: 'POST' });
    await loadChats();
    navigate(`#/c/${copy.id}`);
    toast('Cloned. The copy starts a new agent session when you send.');
  } catch (e) { toast(e.message); }
}

export async function deleteChat(id) {
  try {
    await api(`/api/chats/${id}`, { method: 'DELETE' });
    if (store.get().route.id === id) navigate('#/');
    await loadChats();
    toast('Chat deleted.');
  } catch (e) { toast(e.message); }
}

// Markdown or JSON of the thread on screen, downloaded by the browser.
export async function exportChat(id, format) {
  try {
    const chat = store.get().chat?.id === id ? store.get().chat : await api(`/api/chats/${id}`);
    const name = (chat.title || 'chat').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'chat';
    if (format === 'json') {
      saveFile(`${name}.json`, JSON.stringify({ title: chat.title, kind: chat.kind, target: chat.target, cwd: chat.cwd, created_at: chat.created_at,
        messages: chat.messages.filter((m) => m.role !== 'note').map(({ role, content, parts, meta, created_at }) => ({ role, content, parts, meta, created_at })) }, null, 2), 'application/json');
      return;
    }
    const who = describeTarget(chatTarget(chat))?.name || chat.target;
    const lines = [`# ${chat.title || 'Chat'}`, '', `_${who} · ${new Date(chat.created_at * 1000).toLocaleString()}_`, ''];
    for (const m of chat.messages) {
      if (m.role === 'note') continue;
      lines.push(m.role === 'user' ? '## You' : `## ${m.meta?.agent || who}`, '');
      for (const f of m.meta?.files || []) lines.push(`- Attached: ${f.name}`);
      lines.push(m.content || '', '');
    }
    saveFile(`${name}.md`, lines.join('\n'), 'text/markdown');
  } catch (e) { toast(e.message); }
}

// --- projects ---
export async function saveProject(id, fields) {
  try {
    const project = await api(id ? `/api/projects/${id}` : '/api/projects', { method: id ? 'PATCH' : 'POST', body: fields });
    await loadProjects();
    toast(id ? 'Project saved.' : `Created ${project.name}.`);
    return project;
  } catch (e) { toast(e.message); return null; }
}

export async function deleteProject(id) {
  try {
    await api(`/api/projects/${id}`, { method: 'DELETE' });
    await Promise.all([loadProjects(), loadChats()]);
    toast('Project deleted. Its chats are kept.');
  } catch (e) { toast(e.message); }
}

// --- overlays and layout ---
export const openPalette = () => store.set({ overlay: { type: 'palette' } });
export const openPicker = (options = {}) => store.set({ overlay: { type: 'picker', ...options } });
export function toggleSidebar() {
  if (innerWidth <= 1024) { store.set((s) => ({ drawer: !s.drawer })); return; }
  const next = store.get().sidebar === 'open' ? 'rail' : 'open';
  local.set('sidebar', next);
  store.set({ sidebar: next });
}
export function toggleInspector(tab) {
  store.set((s) => ({ inspector: s.inspector === tab ? null : tab }));
}

// --- telling you when a reply needs you, finishes or fails while you look elsewhere ---
function notify(title, body, id) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: id, icon: logoUrl(store.get().prefs) });
    n.onclick = () => { window.focus(); navigate(`#/c/${id}`); n.close(); };
  } catch { /* not shown */ }
}
function chatTitle(id) { return store.get().chats.find((c) => c.id === id)?.title || 'A chat'; }
function elsewhere(id) { return document.hidden || store.get().chat?.id !== id; }
function notifyWaiting(id) {
  const prefs = store.get().chatPrefs || {};
  if (!prefs.notifyWaiting) return;
  notify('Waiting for you', `${chatTitle(id)} needs your answer.`, id);
  if (prefs.inApp && !document.hidden && store.get().chat?.id !== id) toast(`${chatTitle(id)} is waiting for you.`, { action: 'Open', onAction: () => navigate(`#/c/${id}`) });
}
function notifyDone(id, live) {
  const prefs = store.get().chatPrefs || {};
  const failed = !!live.error;
  if (failed ? !prefs.notifyFail : !prefs.notifyFinish) return;
  notify(failed ? 'A reply failed' : 'Reply finished', chatTitle(id), id);
  if (prefs.inApp && !document.hidden && elsewhere(id)) toast(failed ? `The reply in ${chatTitle(id)} failed.` : `${chatTitle(id)} has a reply.`, { action: 'Open', onAction: () => navigate(`#/c/${id}`) });
}
