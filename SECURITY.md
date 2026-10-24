# Security policy

AgentWebUI lets whoever signs in make an agent run commands on the server. We take reports about getting past that
boundary seriously.

## Report a vulnerability

**Don't open a public issue, discussion or pull request.** Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/HackersHostel/AgentWebUI/security/advisories/new).

Include what you can of:

- what an attacker can do, and what they need first (network access, a signed-in browser, a crafted file, …)
- steps or a proof of concept against a local install
- the commit or version you tested, and your relevant `.env` settings (without secrets)

We'll acknowledge the report, keep you updated while we work on it, and credit you in the advisory unless you'd
rather we didn't. Please give us a reasonable chance to release a fix before you disclose it publicly.

## Supported versions

Fixes land on `main` and in the next release. Only the latest release and `main` are supported; please update before
reporting.

## In scope

Things AgentWebUI promises, so breaking them is a vulnerability:

- Reaching the app or its API without the password, or getting around the sign-in rate limit
  (8 wrong passwords per address per 10 minutes)
- Forging or reusing an `/embed?token=` link, or getting framed by a site not in `FRAME_ANCESTORS`
- Reading, writing or listing files outside `FILES_ROOTS`, or outside an agent chat's folder through ACP
- An uploaded or agent-written file (HTML, SVG, …) running script as the page
- Script injection through replies, Markdown, `choices` or `file` blocks, chat titles or file names
- An agent acting without the permission prompt when the agent asked for one
- Secrets from `.env` (`PASSWORD`, `EMBED_SECRET`, provider keys) reaching the browser or the logs
- Problems in `deploy/install.sh`, the systemd unit, the Caddyfile or the Docker image that weaken a default install

## Not in scope

These are how AgentWebUI is designed, and the README says so:

- Someone with the password can make an agent run commands as the app's user. AgentWebUI has no sandbox and no user
  accounts; contain the server with the operating system, a container or a VM.
- Without `PASSWORD` the server answers anyone who can reach it. It only listens on localhost in that case.
- What an agent itself does once you allow it, and vulnerabilities in the agents, model providers or `aiohttp`.
  Report those upstream.

For hardening a deployment, see [Keep it safe](README.md#keep-it-safe) in the README.
