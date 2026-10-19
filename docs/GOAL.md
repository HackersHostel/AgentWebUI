# Goal: take AgentWebUI Lite from 3/10 to 8/10

You are picking up AgentWebUI Lite. It is a small web interface for AI agents (Hermes, Claude Code, Codex, any
agent that speaks the Agent Client Protocol) and for OpenAI-compatible model APIs. It will run on our VPS, under our
own brand.

**Your goal:** work through the milestones below in order. At the end, a person can open the page on the VPS and:

- pick an agent, then pick **that agent's model**, then pick the folder it works in;
- chat with it without meeting one button that does nothing;
- see the product under our name and logo.

Do it without making Lite heavy. Each milestone ends with a pull request a human reviews.

Milestone 1 is the one the owner cares about most. Do it first and do it well.

---

## 0. Before you write any code

1. **Read, in this order:**
   - `README.md`: what Lite is and how to run it.
   - `docs/PLAN.md`: what is in and out, and the HTTP API.
   - `docs/DESIGN.md`: how the client maps to the design boards.
   - `docs/ROADMAP.md`: every feature, numbered. Milestones here refer to those numbers.
2. **Run it:**
   ```bash
   python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
   cp .env.example .env    # turn on AGENT_CLAUDE_COMMAND and AGENT_CODEX_COMMAND at least
   .venv/bin/pytest         # 21 tests, all must pass before you change anything
   .venv/bin/agentwebui-lite   # http://127.0.0.1:3000
   ```
   Claude Code and Codex must already be signed in on the machine (`claude`, then `codex login`) for real agent
   chats to work.
3. **Get a feel for the product before you change it.** Open a chat with Claude Code and send a message. Then click
   around: the composer's +, Web search, the mic, the sidebar's Projects, Settings › Account. Most of those show
   "… isn't part of AgentWebUI Lite." That message is what the owner means by 3/10.

## Ground rules (they apply to every milestone)

- **Keep it tiny.** No new Python dependency, no background service, no second database, no frontend build step.
  - A feature uses what already exists: the browser, the server's `git` command, the agent's own abilities over
    ACP, or a column or table in the existing SQLite file.
  - Anything optional stays hidden until `.env` turns it on.
  - The budget is server memory well under 100 MB (33 MB today) and roughly 7,500 lines total (4,000 today).
- **No dead controls.** Every visible control works, or it is not on the screen. Do not add new uses of
  `notInLite()`. Each milestone removes some.
