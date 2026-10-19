# Roadmap: from 3/10 to 8/10

AgentWebUI Lite is the web interface for our agents (Hermes, Claude Code, Codex) and for model APIs. It will run on our
VPS. This document lists what Lite leaves out of the full AgentWebUI, explains why it scores about 3/10 today, and sets
out the work that takes it to at least 8/10. White label is part of the plan.

Assessed 2026-10-19 against `main` at 6989138 (about 4,000 lines of Python and JavaScript, 21 tests passing).

## Status (2026-10-19)

✅ marks what is built. Beyond the list: the picker card (agents and models ask with a `choices` block), files and
images from agents shown in the chat, and hands-free voice mode in the browser. Still open: 2.1 Hermes end to end (not
installed on the build machine), 2.4 the Account & security page (left out on purpose), 3.4 the prompt library (left
out on purpose), 3.5 the web search toggle (an agent's own toggle already shows in its model menu when it reports
one), 3.6 share links.

## Why it was 3/10

The core works. Model chats stream, and agent chats show steps, plans, diffs and permission cards. Chats survive a
closed tab. Appearance settings are complete. Three things pull the score down:

1. **About 30 controls do nothing.** They are drawn as the design shows them, but clicking one only shows "… isn't
   part of AgentWebUI Lite." Only 4 of the 13 Settings sections open. A product that keeps answering "not here" feels
   broken, even when what it does run works well.
2. **Basics people expect are missing.** You cannot attach a file, edit a sent message, export a chat, or pick the
   model an agent uses (Opus or Sonnet inside Claude Code, for example).
3. **It is not ready for a VPS.** There is no container or service file and no login rate limit. The secure cookie
   relies on the app seeing HTTPS directly, which it won't behind a reverse proxy. An agent can be started in any
   folder on the server.

## What Lite leaves out of the full AgentWebUI

### Drawn on screen but inert

| Area | Controls |
|---|---|
| Settings | Account & security, Chat, Voice, Integrations, Workspaces & Git, People, Roles & access, Defaults, Start page |
| Composer | Attach files, Web search, Project, Dictate |
| Sidebar | Projects, Workspaces, Prompt library, Pin, Move to project, Clone, Share, Archive |
| Chat header | Share, Export |
| Context panel | Temperature, Max reply length |
| Replies | Edit a sent message, Branch, Read aloud, Apply to workspace (Good and Bad only toggle on the page) |
| Home | Temporary chat, Analyze a file, From library |

### Not built at all

- **Identity:** accounts, registration, SSO, 2FA, passkeys.
- **Administration:** admin, roles and access, people, shared providers.
- **Running code and tools:** sandbox, tool calling (web, calculator, time), MCP, tool policies and audit.
- **Knowledge:** memory, knowledge and retrieval (RAG), prompt library and slash commands.
- **Automation:** workflows, agent builder and agents page.
- **Organizing:** projects, folders, sharing, compaction.
- **Agent output panels:** artifacts, diff-first change review, terminal and workspace panels.
- **Usage:** usage, budgets, access tokens and gateway.
- **Data:** backup, import and export, data portability.
- **Other:** plugins, voice mode, installable app, PostgreSQL, Redis, S3, and the agent question cards (ACP has no
  question message yet).

### Out by decision

These stay out even at 8/10:

- **Knowledge and memory (RAG), and the sandbox.** Not needed for now.
- **Multiple accounts, roles and access control.** Lite stays one shared password.
- **A terminal.** The agents run commands on their own.
- **Speech on the server and voice mode.** Voice is what the browser can do (1.10).
- **Our own web search.** Search is the agent's own (3.5).
- **MCP, workflows and the agent builder.** The agents bring their own tools and MCP.

Their controls must be **removed from the screen**, not left inert (see 1.1).

## Size rule

Everything stays as small as it can and still work. Each feature uses something that already exists: the browser,
the `git` command, the agent's own tools, a column or table in SQLite. It is hidden until `.env` turns it on. No new
server dependency, no background service, no second database.

With everything below built, the estimate is about 7,500 lines (4,000 today) and server memory well under 100 MB
(33 MB today).

## What to add

Effort: **S** is under a day, **M** is one to three days, **L** is about a week.

### Tier 1: the basics work (takes it to about 6/10)

