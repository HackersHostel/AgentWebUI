// Placeholder client until the designed one replaces it. No build step, no dependencies.
"use strict";

const $ = (id) => document.getElementById(id);
const state = { config: null, chats: [], chat: null, running: false, reply: null };

async function api(path, options = {}) {
  const init = { ...options, headers: { ...(options.headers || {}) } };
  if (init.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(init.body);
  }
  const response = await fetch(path, init);
  if (response.status === 401) { showSignin(); throw new Error("sign in first"); }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `${response.status}`);
  }
  return response.status === 204 ? null : response;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}

// --- sign in ---
function showSignin() { $("app").hidden = true; $("signin").hidden = false; $("password").focus(); }
$("signin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("signin-error").textContent = "";
  try {
    await api("/api/login", { method: "POST", body: { password: $("password").value } });
    $("signin").hidden = true;
    start();
  } catch (error) { $("signin-error").textContent = error.message; }
});

// --- chats ---
async function loadChats() {
  state.chats = await (await api("/api/chats")).json();
  const list = $("chats");
  list.replaceChildren(...state.chats.map((chat) => el("li", { class: chat.id === state.chat?.id ? "active" : "" },
    el("a", { href: `#${chat.id}`, title: chat.title }, chat.title || "New chat",
      el("div", { class: "kind" }, `${chat.kind === "agent" ? "Agent" : "Model"} · ${chat.target}${chat.running ? " · running" : ""}`)),
    el("button", { "aria-label": "Rename", onclick: () => renameChat(chat) }, "✎"),
    el("button", { "aria-label": "Delete", onclick: () => deleteChat(chat) }, "✕"))));
}

async function renameChat(chat) {
  const title = prompt("Rename chat", chat.title);
  if (title == null) return;
  await api(`/api/chats/${chat.id}`, { method: "PATCH", body: { title } });
  loadChats();
}

async function deleteChat(chat) {
  if (!confirm(`Delete "${chat.title || "New chat"}"?`)) return;
  await api(`/api/chats/${chat.id}`, { method: "DELETE" });
  if (state.chat?.id === chat.id) location.hash = "";
  loadChats();
}

function fillTargets() {
  const select = $("target");
  const models = state.config.models.filter((m) => m.model);
  const groups = [];
  if (state.config.agents.length) {
    groups.push(el("optgroup", { label: "Agents" },
      ...state.config.agents.map((a) => el("option", { value: `agent:${a.id}` }, a.name))));
  }
  const byProvider = {};
  for (const m of models) (byProvider[m.provider_name] ||= []).push(m);
  for (const [name, list] of Object.entries(byProvider)) {
    groups.push(el("optgroup", { label: name }, ...list.map((m) => el("option", { value: `model:${m.id}` }, m.model))));
  }
  select.replaceChildren(...groups);
  const saved = localStorageGet("awl.target");
  if (saved && [...select.options].some((o) => o.value === saved)) select.value = saved;
  onTargetChange();
}

function onTargetChange() {
  const value = $("target").value;
  localStorageSet("awl.target", value);
  const agent = value.startsWith("agent:") && state.config.agents.find((a) => `agent:${a.id}` === value);
  $("cwd").hidden = !agent;
  if (agent && !$("cwd").value) $("cwd").value = agent.cwd;
}
$("target").addEventListener("change", () => { $("cwd").value = ""; onTargetChange(); });

function localStorageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function localStorageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }

async function openChat(id) {
  document.querySelector(".app").classList.remove("open");
  if (!id) { state.chat = null; renderEmpty(); loadChats(); return; }
  const chat = await (await api(`/api/chats/${id}`)).json();
  state.chat = chat;
  $("chat-title").textContent = chat.title;
  $("target").hidden = true; $("cwd").hidden = true;
  $("messages").replaceChildren(...chat.messages.map(renderMessage));
  if (chat.kind === "agent") $("chat-title").textContent = `${chat.title} · ${chat.cwd}`;
  loadChats();
  scrollDown();
  if (chat.running) follow(await api(`/api/chats/${id}/events`));
  else setRunning(false);
}

function renderEmpty() {
  $("target").hidden = false; onTargetChange();
  $("chat-title").textContent = "";
  const nothing = !state.config.agents.length && !state.config.models.some((m) => m.model);
  const errors = state.config.models.filter((m) => m.error).map((m) => m.error);
  $("messages").replaceChildren(el("div", { class: "empty" },
    nothing ? "Nothing to chat with yet. Add a PROVIDER_* or AGENT_* entry to .env and restart." : "Pick a model or an agent and send a message.",
    ...errors.map((e) => el("p", { class: "error" }, e))));
  setRunning(false);
}

// --- messages ---
function renderMessage(message) {
  const node = el("div", { class: `msg ${message.role}` });
  if (message.role === "user") { node.append(el("div", { class: "body" }, message.content)); return node; }
  for (const part of message.parts.length ? message.parts : [{ type: "text", text: message.content }]) node.append(renderPart(part));
  const meta = message.meta || {};
  if (meta.error) node.append(el("div", { class: "error" }, meta.error));
  if (meta.stop_reason === "cancelled") node.append(el("div", { class: "meta" }, "Stopped"));
  return node;
}

