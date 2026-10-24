# AgentWebUI with Claude Code and Codex. See README › Docker. Published as ghcr.io/hackershostel/agentwebui;
# the -slim tags are built with AGENTS= and have no agents (or Node.js), only model providers.
FROM python:3.12-slim

ARG AGENTS="claude,codex"
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates openssh-client \
    && if [ -n "$AGENTS" ]; then \
         curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y --no-install-recommends nodejs \
         && case ",$AGENTS," in *",claude,"*) npm install -g @anthropic-ai/claude-code @agentclientprotocol/claude-agent-acp;; esac \
         && case ",$AGENTS," in *",codex,"*) npm install -g @openai/codex @agentclientprotocol/codex-acp;; esac \
         && npm cache clean --force; \
       fi \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 agentwebui && mkdir -p /data /work && chown agentwebui /data /work
WORKDIR /app
COPY pyproject.toml README.md ./
COPY agentwebui_lite ./agentwebui_lite
RUN pip install --no-cache-dir .

USER agentwebui
# TRUST_PROXY stays off: with it on and no proxy in front, a client could claim any address and dodge the sign-in
# limit. docker-compose.yml turns it on for Caddy.
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/data WORKSPACE_DIR=/work FILES_ROOTS=/work AWL_ENV_FILE=/app/.env
EXPOSE 3000
VOLUME ["/data", "/work", "/home/agentwebui"]
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["agentwebui-lite"]
