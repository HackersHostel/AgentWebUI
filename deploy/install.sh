#!/usr/bin/env bash
# Install AgentWebUI on a fresh Ubuntu (22.04+) or Debian (12+) server: a dedicated user, a Python venv, a
# systemd service, Claude Code and Codex over ACP, Caddy for HTTPS, and a daily backup. Run it again to update.
#
#   sudo DOMAIN=chat.example.com ./deploy/install.sh            # from a checkout
#   curl -fsSL https://raw.githubusercontent.com/HackersHostel/AgentWebUI/main/deploy/install.sh \
#     | sudo DOMAIN=chat.example.com bash                        # straight from GitHub
#
# DOMAIN    the name that points at this server; Caddy gets its certificate. Empty: no Caddy, and the app answers
#           only on 127.0.0.1 (reach it with an SSH tunnel or Tailscale).
# AGENTS    which agents to install: "claude,codex" (default), "claude", "codex" or "" for none.
# APP_USER  the Unix user the app and its agents run as (default agentwebui).
set -euo pipefail

DOMAIN=${DOMAIN:-}
AGENTS=${AGENTS-claude,codex}
APP_USER=${APP_USER:-agentwebui}
PORT=${PORT:-3000}
REPO=${REPO:-https://github.com/HackersHostel/AgentWebUI.git}
BRANCH=${BRANCH:-main}
PREFIX=${PREFIX:-/opt/agentwebui}
CONF=/etc/agentwebui
DATA=/var/lib/agentwebui
HOME_DIR=/home/$APP_USER
WORK=$HOME_DIR/work

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
command -v apt-get >/dev/null || { echo "This installer needs apt (Ubuntu or Debian). See README for Docker." >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "Installing system packages"
apt-get update -qq
apt-get install -y -qq python3 python3-venv git curl ca-certificates sqlite3 >/dev/null
if [ -n "$AGENTS" ] && ! command -v node >/dev/null; then
  say "Installing Node.js 22 for the agents"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

say "Creating the $APP_USER user"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$HOME_DIR" --shell /bin/bash "$APP_USER"
mkdir -p "$DATA" "$WORK" "$CONF"
chown "$APP_USER:$APP_USER" "$DATA" "$WORK"
chmod 750 "$DATA"

say "Getting the code into $PREFIX"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)
if [ -n "$HERE" ] && [ -f "$HERE/../pyproject.toml" ]; then
  mkdir -p "$PREFIX"
  (cd "$HERE/.." && tar --exclude=.git --exclude=.venv --exclude=data --exclude=.env -cf - .) | (cd "$PREFIX" && tar -xf -)
elif [ -d "$PREFIX/.git" ]; then
  git -C "$PREFIX" fetch -q origin "$BRANCH" && git -C "$PREFIX" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$PREFIX"
fi
python3 -m venv "$PREFIX/.venv"
"$PREFIX/.venv/bin/pip" install -q --upgrade pip
"$PREFIX/.venv/bin/pip" install -q "$PREFIX"

agent_lines=""
if [[ ",$AGENTS," == *",claude,"* ]]; then
  say "Installing Claude Code and its ACP adapter"
  npm install -g --silent @anthropic-ai/claude-code @agentclientprotocol/claude-agent-acp >/dev/null
  agent_lines+=$'AGENT_CLAUDE_COMMAND=claude-agent-acp\nAGENT_CLAUDE_NAME=Claude Code\n'
fi
if [[ ",$AGENTS," == *",codex,"* ]]; then
  say "Installing Codex and its ACP adapter"
  npm install -g --silent @openai/codex @agentclientprotocol/codex-acp >/dev/null
  agent_lines+=$'AGENT_CODEX_COMMAND=codex-acp\nAGENT_CODEX_NAME=Codex\n'
fi

if [ ! -f "$CONF/.env" ]; then
  say "Writing $CONF/.env"
  PASSWORD=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)
  {
    echo "# AgentWebUI on this server. Edit, then: sudo systemctl restart agentwebui"
    echo "HOST=127.0.0.1"
    echo "PORT=$PORT"
    echo "PASSWORD=$PASSWORD"
    echo "DATA_DIR=$DATA"
    echo "WORKSPACE_DIR=$WORK"
    echo "FILES_ROOTS=$WORK"
    echo "TRUST_PROXY=$([ -n "$DOMAIN" ] && echo true || echo false)"
    echo "# NOTIFY_WEBHOOK=https://hooks.slack.com/services/…"
    echo "# BRAND_NAME=Your name"
    echo "# BRAND_LOGO=/etc/agentwebui/logo.svg"
    echo
    echo "# Models: any OpenAI-compatible API (see $PREFIX/.env.example)"
    echo "# PROVIDER_OPENROUTER_URL=https://openrouter.ai/api/v1"
    echo "# PROVIDER_OPENROUTER_KEY=sk-or-…"
    echo
    printf '%s' "$agent_lines"
  } > "$CONF/.env"
  NEW_PASSWORD=$PASSWORD
fi
chown root:"$APP_USER" "$CONF/.env"
chmod 640 "$CONF/.env"

say "Installing the service"
install -m 644 "$PREFIX/deploy/agentwebui.service" /etc/systemd/system/agentwebui.service
sed -i "s#^User=.*#User=$APP_USER#; s#^Group=.*#Group=$APP_USER#; s#/home/agentwebui#$HOME_DIR#g; s#/opt/agentwebui#$PREFIX#g" \
  /etc/systemd/system/agentwebui.service
cat > /etc/cron.d/agentwebui <<CRON
# Daily copy of the chats database at 03:17, the last 14 kept.
17 3 * * * $APP_USER cd $DATA && [ -f chats.db ] && AWL_ENV_FILE=$CONF/.env $PREFIX/.venv/bin/agentwebui backup >/dev/null && ls -1t $DATA/backups/*.db | tail -n +15 | xargs -r rm --
CRON
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload
  systemctl enable --now agentwebui >/dev/null 2>&1
  systemctl restart agentwebui
else
  echo "No systemd here (a container?). Start it with:"
  echo "  sudo -u $APP_USER AWL_ENV_FILE=$CONF/.env $PREFIX/.venv/bin/agentwebui"
fi

if [ -n "$DOMAIN" ]; then
  say "Installing Caddy for https://$DOMAIN"
  if ! command -v caddy >/dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  sed "s#{\$DOMAIN}#$DOMAIN#; s#{\$UPSTREAM:127.0.0.1:3000}#127.0.0.1:$PORT#" "$PREFIX/deploy/Caddyfile" > /etc/caddy/Caddyfile
  [ -d /run/systemd/system ] && systemctl reload caddy || true
fi

say "Checking it answers"
for _ in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && echo "Healthy." || echo "Not answering yet: journalctl -u agentwebui"

say "Done"
echo "Open:      ${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://127.0.0.1:$PORT (ssh -L $PORT:127.0.0.1:$PORT this-server)}"
[ -n "${NEW_PASSWORD:-}" ] && echo "Password:  $NEW_PASSWORD   (PASSWORD in $CONF/.env)"
echo "Settings:  $CONF/.env, then: sudo systemctl restart agentwebui"
echo "Files:     agents work in $WORK; clone repositories there from the Files page"
[[ ",$AGENTS," == *",claude,"* ]] && echo "Claude:    sign in once: sudo -iu $APP_USER claude   (then /login)"
[[ ",$AGENTS," == *",codex,"* ]] && echo "Codex:     sign in once: sudo -iu $APP_USER codex login --device-auth"
echo "Git:       give $APP_USER a deploy key (sudo -iu $APP_USER ssh-keygen -t ed25519) to push and pull"