| # | Feature | Effort | Notes |
|---|---|---|---|
| 1.1 | ✅ **No dead controls** | S | Every control either works or is hidden. Remove People, Roles & access, Integrations and Share (until 3.6). Hide the rest until the item below builds it. Rule from now on: nothing visible may say "isn't part of Lite". |
| 1.2 | ✅ **Agent › Model › Workspace** | M | Choosing an agent doesn't fix the model. The agent bar reads agent › model › folder. The model menu lists the agent's own models, effort and toggles from ACP `configOptions` (`session/set_config_option`; the legacy `session/set_model` as a fallback). The model can change mid-chat, and the choice survives a restart. The full brief is Milestone 1 in [GOAL.md](GOAL.md). |
| 1.3 | ✅ **Attachments** | M | Images and text files. Model chats send them as message parts, agent chats as ACP `image` and `resource` blocks. Enables Attach files and Analyze a file. |
| 1.4 | ✅ **Edit a sent message** | S | Edit, then answer again from that point; later messages are replaced. No branching. |
| 1.5 | ✅ **Pin and archive chats** | S | One column each in SQLite. The sidebar shows Pinned above the day groups and has an Archived view. |
| 1.6 | ✅ **Export a chat** | S | Markdown and JSON download from the header. |
| 1.7 | ✅ **Temporary chat** | S | A chat that is never written to SQLite and disappears when closed. |
| 1.8 | ✅ **Settings › Chat and Defaults** | S | Default model or agent, system prompt, Enter-to-send, auto title, start page. Kept as browser preferences, with .env defaults. |
| 1.9 | ✅ **Temperature and max length** | S | The context panel already draws them. Send them with model requests. |
| 1.10 | ✅ **Dictation and read aloud** | S | The browser's own speech: speech recognition for Dictate, speech synthesis for Read aloud. Nothing on the server. Each button shows only when the browser supports it and has microphone permission. Settings › Voice holds the language and the voice. |
| 1.11 | ✅ **Branching** | M | Each reply records which message it answers. Editing or regenerating adds a version instead of replacing one, with a "‹ 2 / 3 ›" switcher on the message. Nothing else. |
| 1.12 | ✅ **Clone a chat** | S | Copies the messages into a new chat. An agent chat's copy starts a fresh agent session in the same folder. |

### Tier 2: Hermes and the VPS (takes it to about 7.5/10)

| # | Feature | Effort | Notes |
|---|---|---|---|
| 2.1 | **Hermes as a first-class agent** | S–M | `AGENT_HERMES_COMMAND=hermes acp` is already in `.env.example` but untested: Hermes is not installed on the dev machine. Install it, run the ACP flow end to end (session load, modes, permissions, diffs), and fix what differs. Add a Hermes fake to the tests. |
| 2.2 | ✅ **Deployment** | M | Dockerfile and compose, or a systemd unit, plus a Caddy file for TLS. Turn off SSE buffering at the proxy. Trust `X-Forwarded-Proto` so the cookie is marked secure. Run under a dedicated Unix user. Add a health endpoint and a deploy section in the README. |
| 2.3 | ✅ **Hardening for a public server** | S–M | Login rate limiting and lockout. Restrict agent folders to the same `FILES_ROOTS` that 2.5 uses, so one setting covers both. Add a "sign out everywhere" action that rotates the cookie key. Recommend putting the app behind Tailscale or Cloudflare Access: whoever has the password can make an agent run commands on the VPS. |
| 2.4 | **Account & security, Lite version** | S | One page: where you are signed in, sign out everywhere, and which folders and agents are allowed. Read-only, since the settings live in .env. |
| 2.5 | ✅ **Workspace & Git** | M | `FILES_ROOTS` in .env lists the paths on the VPS that can be browsed. A file tree, then view and edit a file, in the context panel or a page of its own. Git (`status`, `diff`, `commit`, `branch`, `push`, `pull`) runs the server's `git` command. It uses the server's own Git sign-in; give it a deploy key per repository, or a bot account. An agent chat opens on its own folder. No terminal, no full code editor. Fills Workspaces in the sidebar, Settings › Workspaces & Git, and Apply to workspace. |
| 2.6 | ✅ **Backup** | S | Document a copy of `data/chats.db` (SQLite `.backup`) and add a cron line. |

### Tier 3: our product (takes it to 8+/10)