function renderPart(part) {
  if (part.type === "text") return el("div", { class: "body" }, part.text);
  if (part.type === "thought") return el("details", { class: "thought" }, el("summary", {}, "Thinking"), el("div", {}, part.text));
  if (part.type === "plan") return el("ol", { class: "plan" }, ...part.items.map((i) => el("li", { class: i.status }, i.text)));
  if (part.type === "tool") {
    const details = el("details", { class: "tool" },
      el("summary", {}, `${part.title || part.kind || "Tool"} `, el("span", { class: "status" }, part.status)));
    if (part.locations.length) details.append(el("div", { class: "meta" }, part.locations.join(", ")));
    if (part.output) details.append(el("pre", {}, part.output));
    for (const diff of part.diffs) details.append(renderDiff(diff));
    return details;
  }
  return el("span");
}

function renderDiff(diff) {
  const pre = el("pre", { class: "diff" }, el("div", { class: "meta" }, diff.path));
  const old = (diff.old || "").split("\n"), next = (diff.new || "").split("\n");
  const oldSet = new Set(old), newSet = new Set(next);
  for (const line of old) if (!newSet.has(line)) pre.append(el("div", { class: "del" }, `- ${line}`));
  for (const line of next) if (!oldSet.has(line)) pre.append(el("div", { class: "add" }, `+ ${line}`));
  return pre;
}

function scrollDown() { const box = $("messages"); box.scrollTop = box.scrollHeight; }

// --- sending and streaming ---
function setRunning(running) {
  state.running = running;
  $("send").hidden = running; $("stop").hidden = !running;
}

$("composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("input").value.trim();
  if (!text || state.running) return;
  try {
    if (!state.chat) {
      const body = { target: $("target").value };
      if (!$("cwd").hidden) body.cwd = $("cwd").value;
      const chat = await (await api("/api/chats", { method: "POST", body })).json();
      state.chat = { ...chat, messages: [] };
      history.replaceState(null, "", `#${chat.id}`);
      $("messages").replaceChildren();
      $("target").hidden = true; $("cwd").hidden = true;
    }
    $("input").value = "";
    setRunning(true);
    follow(await api(`/api/chats/${state.chat.id}/messages`, { method: "POST", body: { text } }));
  } catch (error) {
    setRunning(false);
    $("messages").append(el("div", { class: "msg error" }, error.message));
  }
});

$("input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("composer").requestSubmit(); }
});
$("stop").addEventListener("click", () => state.chat && api(`/api/chats/${state.chat.id}/cancel`, { method: "POST" }));

async function follow(response) {
  if (!response) return;
  setRunning(true);
  const chatId = state.chat.id;
  const reply = { node: el("div", { class: "msg assistant" }), parts: [], text: null, questions: {} };
  let appended = false;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
      if (!frame.startsWith("data: ") || state.chat?.id !== chatId) continue;
      const event = JSON.parse(frame.slice(6));
      if (event.type === "user") {
        if (!state.chat.messages.some((m) => m.id === event.message.id)) {
          $("messages").append(renderMessage(event.message));
          state.chat.messages.push(event.message);
        }
        continue;
      }
      if (!appended) { $("messages").append(reply.node); appended = true; }
      handleEvent(reply, event);
      scrollDown();
    }
  }
  if (state.chat?.id === chatId) setRunning(false);
  loadChats();
}

function handleEvent(reply, event) {
  const last = reply.parts[reply.parts.length - 1];
  if (event.type === "delta" || event.type === "thought") {
    const kind = event.type === "delta" ? "text" : "thought";
    if (last && last.part.type === kind) { last.part.text += event.text; last.node.replaceWith(last.node = renderPart(last.part)); }
    else { const part = { type: kind, text: event.text }; const node = renderPart(part); reply.node.append(node); reply.parts.push({ part, node }); }
  } else if (event.type === "plan" || event.type === "tool") {
    const found = reply.parts.find((p) => (event.type === "plan" ? p.part.type === "plan" : p.part.id === event.part.id));
    const node = renderPart(event.part);
    if (found) { if (found.node.open) node.open = true; found.node.replaceWith(node); found.node = node; found.part = event.part; }
    else { reply.node.append(node); reply.parts.push({ part: event.part, node }); }
  } else if (event.type === "permission") {
    const card = el("div", { class: "permission" }, el("strong", {}, event.title),
      el("div", { class: "options" }, ...event.options.map((o) => el("button", {
        class: o.kind.startsWith("allow") ? "primary" : "",
        onclick: () => api(`/api/chats/${state.chat.id}/permissions/${event.id}`, { method: "POST", body: { option: o.id } }),
      }, o.name))));
    reply.questions[event.id] = card;
    reply.node.append(card);
  } else if (event.type === "permission_answered") {
    const card = reply.questions[event.id];
    if (card) card.replaceWith(el("div", { class: "meta" }, event.option ? `Answered: ${event.option}` : "No answer"));
  } else if (event.type === "notice") {
    reply.node.append(el("div", { class: "notice" }, event.text));
  } else if (event.type === "error") {
    reply.node.append(el("div", { class: "error" }, event.message));
  } else if (event.type === "message") {
    state.chat.messages.push(event.message);
    const meta = event.message.meta || {};
    if (meta.stop_reason === "cancelled") reply.node.append(el("div", { class: "meta" }, "Stopped"));
  }
}

// --- start ---
$("new-chat").addEventListener("click", () => { location.hash = ""; openChat(null); $("input").focus(); });
$("toggle").addEventListener("click", () => document.querySelector(".app").classList.toggle("open"));
window.addEventListener("hashchange", () => openChat(location.hash.slice(1)));

async function start() {
  const session = await (await fetch("/api/session")).json();
  if (session.password_required && !session.signed_in) return showSignin();
  state.config = await (await api("/api/config")).json();
  $("app").hidden = false;
  fillTargets();
  await openChat(location.hash.slice(1));
  $("input").focus();
}
start();
