# Design

The client is built from the **AgentWebUI Redesign** canvas
(<https://claude.ai/artifact/1VveVZJQenG6mAaEsw9KEa>, 111 boards). The canvas covers the full product; Lite builds
every screen a person meets while chatting with a model or an agent, exactly as drawn, and leaves the rest.

Rules followed everywhere: the Foundations tokens (`static/css/tokens.css`), the icon set (`static/js/icons.js`), the
Motion durations and reduced-motion rules, the Accessibility focus and keyboard rules, and the Writing guidelines.

## Built and working

| Board | Where | Notes |
|---|---|---|
| Foundations | `css/tokens.css`, `css/base.css` | Every token, both themes, the three accents |
| Icons | `js/icons.js` | The named set, plus the few glyphs the screens draw |
| Chat · conversation (Main) | `js/chat.js`, `js/messages.js` | Messages, code blocks, reply actions and meta, context panel |
| Chat · new chat home (Home) | `js/home.js` | Greeting (`USER_NAME` in .env), big composer, starters, Jump back in |
| Model picker | `js/picker.js` | Every provider's models and the External agents group; search, tabs, ↑↓ ↵ ⌘↵, favorites |
| Command palette ⌘K | `js/palette.js` | Actions, chats by title and message text, settings |
| Agent in chat (AgentChat) | `js/messages.js`, `js/composer.js` | Agent bar (agent, folder, the agent's own modes, status), steps, approval card, Permissions and Trace tabs |
| Agent blocks | `js/messages.js` | Permission prompt and resolved line, tool call (running, done, failed), plan, reasoning, status line, notices, diff |
| Chat edge cases (ChatStates) | `js/messages.js` | Reply failed part-way with Retry and Try another model, stopped with Continue and Regenerate, no models |
| Rich replies | `js/markdown.js` | Headings, lists, tables, quotes, links, code with highlighting |
| Sidebar states | `js/sidebar.js` | Empty, grouped by day, row menu, inline rename, delete with confirm |
| Settings · appearance | `js/settings.js`, `js/prefs.js` | All eight themes, custom theme with the contrast check, fonts, code fonts, text size, density, preview |
| Settings · providers | `js/settings.js` | Providers and agents from .env with live status, Test, Models |
| Sign in | `js/states.js` | |
| App states (SystemStates) | `js/states.js` | Offline banner, loading, not found, page error |
| Mobile · chat, Tablet portrait, Tablet landscape | `css/app.css` | Phone header and composer under 760px, rail and drawer under 1024px, slide-over context panel under 1180px |
| Kit, Component states, Motion, Accessibility, Writing | throughout | Menus, dialogs, toasts, focus ring, keyboard order, reduced motion |
| Light mode boards | `css/tokens.css` | Every screen works in light and the other themes |

## Drawn but not running in Lite

These controls are on the built screens, as designed. Using one shows “… isn’t part of AgentWebUI Lite.”

Sidebar: Projects, Workspaces, Prompt library, Pin, Move to project, Clone, Share, Archive.
Header: Share, Export. Composer: Attach files, Web search, No project, Dictate.
Replies: Edit a sent message, Branch, Read aloud, Apply to workspace. Home: Temporary chat, Analyze a file, From library.
Context panel: Temperature and Max reply length (requests use the provider’s defaults).
Settings: Account & security, Chat, Voice, Integrations, Workspaces & Git, People, Roles & access, Defaults, Start page.
Good and Bad reply only toggle on the page.

## Where Lite differs from the boards, and why

- **Sign in** has one password field. Lite has no accounts: the password is `PASSWORD` in .env. The passkey,
  company sign-in, email and “Request an account” parts are left out because none of them could work.
- **Settings · providers**: “Add a provider” writes the lines to paste into .env, since Lite is configured only there.
  The same card exists for agents (Claude Code, Codex, Hermes, Pi, Gemini CLI, OpenCode).
- **No usage meter, announcement bar, Pinned or Folders section** in the sidebar: Lite has no data for them, and an
  invented number would be wrong.
- **The account button** shows `USER_NAME` (or “You”) and “On this computer” instead of a role.
- **Context panel**: the board’s context-window bar needs the model’s limit, which an OpenAI-compatible API does not
  report, so the panel shows what is sent (from the provider’s token count when it reports one).
- **Notifications** (the bell) turn on browser notifications for replies that need you or finish in the background.
- **Fonts**: Geist and Geist Mono ship with the app. Inter, IBM Plex, Plus Jakarta Sans, Atkinson Hyperlegible, Source
  Serif, JetBrains Mono and Fira Code load from Google Fonts only when chosen.
- **Maths** in replies shows as inline code; KaTeX would add about 1 MB.

## Not built (whole boards for features outside Lite)

Admin (people, roles, access, system, sandbox, agents and voice, shared providers, more), projects, sharing, folders,
organize chats, compaction, knowledge and memory, prompt library and slash commands, workflows, usage and API tokens,
backup, voice mode, terminal and workspace panels, change review, artifacts, agent builder and agents page, plugins,
tool policies, MCP in chat, setup and access states, security flows, the agent question cards (AgentAsk, AskTypes,
AskSchema: ACP has no question message yet), agent identity and pairing, and the phone screens for those features.
