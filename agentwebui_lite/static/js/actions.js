// Everything the screens do: load, send, stream, stop, answer, retry, switch, and move between screens.
import { api, readEvents, store, local, navigate, toast, ApiError } from './lib.js';

export async function loadConfig() {
  const config = await api('/api/config');
  store.set({ config });
  return config;
}

export async function loadChats() {
  try {
    const chats = await api('/api/chats');
    const chat = store.get().chat;
    const fresh = chat && chats.find((c) => c.id === chat.id);
    store.set(fresh && fresh.title !== chat.title ? { chats, chat: { ...chat, title: fresh.title } } : { chats });
  }
  catch (e) { if (e.status !== 401) store.set({ offline: e.status === 0 }); }
}

export function targets(config = store.get().config) {
  if (!config) return [];
  return [
    ...config.agents.map((a) => ({ value: `agent:${a.id}`, kind: 'agent', name: a.name, agent: a })),
    ...config.models.map((m) => ({ value: `model:${m.id}`, kind: 'model', name: m.model, model: m })),
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
  const [first, second] = path.split('/');
  if (first === 'c' && second) return { name: 'chat', id: second };
  if (first === 'settings') return { name: 'settings', section: second || 'appearance' };
  if (!first) return { name: 'home' };
  return { name: 'missing' };
}

export async function onRoute() {
  const route = parseRoute();
  store.set({ route, drawer: false });
  if (route.name === 'chat') await openChat(route.id);
  else store.set({ chat: null });
}

export function newChat(target) {
  if (target) store.set({ draftTarget: target });
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
    case 'plan': case 'tool':
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
    case 'error':
      return { ...live, error: event.message };
    default:
      return live;
  }
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
        if (chat?.id === id) {
          const modes = live.modes;
          store.set({ chat: { ...chat, messages: [...chat.messages, event.message], agent: modes ? { ...(chat.agent || {}), connected: true, modes } : chat.agent } });
        }
        live = { ...live, parts: [], error: null, done: true };
      } else if (event.type === 'end') {
        live = { ...live, running: false, waiting: false, following: false };
      } else {
        live = fold(live, event);
      }
    }
    setLive(id, live);
    if (events.some((e) => e.type === 'end')) {
      loadChats();
      notifyDone(id);
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

export async function send(text, { target, cwd } = {}) {
  const state = store.get();
  let chat = state.chat;
  try {
    if (!chat || state.route.name !== 'chat') {
      chat = await api('/api/chats', { method: 'POST', body: { target, cwd } });
      chat = { ...chat, title: text.split('\n')[0].slice(0, 60) };
      store.set({ chat: { ...chat, messages: [], running: true }, draftTarget: null });
      store.set((s) => ({ chats: [{ ...chat, title: text.split('\n')[0].slice(0, 60), running: true }, ...s.chats] }));
      history.pushState(null, '', `#/c/${chat.id}`);
      store.set({ route: { name: 'chat', id: chat.id } });
    }
    setLive(chat.id, { running: true, parts: [], error: null, following: true, sentAt: Date.now() });
    const response = await api(`/api/chats/${chat.id}/messages`, { method: 'POST', body: { text }, raw: true });
    loadChats();
    await follow(chat.id, response);
    return true;
  } catch (e) {
    if (chat?.id) setLive(chat.id, { running: false, following: false });
    toast(e instanceof ApiError ? e.message : 'Couldn’t send the message.');
    return false;
  }
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

export async function switchModel(chatId, target) {
  try {
    const updated = await api(`/api/chats/${chatId}`, { method: 'PATCH', body: { target } });
    const chat = store.get().chat;
    if (chat?.id === chatId) store.set({ chat: { ...chat, ...updated } });
    loadChats();
  } catch (e) { toast(e.message); }
}

export async function renameChat(id, title) {
  try {
    await api(`/api/chats/${id}`, { method: 'PATCH', body: { title } });
    const chat = store.get().chat;
    if (chat?.id === id) store.set({ chat: { ...chat, title } });
    await loadChats();
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

// --- browser notifications when a reply needs you or finishes while the tab is hidden ---
function notify(title, body, id) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: id, icon: '/assets/logo.svg' });
    n.onclick = () => { window.focus(); navigate(`#/c/${id}`); n.close(); };
  } catch { /* not shown */ }
}
function chatTitle(id) { return store.get().chats.find((c) => c.id === id)?.title || 'A chat'; }
function notifyWaiting(id) { notify('Waiting for you', `${chatTitle(id)} needs your answer.`, id); }
function notifyDone(id) { notify('Reply finished', chatTitle(id), id); }
