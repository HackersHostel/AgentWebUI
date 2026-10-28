# Contributing to AgentWebUI

Thanks for helping. AgentWebUI is small on purpose, and this guide is short for the same reason: read it once before
your first pull request and you'll know everything a reviewer will look for.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug** with the [bug form](https://github.com/HackersHostel/AgentWebUI/issues/new/choose). Steps we can
  follow get fixed first.
- **Try it with your agent or model server.** Reports from the *Agent or provider compatibility* form tell us which
  ACP agents and OpenAI-compatible APIs work, and that's hard to learn any other way.
- **Answer a question** in [Q&A](https://github.com/HackersHostel/AgentWebUI/discussions/categories/q-a).
- **Improve the docs.** If something in the README or `.env.example` tripped you up, it will trip up the next person.
- **Write code.** Issues labelled [`good first issue`](https://github.com/HackersHostel/AgentWebUI/labels/good%20first%20issue)
  and [`help wanted`](https://github.com/HackersHostel/AgentWebUI/labels/help%20wanted) are ready to pick up.

Found a security problem? Don't open an issue: follow [SECURITY.md](SECURITY.md).

## Before you write code

- **Small, obvious fixes** (a typo, a clear bug with a clear fix): open a pull request straight away.
- **Anything larger** (a new feature, a new setting, a change to how something looks or works): open an issue or an
  [Ideas](https://github.com/HackersHostel/AgentWebUI/discussions/categories/ideas) discussion first, and wait for a
  maintainer to agree on the approach. This saves you building something that can't be merged.
- **Say you're on it.** Comment on the issue so nobody else starts the same work.

## Set up

You need Python 3.11 or newer and Git. You don't need an API key or an agent to work on AgentWebUI: the tests bring a
fake OpenAI-compatible server and a scripted ACP agent.

```bash
git clone https://github.com/<you>/AgentWebUI.git && cd AgentWebUI
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
cp .env.example .env          # turn on a provider or an agent to chat by hand
.venv/bin/agentwebui          # http://127.0.0.1:3000
```

To chat by hand without a paid key, point `PROVIDER_OLLAMA_URL` or `PROVIDER_LMSTUDIO_URL` at a local model. Claude
Code and Codex start through `npx`, so they need Node.js and must already be signed in on your machine.

The server reads the files under `agentwebui/static/` on each request, so a browser reload picks up client
changes. Restart the server after changing Python or `.env`.

## Where things are

| Path | What it is |
|---|---|
| `agentwebui/server.py` | The HTTP API, the page, sign-in, and replies streamed as server-sent events |
| `agentwebui/acp.py` | The Agent Client Protocol client: JSON-RPC over an agent's stdio |
| `agentwebui/providers.py` | Any OpenAI-compatible chat completions API |
| `agentwebui/turns.py` | One reply in progress, replayed to every viewer so a reload picks the stream back up |
| `agentwebui/store.py` | Chats, messages, files and projects in one SQLite file |
| `agentwebui/workspace.py` | Files and Git under `FILES_ROOTS` |
| `agentwebui/config.py` | Settings from the environment and `.env` |
| `agentwebui/__main__.py` | The `agentwebui` command: serve, or `backup` |
| `agentwebui/static/` | The web client: `index.html`, `js/` (Preact through htm, no build step), `css/tokens.css` (the design tokens) |
| `tests/` | `conftest.py` (a fake OpenAI server and app fixtures) and `fake_agent.py` (a scripted ACP agent) |
| `deploy/`, `Dockerfile`, `docker-compose.yml` | The VPS install script with systemd and Caddy, and the Docker setup |
| `docs/` | `API.md` (the HTTP API and its events) and the README's screenshots |

Each Python module and each client file starts with a comment saying what it covers. Read that before changing it.

## The rules

These keep AgentWebUI small and predictable. A pull request that breaks one will be asked to change.

1. **Stay tiny.** No new Python dependency, no new service, and no build step for the client. The server's one
   runtime dependency is `aiohttp`, and the client is plain ES modules. If you think something can't be done without
   a dependency, open an issue first.
2. **No dead controls.** Every button, menu item and setting you add does something. Don't ship placeholders.
3. **Match the design.** Use the names in `static/css/tokens.css`, never raw colors. Check every theme (dark, light,
   graphite, terminal, paper, hc) and a phone width.
4. **Configuration in `.env` only.** The server is configured from `.env` and nowhere else; there is no settings
   screen that writes server config. Add each new setting to `.env.example` with a one-line comment, and to the README
   if users need to know about it. What the browser remembers (theme, defaults) stays in the browser.
5. **Tests for every server change.** Add them to `tests/`, using the fixtures in `conftest.py`. Extend
   `fake_agent.py` when you need new agent behavior.
6. **One change per pull request.** A bug fix and an unrelated refactor are two pull requests.
7. **Never commit `.env`, `data/`, keys or personal paths.**

## Tests

```bash
.venv/bin/pytest                    # everything, in a few seconds
.venv/bin/pytest -k attachments -x  # one area, stop at the first failure
```

CI runs the suite on Python 3.11 to 3.14 for every pull request, and it must pass before merging.

The client has no automated tests. Try your change by hand in a Chromium browser and in Safari or Firefox, at desktop
and phone widths, and put before and after screenshots in the pull request.

## Code style

Write code that reads like the code around it.

- **Python:** four spaces, type hints, `from __future__ import annotations`, lines up to about 120 characters. Name
  things for what they are. Comment why, not what.
- **JavaScript:** ES modules, two spaces, `html` templates and the store from `js/lib.js`. No new globals.
- **CSS:** tokens from `tokens.css`; put new rules next to the screen they style in `app.css`.
- **Text in the UI and docs:** short, plain sentences that say what happens ("Agents work in this folder"), not what
  the code does.

There's an [`.editorconfig`](.editorconfig) so most editors pick up the indentation on their own.

## Commits and pull requests

- **Branch** from `main` with a short prefix: `fix/attachment-preview`, `feat/agent-memory-meter`, `docs/restore-steps`.
- **Commit messages** are one imperative sentence that says what changes for the user, like the history already
  does: "Make every theme's text and buttons readable", "Keep menus on screen". Add a body when the why isn't obvious.
- **Pull requests** fill in the template: what changes for users, the issue it closes, how you tested it, and
  screenshots for anything visible. Keep them small enough to review in one sitting.
- **Changelog:** add a line under *Unreleased* in [`CHANGELOG.md`](CHANGELOG.md) when users will notice the change.
- After review, push follow-up commits to the same branch rather than opening a new pull request. A maintainer
  merges it once CI passes and the review is approved.

## Releases

Maintainers bump `__version__` in `agentwebui/__init__.py`, move the *Unreleased* changelog entries under the new
version, and tag the merge commit `vX.Y.Z`. The tag publishes the Docker images `X.Y.Z`, `X.Y` and `latest` (and their
`-slim` twins) through the Docker workflow, which refuses a tag that doesn't match `__version__`. Every merge to
`main` publishes `edge`.

## License

AgentWebUI is [MIT licensed](LICENSE). By contributing, you agree that your contributions are released under the same
license.
