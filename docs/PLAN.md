# Plan

AgentWebUI Lite replaces the full AgentWebUI for one job: a web interface for AI models and command-line agents.
The full product is about 120,000 lines across 29 feature points; this keeps chat with models and agents, and
what a person working with them on a VPS needs around it.

## Budget

| | Target | Measured |
|---|---|---|
| Server memory | under 100 MB | about 41 MB resident (Linux, 2026-10-19), idle with agent sessions open |
| Installed packages | as small as possible | about 5 MB (aiohttp and its eight dependencies) |

Agent processes are not part of the server's budget. They are the agents' own programs (370 to 580 MB each), so the
server starts one only when a chat needs it and stops it when it has been idle.

## In

1. **Chat with any model API.** OpenAI-compatible `/chat/completions` with streaming, reasoning shown as thinking,
   usage saved, temperature, maximum length and instructions per chat. Images go as `image_url` parts, text files as
   text. Providers and their models come from `.env`.
2. **Chat with any ACP agent.** One process per configured agent, one ACP session per chat, `session/load` after a
   restart when the agent supports it. Agent › model › folder: the agent's `configOptions` (model, effort, toggles;
   the legacy `models` shape too) are cached per agent, chosen before the first prompt, changeable between turns, and
   reapplied after a restart. Streams agent text, thoughts, plan, tool calls, diffs, images and files. Permission
   requests become cards with the agent's own options. Slash commands from `available_commands_update`. Stop cancels
   the turn. File reads and writes are limited to the chat's folder; the terminal capability is not offered.
3. **Chats.** List, open, rename, delete, pin, archive, clone, branch from a reply, export (in the browser), search.
   Messages form a tree: editing or regenerating adds a version. Stored in one SQLite file; temporary chats in memory
   only. A reply keeps running when the tab closes, and reopening the chat picks the stream back up.
4. **Files in and out.** Attachments (base64 JSON, `UPLOAD_MB`) are kept under `DATA_DIR/files`. Agent images and
   embedded files are saved there too; files an agent writes or names in its folder are served from it. Everything is
   served with a sandboxing CSP and `nosniff`.
5. **Rich replies.** A short note (`RICH_REPLIES`) tells models and agents the page renders ```` ```choices ```` (the
   picker card), ```` ```file ```` blocks, and images by path. The answer to a picker is the next user message.
6. **Projects.** A folder, a default target and instructions; chats point at one.
7. **Files and Git.** Inside `FILES_ROOTS`: list, read, write, upload, mkdir, rename, delete, find, grep; `git`
   status, diff, log, branches, switch, commit, pull (fast-forward only), push, fetch, init, clone. Agent folders must
   be inside the roots too.
8. **Server.** Optional single password with login limits, `TRUST_PROXY` for HTTPS behind Caddy, a health endpoint,
   a webhook for notifications, a backup command, brand settings and a web manifest. Configuration in `.env` only.

## Out

Accounts, first-run setup and registration · sandbox · MCP management · memory and knowledge (RAG) · prompt
library · workflows · built-in agent builder · sharing links · tool policies and audit · budgets · speech on the
server (voice is the browser's) · a terminal · our own web search · plugins · PostgreSQL, Redis, S3 · offline app.

## Shape

```
agentwebui_lite/
  config.py     .env → Settings (providers, agents, roots, brand)
  providers.py  OpenAI-compatible model listing and streaming
  acp.py        ACP client: JSON-RPC over stdio, agent processes, sessions, config options, permission and file requests
  turns.py      one reply in progress: events for every viewer, parts, permission questions, files the agent sent
  store.py      SQLite: chats, the message tree, files, projects, cached agent options
  workspace.py  files and git inside FILES_ROOTS
  server.py     HTTP API, server-sent events, password guard
  static/       the web client: Preact through htm, no build step (see DESIGN.md)
deploy/         install.sh (systemd + Caddy), the unit, the Caddyfile; Dockerfile and docker-compose.yml at the top
```

## API

| | |
|---|---|
| `GET /api/config` | models, providers, agents (with cached options), roots, brand |
| `GET /api/agents/{id}/options` | the agent's config options: cached, or by starting it once |
| `GET/POST /api/chats` | list, create (`{"target": "model:<provider>/<model>" \| "agent:<id>", "cwd", "config", "project_id", "temporary"}`) |
| `GET/PATCH/DELETE /api/chats/{id}` | the thread on screen and agent state; rename, pin, archive, project, model chat settings (`config`), switch a model chat's model; delete |
| `POST /api/chats/{id}/clone` | copy the chat, or up to a message (`{"upto": id}`) to branch |
| `GET /api/search?q=` | chats whose title or messages match, with a snippet |
| `POST /api/chats/{id}/messages` | send `{"text", "files": [ids], "edit": id?}`; the response is the reply as server-sent events |
| `POST /api/chats/{id}/retry` | answer the last message again, as a new version |
| `POST /api/chats/{id}/version` | show the thread through another version (`{"message": id}`) |
| `GET /api/chats/{id}/events` | follow a reply that is still running |
| `POST /api/chats/{id}/cancel` | stop the reply |
| `POST /api/chats/{id}/mode` | switch an agent chat's mode (`{"mode": "<id>"}`) |
| `POST /api/chats/{id}/config` | change an agent option (`{"id", "value"}`): 409 while a reply runs, 422 for an unknown one |
| `POST /api/chats/{id}/permissions/{question}` | answer an agent's permission question (`{"option": "<id>"}`) |
| `GET /api/chats/{id}/local?path=` | a file in the chat's folder (what the agent wrote or names) |
| `POST /api/files`, `GET /api/files/{id}` | attach a file (`{"name", "type", "data"}` or `{"path"}`); get it (`?download=1`) |
| `GET/POST /api/projects`, `PATCH/DELETE /api/projects/{id}` | projects |
| `GET /api/fs/roots, list, read, raw, find, grep` · `POST /api/fs/write, upload, mkdir, rename, delete` | files inside `FILES_ROOTS` |
| `GET /api/git/status, diff, log, branches` · `POST /api/git/commit, switch, sync, init, clone` | git inside `FILES_ROOTS` |
| `GET /api/health`, `/manifest.webmanifest`, `/brand/logo` | open without a password |
| `GET /api/session`, `POST /api/login`, `POST /api/logout` | only when `PASSWORD` is set |
| `GET /embed?token=` | one-time sign-in from a page that frames this one (`EMBED_SECRET`); then redirects to `/` |

Events: `user`, `delta`, `thought`, `plan`, `tool`, `part` (a file or the files changed), `permission`,
`permission_answered`, `modes`, `config`, `commands`, `notice`, `error`, `message` (the saved reply), `end`. A saved
reply keeps its parts: text, thought (with seconds), plan, tool (input, output, diffs, seconds), permission (the
question and the answer), file and outputs.

## Next

The remaining roadmap items are in [ROADMAP.md](ROADMAP.md): Hermes checked end to end, the web search toggle where an
agent offers one, and a read-only share link if it is ever needed.