| # | Feature | Effort | Notes |
|---|---|---|---|
| 3.1 | ✅ **White label** | S–M | Set in .env: `BRAND_NAME`, `BRAND_LOGO` (file path or URL), `BRAND_FAVICON`, `BRAND_ACCENT`, `BRAND_THEME` (default theme), `BRAND_GREETING`, `BRAND_POWERED_BY=false`. Served through `/api/config` and `/brand/*`. They apply to the page title, sidebar, sign-in, home greeting, favicon and app manifest. The current logo and name become the defaults. Removing the visible "AgentWebUI" text from the client is part of the work. |
| 3.2 | ✅ **Installable app** | S | Web manifest and icons generated from the white-label settings, so the VPS URL installs on a phone or desktop with our name and logo. No offline mode. |
| 3.3 | ✅ **Projects, Lite version** | M | A project is a folder on the VPS plus a default agent or model and standing instructions. Chats are grouped under it in the sidebar. This fits agent work better than the full product's projects, and covers the "Project" control in the composer. |
| 3.4 | **Prompt library, Lite version** | M | Saved prompts in SQLite, inserted with `/` in the composer, next to the agent's own slash commands from 1.2. Covers "From library" and the sidebar entry. |
| 3.5 | **Web search toggle** | S–M | The composer's Web search turns the agent's own web search on or off. Lite runs no search itself. It uses the agent's ACP config option when the agent reports one. Otherwise it uses a launch setting per agent in .env (Codex has a search flag; Claude Code and Hermes have tool settings). Check each agent while doing 2.1. The button is hidden for model chats and for agents with no way to switch search. |
| 3.6 | **Read-only share link** | M | Optional. A signed link to a snapshot of one chat. Only worth it if we show chats to people outside the server. |

## Scorecard

| Area | Now | After Tier 1 | After Tier 2 | After Tier 3 |
|---|---|---|---|---|
| Agent chat (Hermes, Claude, Codex) | 6 | 8 | 9 | 9 |
| Model chat | 4 | 7 | 7 | 8 |
| Trust: nothing dead or fake on screen | 1 | 8 | 8 | 9 |
| Organizing chats | 3 | 6 | 6 | 8 |
| Deploy and security on a VPS | 1 | 1 | 7 | 8 |
| Our brand | 0 | 0 | 0 | 9 |
| **Overall** | **3** | **6** | **7.5** | **8+** |

## Pros and cons of staying this light

### Pros

- **Small and cheap.** 33 MB of server memory, one dependency (aiohttp) and no build step. A small VPS is enough,
  and the agents get almost all of the memory.
- **Easy to understand and to audit.** About 4,000 lines in total, compared with about 120,000. On a server where
  agents run commands, a codebase you can read in an afternoon is a real security property.
- **The agents bring their features.** Claude Code, Codex and Hermes already have tools, web access, MCP, memory and
  sub-agents. ACP passes them through, so Lite doesn't have to build any of it.
- **Fast to change and to white-label.** Branding, deployment and new agents are a few lines of .env or code, not a
  migration across 29 feature points.
- **Few moving parts.** One process and one SQLite file: no PostgreSQL, Redis, S3 or worker to keep running.

### Cons

- **One shared identity.** One password, no per-person chats, no audit of who asked an agent to do what. Every agent
  runs as the same Unix user. Fine for us; not fine for selling it to a team without 2.3 and a proxy in front.
- **Configuration needs SSH.** Adding a provider or an agent means editing .env and restarting. A non-technical
  client cannot do it from the browser.
- **Model chats are plain.** With no tools, retrieval or memory in Lite, plain model chats will always be weaker than
  ChatGPT or the full product. Lite's value is the agents.
- **We depend on ACP adapters.** How good an agent feels depends on its ACP adapter: Gemini's flag has already
  changed between versions, and agent questions are not in ACP yet. We'll need to retest whenever an agent updates.
- **The agents use most of the memory.** Each agent process takes 370 to 580 MB. A VPS with three agents active
  needs about 2 GB, whatever the server itself uses.
- **There is a ceiling.** Multi-user, roles, sharing and billing would need a new data model. If those are needed
  later, it is a rewrite of the storage layer, not a feature.

## Order of work

The order is set as milestones in [GOAL.md](GOAL.md), written so another agent can carry them out:

1. 1.2 agent › model › workspace.
2. 1.1 no dead controls.
3. 2.1 Hermes.
4. The rest of Tier 1.
5. The VPS items.
6. Workspace & Git.
7. White label.
8. Projects and the prompt library.
9. The web search toggle.
