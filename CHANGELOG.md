# Changelog

Notable changes to AgentWebUI, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/): while the version starts with 0, a minor release may
change settings or behavior, and its entry says how.

## [Unreleased]

### Added

- Contributor guide, Code of Conduct, security policy and support page; issue forms for bugs, features,
  agent or provider compatibility and docs; Discussions forms for Q&A, Ideas, Show and tell and General; a pull
  request template; and tests on Python 3.11 to 3.14 for every pull request.

### Changed

- AgentWebUI is released under the MIT license, copyright HackersHostel. It was proprietary. The project is now
  called AgentWebUI; the package, command and install paths keep the name `agentwebui-lite`.
- The new AgentWebUI logo, in the ink of each theme and accent. The installed app gets 192, 512 and maskable icons.
  `BRAND_LOGO` still replaces it everywhere.
- The model picker lists connected agents first, and its tabs read All, Connected Agents, On this machine, Favorites.

### Fixed

- Every theme's button, muted, accent, status and code text meets 4.5:1 contrast. Paper no longer uses the dark
  theme's status and code colors, and pressed buttons keep the theme's own color.

### Removed

- The PyPI release workflow. The `agentwebui-lite` package on PyPI is not published from this repository.
- The `docs/` folder of planning notes and screenshots.

## [0.2.0] - 2026-10-20

### Added

- `LOGIN_EMAIL`: with `PASSWORD`, sign-in asks for this email as well.
- `AGENT_<ID>_MODELS`: the agent's model menu offers only these models, in this order.

### Fixed

- `AGENT_IDLE_MINUTES` is read as a setting again. In 0.1.0, setting it stopped the server at start with
  "AGENT_IDLE_COMMAND is missing".

## [0.1.0] - 2026-10-20

The first release.

- Chat with any OpenAI-compatible API, and with any agent that speaks the Agent Client Protocol over stdio, all
  configured in `.env`.
- Agent chats with the agent's own models, effort, modes and slash commands, streamed thinking, plans, tool calls
  and diffs, and permission requests.
- Attachments in, files and images out, `choices` pickers, message versions and branching, projects, temporary
  chats, search, Files and Git, voice, notifications with a webhook, branding and themes.
- Managed mode for a site that frames the page: `FRAME_ANCESTORS`, one-time `/embed` links signed with
  `EMBED_SECRET`, `LOCK_MODEL` and `LOCK_FOLDER`.
- A VPS install script with systemd and Caddy, a Docker image and compose file, and `agentwebui-lite backup`.

[Unreleased]: https://github.com/HackersHostel/AgentWebUI/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/HackersHostel/AgentWebUI/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/HackersHostel/AgentWebUI/releases/tag/v0.1.0
