# Plan

AgentWebUI Lite replaces the full AgentWebUI for one job: a web interface for AI models and command-line agents.
The full product is about 120,000 lines across 29 feature points; this keeps two features and the minimum around
them.

## Budget

| | Target | Measured (macOS, 2026-10-19) |
|---|---|---|
| Server memory | under 200 MB | 33 MB footprint, idle with three agent sessions open |
| Installed packages | as small as possible | about 5 MB (aiohttp and its eight dependencies) |

Agent processes are not part of the server's budget. They are the agents' own programs (370 to 580 MB each), so the
server starts one only when a chat needs it and stops it when it has been idle.

## In

1. **Chat with any model API.** OpenAI-compatible `/chat/completions` with streaming, reasoning shown as thinking,
   usage saved. Providers and their models come from `.env`.
2. **Chat with any ACP agent.** One process per configured agent, one ACP session per chat, `session/load` after a
   restart when the agent supports it. Streams agent text, thoughts, plan, tool calls and diffs. Permission requests
   become cards with the agent's own options. Stop cancels the turn. File reads and writes are limited to the chat's
   folder; the terminal capability is not offered, so agents use their own.
3. **Chats.** List, open, rename, delete. Stored in one SQLite file. A reply keeps running when the tab closes, and
   reopening the chat picks the stream back up.
4. **Configuration in `.env` only.** Optional single password; without one, the server answers only on localhost.

## Out

Accounts, first-run setup and registration · sandbox · MCP · memory and knowledge (RAG) · prompt library ·
workflows · built-in agent builder · projects, folders, sharing · tool policies and audit · budgets · voice ·
plugins · PostgreSQL, Redis, S3 · import/export · offline app.

## Shape

```
agentwebui_lite/
  config.py     .env → Settings (providers, agents)
  providers.py  OpenAI-compatible model listing and streaming
  acp.py        ACP client: JSON-RPC over stdio, agent processes, sessions, permission and file requests
  turns.py      one reply in progress: events for every viewer, parts, permission questions
  store.py      SQLite: chats and messages
  server.py     HTTP API, server-sent events, password guard
  static/       the web client: Preact through htm, no build step (see DESIGN.md)
```

## API

| | |
|---|---|
| `GET /api/config` | models and agents from `.env` |
| `GET/POST /api/chats` | list, create (`{"target": "model:<provider>/<model>"}` or `{"target": "agent:<id>", "cwd": "…"}`) |
| `GET/PATCH/DELETE /api/chats/{id}` | messages and agent state; rename or move a model chat to another model; delete |
| `GET /api/search?q=` | chats whose title or messages match, with a snippet |
| `POST /api/chats/{id}/messages` | send; the response is the reply as server-sent events |
| `GET /api/chats/{id}/events` | follow a reply that is still running |
| `POST /api/chats/{id}/cancel` | stop the reply |
| `POST /api/chats/{id}/retry` | answer the last message again, replacing the previous reply |
| `POST /api/chats/{id}/mode` | switch an agent chat to one of the agent's modes (`{"mode": "<id>"}`) |
| `POST /api/chats/{id}/permissions/{question}` | answer an agent's permission question (`{"option": "<id>"}`) |
| `GET /api/session`, `POST /api/login`, `POST /api/logout` | only when `PASSWORD` is set |

Events: `user`, `delta`, `thought`, `plan`, `tool`, `permission`, `permission_answered`, `modes`, `notice`, `error`,
`message` (the saved reply), `end`. A saved reply keeps its parts: text, thought (with seconds), plan, tool (input,
output, diffs, seconds) and permission (the question and the answer).

## Next

The full plan, with white label, Hermes and the VPS deployment, is in [ROADMAP.md](ROADMAP.md).

1. Wire the controls the design draws but Lite does not run yet, as they are wanted (see DESIGN.md).
2. The agent's own model list and slash commands (modes are done).
3. Attachments (images and files as ACP content blocks and as model message parts).
4. Agent questions (the AgentAsk boards) once ACP has a question message.
5. A container image.
