# AgentWebUI Lite

One small web page to chat with AI models and with command-line agents, on your own server. Open it and chat:
there is no setup screen and no accounts. Everything is configured in `.env`.

- **Models:** any OpenAI-compatible API (OpenAI, OpenRouter, NVIDIA, Groq, Ollama, LM Studio, vLLM, …).
- **Agents:** anything that speaks the [Agent Client Protocol](https://agentclientprotocol.com) over stdio: Claude
  Code, Codex, Hermes, Pi, Gemini CLI, OpenCode, … Pick the agent, then **its** model and effort, then the folder it
  works in. It streams its thinking, plan, tool calls and diffs, and asks before it acts.

The server is about 3,000 lines of Python with one dependency (`aiohttp`) and uses about 40 MB of memory. The web
client is Preact through htm with no build step. Nothing loads from the internet unless you pick a font other than
Geist.

## What you can do

| | |
|---|---|
| **Chat** | Stream replies with reasoning; edit a sent message or regenerate, and flip between versions (‹ 2 / 3 ›); branch into a new chat from any reply; pin, archive, clone, export (Markdown or JSON); search everything with ⌘K. |
| **Temporary chat** | A chat that is never written to disk, never listed, and gone when you leave it. |
| **Files in** | Attach images, PDFs, text and code with +, by dropping them on the message box, by pasting, from your phone's camera, or from the server's files. Models get them as message parts; agents as ACP `image`, `resource` and `resource_link` blocks. |
| **Files and pictures out** | Images and files an agent sends appear in the chat. An image or file it writes in its folder and names in its reply (`![chart](chart.png)`) shows inline, and every file it changed is listed with a preview, View and Download. A model can hand you a file with a ```` ```file name="report.csv" ```` block; HTML and SVG code blocks have a Preview. |
| **Pickers** | A model or agent can ask you to choose with a ```` ```choices ```` block: single, multiple, confirm, text, scale, number, date, searchable list, ranking, or several questions with a review step. Your answer goes back as your next message. |
| **Agents** | The agent bar reads *agent › model › folder*, then the agent's mode. The model menu lists the agent's own models, effort and toggles (ACP `configOptions`); switch mid-chat, and the choice survives a restart. Type `/` for the agent's slash commands. |
| **Projects** | A folder, a default agent or model, and standing instructions. Chats are grouped under it in the sidebar. |
| **Files & Git** | Browse, view, edit, upload, rename and delete inside `FILES_ROOTS`; ⌘P go to file; search in files; `git` status, diff, commit, branch, pull, push and clone with the server's own Git sign-in. Start an agent chat in any folder. |
| **Voice** | Dictate into the message box, have replies read aloud, or talk hands-free in voice mode. It is the browser's own speech: audio never reaches the server. |
| **Notifications** | In-app and browser notifications when a reply finishes, fails or waits for you, and an optional webhook (Slack, Teams, ntfy, …) that works with every tab closed. |
| **Your brand** | Name, logo, greeting, theme and accent from `.env`; the page installs as an app on a phone or desktop. |

## Run it on your computer

Needs Python 3.11+.

```bash
python3 -m venv .venv && .venv/bin/pip install -e .
cp .env.example .env        # then turn on a model provider or an agent
.venv/bin/agentwebui-lite  # http://127.0.0.1:3000
```

Run the tests with `.venv/bin/pip install -e '.[dev]' && .venv/bin/pytest`.

## Put it on a VPS

Two ways; both end with the app behind Caddy on HTTPS. Point a DNS name at the server first.

### Install script (systemd, lightest)

On a fresh Ubuntu 22.04+ or Debian 12+ server:

```bash
git clone https://github.com/HackersHostel/AgentWebUI-Lite.git && cd AgentWebUI-Lite
sudo DOMAIN=chat.example.com ./deploy/install.sh
```

It creates an `agentwebui` user, installs the app in `/opt/agentwebui-lite`, Claude Code and Codex with their ACP
adapters (`AGENTS=claude,codex`, or `AGENTS=` for none), writes `/etc/agentwebui-lite/.env` with a new password,
starts the `agentwebui-lite` service, puts Caddy in front for HTTPS (with streaming left unbuffered), and adds a daily
backup. It prints the address and the password. Then sign the agents in once, as the app's user:

```bash
sudo -iu agentwebui claude                     # then /login
sudo -iu agentwebui codex login --device-auth
```

Agents work in `/home/agentwebui/work` (`FILES_ROOTS`). Clone your repositories there from the Files page, or with
`sudo -iu agentwebui git clone …`. For pushing, give that user a deploy key: `sudo -iu agentwebui ssh-keygen -t
ed25519`, and add the public key to the repository. Run the script again to update.

Change settings in `/etc/agentwebui-lite/.env`, then `sudo systemctl restart agentwebui-lite`. Logs:
`journalctl -u agentwebui-lite -f`. Without `DOMAIN` the app answers only on `127.0.0.1`; reach it with
`ssh -L 3000:127.0.0.1:3000 your-server` or Tailscale.

### Docker

```bash
cp .env.example .env    # set PASSWORD and your providers; agents are already installed in the image
DOMAIN=chat.example.com docker compose up -d --build
docker compose exec app claude                  # sign Claude Code in once
docker compose exec app codex login --device-auth
```

Data lives in the `data` volume, the agents' sign-ins in `home`, and your projects in `./work`. The image is large
(about 2.8 GB) because Claude Code and Codex come with it; build with `--build-arg AGENTS=` to leave them out.

### Keep it safe

Whoever has the password can make an agent run commands on the server, as the app's user. Use a long password (the
install script makes one), keep `FILES_ROOTS` narrow, and consider putting the page behind Tailscale or Cloudflare
Access. Wrong passwords are limited to 8 per address per 10 minutes. Uploaded and agent-written files are served
sandboxed, so an HTML or SVG file can't run as the page.