- **The design is not negotiable.** It is the AgentWebUI Redesign canvas
  (https://claude.ai/artifact/1VveVZJQenG6mAaEsw9KEa). Match its tokens (`static/css/tokens.css`), icons
  (`static/js/icons.js`), spacing, motion and writing style. Read `docs/DESIGN.md` before touching a screen.
  - New controls look like their neighbours: an agent bar button looks like the existing `.ab` buttons, and a menu
    uses `Menu`/`MenuItem` from `ui.js`.
- **Configuration stays in `.env`.** There are no accounts, roles or setup screens. One optional password.
- **Out of scope: do not build these.**
  - RAG and memory, the sandbox, a terminal, MCP management, workflows, the agent builder.
  - Multiple users or roles.
  - Speech on the server, and voice mode.
  - Our own web search.
- **Match the code around you.** Python: four spaces, type hints, short docstrings that say why, the existing
  error style (`AgentError`, `_error(status, message)`). JavaScript: Preact through htm, the store in `lib.js`,
  actions in `actions.js`. Comments are rare and explain why, not what.
- **Tests.** Every server behaviour change gets a test in `tests/test_app.py`. Agent behaviour is tested through
  `tests/fake_agent.py`: extend the fake, don't mock `acp.py`. The client has no test runner. Check it in a real
  browser and put screenshots in the pull request.
- **Git.**
  - One branch per milestone from `main` (`feat/m1-agent-models`, …), and a pull request into `main`.
  - Commit subjects are short imperative sentences, like the existing history ("Build the designed client: …").
  - Never commit `.env` or `data/`.
- **Docs move with the code.** When a feature lands:
  - update `docs/PLAN.md` (In/Out and the API table) and `docs/DESIGN.md` (move the control from "Drawn but not
    running" to "Built and working");
  - tick the item in `docs/ROADMAP.md`.

---

## Milestone 1: Agent › Model › Workspace

### Why

When you use Claude Code or Codex in a terminal, you choose the model: Opus or Sonnet, or a GPT model and how hard
it thinks. Picking an agent does not fix the model.

Lite gets this wrong today. The model picker lists models and agents as alternatives. Once you pick Claude Code,
there is no way to choose which Claude model it runs, so you get whatever its default is. The owner wants the
choice in three steps, in this order: **agent, then model, then workspace (folder).**

### What the person sees when it's done

The agent bar above the composer currently reads:

```
[◆ Claude Code ▾] │ [📁 my-project ▾]  [🛡 Ask first ▾]            ● Connected
```

It becomes:

```
[◆ Claude Code ▾] › [Opus · High ▾] › [📁 my-project ▾]   [🛡 Ask first ▾]   ● Connected
```

Walk through it the way the owner will:

1. On the home screen, press ⌘M and choose **Claude Code**. The agent bar appears. Its middle button shows the
   model Claude Code will use. That's the one chosen last time for this agent, or Claude Code's own default the
   first time.
2. Click the model button. A menu opens upward, styled like the existing mode menu:
   - **Model:** a radio list of every model the agent offers, each with its description.
   - **Effort:** the agent's thinking level, if it has one (Claude Code and Codex both do).
   - **Toggles:** any on/off options it reports (Fast mode, for example).
   - A search field at the top when there are more than eight models.
3. Pick **Sonnet**. The button now reads "Sonnet · High". Then pick the folder, type, and send. The first reply runs
   on Sonnet. The meta line under the reply reads "Claude Code · Sonnet", not just "Claude Code".
4. Halfway through the chat, open the model menu again and pick Opus. The next turn runs on Opus. A one-line note
   in the transcript says "Switched to Opus". It is a client-side marker drawn like the existing status lines.
   While a reply is running, the menu is disabled with the hint "Change the model after this reply".
5. Do the same with **Codex**: its models and its reasoning effort appear, and switching works the same way.
6. Restart the server, reopen the chat and send again. The chat is still on the model it was on.
7. An agent that offers no model choice over ACP (maybe Hermes; check it) has **no model button at all**. No
   disabled stub, no toast.
8. ⌘M in an agent chat opens the agent's model menu. In a model chat it opens the model picker as today.
9. In the ⌘M picker, an agent row's detail panel lists the models that agent offers, so you can see the choice
   before committing. A nested agent → model row is optional; do it only if it fits the picker's design cleanly.

The agent can't be changed after the first message: a session belongs to one agent. The folder can't change
either, because the ACP session is opened in it. The model can always change. That is the difference this
milestone makes.

### Protocol facts (verified against the adapters on 2026-10-19)

Checked in `@agentclientprotocol/sdk` 1.9.0, `@agentclientprotocol/claude-agent-acp` 0.93.0 and
`@agentclientprotocol/codex-acp` 2.2.2. Re-check against whatever versions `npx` fetches when you start.

- **Where the options come from.** The responses to `session/new` and `session/load` carry
  **`configOptions: SessionConfigOption[]`**. Each option has:
  - `id`, `name`, `description?`, `category?`;
  - `type: "select"` with `currentValue: string` and `options`. `options` is either a list of
    `{value, name, description?}` or a list of groups `{group, name, options: [...]}`;
  - or `type: "boolean"` with `currentValue: boolean`.
- **Categories:**
  - `mode`, `model`, `model_config` and `thought_level` are standard. Any other string is allowed and is for display
    only.
  - Claude Code sends: `mode`, `model`, an effort option (category `thought_level`), Fast mode when the model
    supports it, and an "Agent" persona select when custom agents exist.
  - Codex sends: an agent mode, a collaboration mode (category `collaboration_mode`), `model`, reasoning effort
    (`thought_level`) and Fast mode.
- **Changing one:** call `session/set_config_option` with `{sessionId, configId, value}` for a select, or
  `{sessionId, configId, type: "boolean", value}` for a boolean. The response is `{configOptions}`: the **complete**
  new list.
  - Values depend on each other. Changing the model can change the effort choices, so always replace your whole
    copy with the response.
- **When the agent changes them itself:** a `session/update` with `sessionUpdate: "config_option_update"` and the
  full `configOptions`.
- **Older agents (legacy shapes):**
  - Models: `models: {availableModels: [{modelId, name, description?}], currentModelId}` in the `session/new`
    result, changed with `session/set_model {sessionId, modelId}`. Codex still answers that method. Use this shape
    only when `configOptions` is absent.
  - Modes: `modes` with `session/set_mode`, which Lite already handles (`acp.py`, `Session.set_modes`). When
    `configOptions` contains a `mode` category option, use it and ignore `modes`, so the mode button does not show
    twice.
- **Slash commands:** `available_commands_update` (a list of `{name, description, input?}`). Not part of this
  milestone, but store them on the session when they arrive. Milestone 4 uses them.

### The catch: there is no session before the first message

Lite opens the ACP session lazily, inside `_run` (`server.py`, around line 376), when the first message is sent. The
home screen therefore has nothing to show in the model menu. Solve it like this:

1. **Cache per agent.** Whenever any session of an agent reports `configOptions`, save them in a new SQLite table:
   `agent_options (agent_id TEXT PRIMARY KEY, options TEXT NOT NULL, updated_at REAL NOT NULL)`. The home screen
   reads the cache.
2. **Probe once if there is no cache.** `GET /api/agents/{id}/options` returns the cache. If there is none, it
   starts the agent, opens a session in the agent's default folder, saves its `configOptions`, and returns them.
   The client calls it only when the model menu opens for an agent with no cache. Show a spinner in the menu while
   it runs: an agent can take several seconds to start. The idle reaper stops the process later as usual.
3. **Apply the choice when the session opens.** The new-chat request carries the chosen values: `POST /api/chats`
   with `{"target": "agent:claude", "cwd": "...", "config": {"model": "sonnet", "effort": "high"}}`. Store them on the
   chat. After `process.open()` returns a session, compare its options with the chat's stored values and call
   `session/set_config_option` for each difference, **before** `session/prompt`.
   - Do the same after `session/load` and after a new session replaces a lost one, so a restart keeps the model.
   - If the agent rejects a stored value (the model no longer exists), keep going on the agent's current value,
     emit a `notice` ("Opus isn't available any more; using Sonnet"), and update the stored value.
4. **Remember the last choice per agent** in the browser (`local.set('agentConfig:<id>', {...})` in `lib.js`). A
   new chat starts from it. Optionally, `.env` sets a starting model: `AGENT_<ID>_MODEL=<value>`, applied when the
   browser has nothing stored. Add it to `.env.example` next to the other `AGENT_` lines.

### Server changes

- **`agentwebui_lite/acp.py`:**
  - `Session` keeps `config` (the latest `configOptions`, as received) and `commands`.
  - Parse `configOptions` from `session/new` and `session/load`. Convert the legacy `models` shape into the same
    form (a select option with id `model` and category `model`) and remember that it is legacy, so changing it calls
    `session/set_model`.
  - Add `async set_config(session_id, config_id, value)`. It validates the value against the option's choices,
    calls the right method, replaces `session.config` with the response, and returns the list.
  - Handle the `config_option_update` and `available_commands_update` notifications in `_notification`, emitting a
    `config` event to the running turn as `current_mode_update` does now.
  - Include `config` in `state()`.
- **`agentwebui_lite/store.py`:**
  - Add a `config TEXT NOT NULL DEFAULT '{}'` column to `chats`. The schema uses `CREATE TABLE IF NOT EXISTS`, so
    existing databases need an `ALTER TABLE` guarded by `PRAGMA table_info`.
  - Add the `agent_options` table.
  - Add `set_chat_config` and `agent_options` get and set.
- **`agentwebui_lite/server.py`:**
  - `create_chat` accepts `config` for agent chats and refuses it for model chats.
  - Add `POST /api/chats/{id}/config` with `{"id": "<configId>", "value": <string|bool>}` → `{"config": [...]}`.
    It returns 409 while a reply runs and 422 for an unknown option or value. If the agent process isn't running,
    store the value and return 200; it is applied when the session opens.
  - Add `GET /api/agents/{id}/options` as described above.
  - `_run` applies stored values after `open()`, and puts the current model's display name in the saved reply's
    `meta["agent_model"]`.
  - `get_chat` returns the options and the chat's stored values.
  - Leave `POST /api/chats/{id}/mode` working. It can call `set_config` when the mode comes from `configOptions`.
- **`tests/fake_agent.py`:** add `FAKE_CONFIG`:
  - `"options"`: reports `configOptions` with a `model` select (two models), a `thought_level` select whose choices
    **change with the model**, and a boolean;
  - `"legacy"`: reports only the `models` shape;
  - unset: reports neither.
  - Implement `session/set_config_option` and `session/set_model`, and send a `config_option_update` on request so a
    test can cover it.
- **New tests in `tests/test_app.py`** (one behaviour each, named like the existing ones):
  - an agent chat lists the agent's models and effort;
  - a chosen model is applied before the first prompt (assert the `FAKE_LOG` order: `session/new`,
    `session/set_config_option`, `session/prompt`);
  - the model can change between turns and the change reaches the agent;
  - changing the model replaces the dependent options;
  - a restart reapplies the stored model after `session/load`;
  - the legacy `models` shape switches through `session/set_model`;
  - an agent with no model options has none in the chat state;
  - the probe caches options, and a second call does not start a session;
  - changing the model during a reply is refused with 409.

### Client changes

- **`static/js/composer.js`, `AgentBar` (around line 77):**
  - Rebuild the bar in the order agent › model › folder, then mode, then status, with a small `›` separator between
    the first three (use an existing chevron icon, `chevron-right`, at 12px in `--tx-3`).
  - Add a `ModelMenu` built from `Menu`/`MenuItem`/`MenuHead`. It has sections by category: `model` first, then
    `thought_level`, then `model_config` and boolean toggles. It is grouped when the options are grouped, and gets a
    search field above eight choices.
  - The button label is the current model's name, plus the effort name when there is one ("Opus · High").
  - Hide the button when the agent reports no model option.
  - Remove the mode button's legacy path when a `mode` config option exists.
- **`static/js/actions.js`:**
  - Add `setConfig(chatId, id, value)`. It is optimistic, rolls back on error, and inserts the "Switched to …"
    marker.
  - Add `loadAgentOptions(agentId)` for the home screen.
  - `send()` passes `config` when it creates an agent chat.
- **`static/js/main.js`, the ⌘M handler (around line 85):** in an agent chat, open the model menu instead of the
  picker.
- **`static/js/picker.js`:** an agent's detail panel lists its models from the cache.
- **`static/js/messages.js`:** the reply meta shows `agent_model` next to the agent name.
- **Writing.** Follow the canvas's Writing board: sentence case, plain words, no "Successfully". Examples: menu
  header "Model", hint "Change the model after this reply", notice "Switched to Sonnet".

### Check it with real agents

With the `.env` from step 0, in a real browser, at desktop width and at phone width (under 760px):

- **Claude Code:** pick Sonnet on the home screen and send. In a terminal, `ps` shows the adapter is running, and
  the reply meta says Sonnet. Switch to Opus mid-chat, send again, restart the server, reopen the chat, send again.
- **Codex:** the same. Also change the reasoning effort and confirm it sticks.
- **Hermes (if installed):** record what it reports. If it reports no models, there must be no model button.
- **Light and dark themes, keyboard only:** Tab reaches the model button, Enter opens the menu, the arrow keys move,
  Esc closes. Focus ring as in the Accessibility board.

### Done when

- [ ] Every walkthrough step above works with Claude Code and Codex.
- [ ] All old and new tests pass.
- [ ] The pull request has screenshots: the agent bar, the open model menu, the "Switched to" marker, and the phone
      layout.
- [ ] `docs/PLAN.md` (API table, events), `docs/DESIGN.md` and `docs/ROADMAP.md` (1.2) are updated.
- [ ] The pull request body says which adapter versions you tested and what Hermes reported.

---

## Milestones 2 to 9

The details of each item are in `docs/ROADMAP.md`, under the same number. Each milestone is one branch and one pull
request. "Done" always includes tests for server behaviour, screenshots for UI, and updated docs.

### Milestone 2: No dead controls (ROADMAP 1.1)

Remove these: People, Roles & access, Integrations, Share, and anything else the roadmap says will never be built.
Hide every control that a later milestone will build, and show it again in that milestone.

**Done when:** `grep -rn notInLite agentwebui_lite/static/js` finds only the definition in `lib.js`, or nothing.
Clicking every visible control does something real.

### Milestone 3: Hermes (ROADMAP 2.1)

Install Hermes. Run the full flow with `AGENT_HERMES_COMMAND=hermes acp`: new session, `session/load` after a
restart, modes, model options, permissions, diffs, cancel. Fix what differs. Add a test with the fake agent shaped
like whatever Hermes does differently.

**Done when:** a Hermes chat is as good as a Claude Code chat, and the pull request documents what Hermes supports
over ACP.

### Milestone 4: The rest of Tier 1 (ROADMAP 1.3–1.12)

These are separate small pull requests. Merge each one before starting the next.

| Item | Feature | Notes |
|---|---|---|
| 1.3 | Attachments | Model parts, and ACP `image`/`resource` blocks |
| 1.4 | Edit a sent message | |
| 1.5 | Pin and archive | |
| 1.6 | Export | |
| 1.7 | Temporary chat | |
| 1.8 | Settings › Chat and Defaults | Browser preferences |
| 1.9 | Temperature and max length | |
| 1.10 | Dictation and read aloud | **Browser speech only**, nothing on the server; hidden where unsupported |
| 1.11 | Branching | A reply records which message it answers, plus a "‹ 2 / 3 ›" switcher |
| 1.12 | Clone | |

Also show the agent's slash commands from `available_commands_update` when you type `/` in an agent chat.

### Milestone 5: Ready for the VPS (ROADMAP 2.2, 2.3, 2.4, 2.6)

- A Dockerfile and compose file, or a systemd unit, plus a Caddyfile for TLS with SSE buffering off.
- Trust `X-Forwarded-Proto` so the cookie is marked secure.
- A dedicated Unix user and a health endpoint.
- Login rate limiting.
- `FILES_ROOTS` in `.env` limits the agent folders.
- "Sign out everywhere".
- The read-only Account & security page.
- A backup command, with a cron line in the README.

**Done when:** a fresh Ubuntu VPS runs Lite behind HTTPS by following the README alone. Test it in a VM or
container if you have no VPS, and say so in the pull request.

### Milestone 6: Workspace & Git (ROADMAP 2.5)

- Browse, view and edit files under `FILES_ROOTS`.
- `git status`, `diff`, `commit`, `branch`, `push`, `pull` through the `git` command on the server.
- An agent chat opens on its own folder.
- No terminal and no full code editor.
- Paths outside the roots are refused, and a test covers that.

### Milestone 7: White label (ROADMAP 3.1, 3.2)

- `BRAND_NAME`, `BRAND_LOGO`, `BRAND_FAVICON`, `BRAND_ACCENT`, `BRAND_THEME`, `BRAND_GREETING`,
  `BRAND_POWERED_BY` in `.env`.
- They are served through `/api/config` and `/brand/*`, and apply to the page title, sidebar, sign-in, home,
  favicon, and a web manifest generated for installing the app.

**Done when:** the client contains no hard-coded "AgentWebUI" text, and changing the `.env` values and restarting
rebrands every screen.

### Milestone 8: Projects and prompt library (ROADMAP 3.3, 3.4)

- **Projects:** one SQLite table holding a folder, a default agent or model with its model options, and standing
  instructions. Chats are grouped under it.
- **Prompt library:** saved prompts inserted with `/`, next to the agent's own slash commands.

### Milestone 9: Web search toggle (ROADMAP 3.5)

The Web search chip turns **the agent's own** web search on or off. Lite never searches the web itself.

- Use a config option if the agent reports one. Otherwise use a per-agent launch setting in `.env`.
- Hide the chip for model chats and for agents with no switch.
- Record per agent what you found.

---

## How to report back

Each pull request body:

1. **What a person can now do:** two or three sentences, from the user's side.
2. **Screenshots:** for UI changes, desktop and phone.
3. **Checks run:** `pytest` output and the manual checks. Say which agent versions you tested.
4. **Configuration changes:** new `.env` keys, with their lines in `.env.example`.
5. **What is left or doesn't work:** be specific.

## When you are stuck

- An agent behaves differently from the protocol facts above: trust the agent and write down what it does. Cache
  the adapter's source under `~/.npm/_npx/*/node_modules/@agentclientprotocol/` and read it. Don't guess.
- A design question the canvas doesn't answer: follow the nearest existing screen, and list the decision in the pull
  request.
- Something here contradicts the code: the code is the current truth. Follow it, and note the contradiction.
- A feature would need a new dependency or service: stop. Write down why in the pull request instead of adding it.
