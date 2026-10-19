# AgentWebUI Light

One small web page to chat with AI models and with command-line agents. Open it and chat: there is no setup screen
and no accounts. Everything is configured in `.env`.

- **Models:** any OpenAI-compatible API (OpenAI, OpenRouter, NVIDIA, Groq, Ollama, LM Studio, vLLM, …).
- **Agents:** anything that speaks the [Agent Client Protocol](https://agentclientprotocol.com) over stdio: Claude
  Code, Codex, Hermes, Pi, Gemini CLI, OpenCode, … The agent streams its thinking, plan, tool calls and diffs, and asks
  you before it acts.

The server is about 1,200 lines of Python with one dependency (`aiohttp`). It uses about 33 MB of memory and about
5 MB of installed packages.

## Run

Needs Python 3.11+.

```bash
python3 -m venv .venv && .venv/bin/pip install -e .
cp .env.example .env        # then turn on a model provider or an agent
.venv/bin/agentwebui-light  # http://127.0.0.1:3000
```

Run the tests with `.venv/bin/pip install -e '.[dev]' && .venv/bin/pytest`.

## Configure

Every setting is in [`.env.example`](.env.example). A value may name a variable from your shell as `${NAME}`.

```bash
PROVIDER_OPENROUTER_URL=https://openrouter.ai/api/v1
PROVIDER_OPENROUTER_KEY=${OPENROUTER_API_KEY}

AGENT_CLAUDE_COMMAND=npx -y @agentclientprotocol/claude-agent-acp
AGENT_CODEX_COMMAND=npx -y @agentclientprotocol/codex-acp
AGENT_HERMES_COMMAND=hermes acp
```

- An agent runs as you, with this server's environment, so its own sign-in applies (for example `claude` or
  `codex login` in a terminal first). Each chat with an agent has a folder; the agent's file requests through ACP are
  limited to that folder.
- An agent process stays up while you use it and stops after `AGENT_IDLE_MINUTES` (10) with nothing to do. Agents
  are much larger than this server (Claude Code about 370 MB, Codex about 580 MB, measured on macOS), so this matters
  on a small machine. Installing an adapter globally (`npm i -g …`) saves the extra `npm exec` process.
- Without `PASSWORD` the server only answers on localhost. Set `PASSWORD` to listen on another address.

## What it does not do

No accounts, roles or sign-up, no RAG or memory, no prompt library, no workflows, no MCP management, no sandbox, no
built-in agent builder. Agents bring their own tools, memory and MCP servers. See [`docs/PLAN.md`](docs/PLAN.md).

## Status

The page in `agentwebui_light/static/` is a plain placeholder. The designed client replaces it and talks to the same
API.