### Backups

`agentwebui-lite backup [FILE]` writes a consistent copy of the database while the server runs (to
`DATA_DIR/backups/` by default). The install script adds this cron line; add it yourself for other setups:

```
17 3 * * * agentwebui cd /var/lib/agentwebui-lite && AWL_ENV_FILE=/etc/agentwebui-lite/.env /opt/agentwebui-lite/.venv/bin/agentwebui-lite backup
```

## Configure

Every setting is in [`.env.example`](.env.example). A value may name a variable from your shell as `${NAME}`.

```bash
PROVIDER_OPENROUTER_URL=https://openrouter.ai/api/v1
PROVIDER_OPENROUTER_KEY=${OPENROUTER_API_KEY}

AGENT_CLAUDE_COMMAND=npx -y @agentclientprotocol/claude-agent-acp
AGENT_CLAUDE_MODEL=sonnet          # where new chats start, until the browser remembers a choice
AGENT_CODEX_COMMAND=npx -y @agentclientprotocol/codex-acp
AGENT_HERMES_COMMAND=hermes acp

FILES_ROOTS=~/code,~/notes         # what Files shows and where agents may work
```

- An agent runs as the server's user, with this server's environment, so its own sign-in applies. Each agent chat
  has a folder inside `FILES_ROOTS`; the agent's file requests through ACP stay in that folder.
- An agent process stays up while you use it and stops after `AGENT_IDLE_MINUTES` (10) with nothing to do. Agents
  are much larger than this server (Claude Code about 370 MB, Codex about 580 MB), so this matters on a small machine.
- Without `PASSWORD` the server only answers on localhost. Set `PASSWORD` to listen on another address.
- Models and agents come only from `.env`; the browser switches between them, hides models you don't use, and
  remembers your defaults (Settings › Chat has "Reset to defaults").

## What it does not do

No accounts, roles or sign-up, no RAG or memory, no prompt library, no workflows, no MCP management, no sandbox, no
terminal and no web search of its own. Agents bring their own tools, memory, MCP servers and web search. See
[`docs/PLAN.md`](docs/PLAN.md).

## The client

Built from the AgentWebUI redesign: [`docs/DESIGN.md`](docs/DESIGN.md) maps every board to what is built and where
Lite departs from the boards.

| | |
|---|---|
| `⌘N` / `Ctrl+N` | New chat |
| `⌘K` | Search chats, actions and settings |
| `⌘M` | Switch model (in an agent chat: the agent's model menu) |
| `⌘P` | Go to file (in Files) |
| `⌘\` | Collapse or expand the sidebar |
| `↵` | Send, or allow the waiting request |
| `/` | The agent's slash commands (agent chats) |
| `Esc` | Stop the reply, or close the top layer |
| `?` | All shortcuts |
