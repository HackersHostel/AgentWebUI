"""Settings from the environment and a `.env` file. The environment wins over the file.

Models:  PROVIDER_<ID>_URL, PROVIDER_<ID>_KEY, PROVIDER_<ID>_MODELS (comma list; else asked from <url>/models),
         PROVIDER_<ID>_NAME, PROVIDER_<ID>_LOCAL (true or false: whether its models are local, in place of the check)
Agents:  AGENT_<ID>_COMMAND (an ACP agent's command line), AGENT_<ID>_NAME, AGENT_<ID>_CWD, AGENT_<ID>_MODEL,
         AGENT_<ID>_MODELS (comma list; the only models the page offers for that agent)
Files:   FILES_ROOTS (folders the file manager may open and agents may work in; else WORKSPACE_DIR and agent folders)
A value may name another variable as ${NAME}, so keys can stay in the shell environment.
"""
from __future__ import annotations

import ipaddress
import os
import re
import shlex
from dataclasses import dataclass, field
from pathlib import Path

ID = re.compile(r"^(PROVIDER|AGENT)_([A-Z0-9]+)_([A-Z]+)$")
SETTINGS_LIKE_IDS = {"AGENT_IDLE_MINUTES"}  # shaped like an agent key, but a server setting
VARIABLE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    url: str
    key: str = ""
    models: tuple[str, ...] = ()
    local: bool | None = None  # PROVIDER_<ID>_LOCAL; None: decided by `locality`


@dataclass(frozen=True)
class Agent:
    id: str
    name: str
    command: tuple[str, ...]
    cwd: str
    model: str = ""  # the model a new chat starts on when the browser has no choice saved
    models: tuple[str, ...] = ()  # when set, the only models the page offers, whatever the agent lists


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 3000
    data_dir: Path = Path("data")
    password: str = ""
    login_email: str = ""  # when set, signing in asks for this email as well as PASSWORD
    user_name: str = ""
    system_prompt: str = ""
    workspace: str = ""
    agent_idle_minutes: float = 10
    providers: tuple[Provider, ...] = ()
    agents: tuple[Agent, ...] = field(default_factory=tuple)
    files_roots: tuple[str, ...] = ()
    trust_proxy: bool = False
    notify_webhook: str = ""
    rich_replies: bool = True
    upload_mb: int = 25
    brand_name: str = "AgentWebUI"
    brand_logo: str = ""
    brand_greeting: str = ""
    brand_accent: str = ""
    brand_theme: str = ""
    embed_secret: str = ""  # signs the one-time links that let a page that frames this one sign the browser in
    frame_ancestors: tuple[str, ...] = ()  # pages that may show this one in a frame; else only this server
    lock_model: bool = False  # the agent's model is set in .env, not in the page
    lock_folder: bool = False  # agent chats always work in the agent's folder

    def provider(self, provider_id: str) -> Provider | None:
        return next((p for p in self.providers if p.id == provider_id), None)

    def agent(self, agent_id: str) -> Agent | None:
        return next((a for a in self.agents if a.id == agent_id), None)

    @property
    def roots(self) -> tuple[str, ...]:
        """Where the file manager may look and agents may work: FILES_ROOTS, or the folders .env already names."""
        if self.files_roots:
            return self.files_roots
        found: list[str] = []
        for folder in (self.workspace, *(a.cwd for a in self.agents)):
            if folder and folder not in found:
                found.append(folder)
        return tuple(found)

    def allowed(self, path: str) -> bool:
        resolved = Path(path).resolve()
        return any(resolved == Path(root).resolve() or Path(root).resolve() in resolved.parents for root in self.roots)


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, sep, value = line.partition("=")
        if not sep:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = value.split(" #", 1)[0].rstrip()
        values[key.strip()] = value
    return values


def load(env_file: Path | None = None, environ: dict[str, str] | None = None) -> Settings:
    env = read_env_file(env_file or Path(os.environ.get("AWL_ENV_FILE", ".env")))
    env.update(os.environ if environ is None else environ)
    env = {key: VARIABLE.sub(lambda m: env.get(m[1], ""), value) for key, value in env.items()}  # ${NAME}

    groups: dict[tuple[str, str], dict[str, str]] = {}
    for key, value in env.items():
        match = ID.match(key)
        if match and key not in SETTINGS_LIKE_IDS:
            groups.setdefault((match[1], match[2].lower()), {})[match[3]] = value

    workspace = env.get("WORKSPACE_DIR", "") or str(Path.home())
    providers, agents = [], []
    for (kind, ident), values in sorted(groups.items()):
        if kind == "PROVIDER":
            url = values.get("URL", "").rstrip("/")
            if not url:
                raise ConfigError(f"PROVIDER_{ident.upper()}_URL is missing")
            models = tuple(m.strip() for m in values.get("MODELS", "").split(",") if m.strip())
            local = values.get("LOCAL", "").strip().lower()
            if local and local not in ("1", "true", "yes", "on", "0", "false", "no", "off"):
                raise ConfigError(f"PROVIDER_{ident.upper()}_LOCAL takes true or false, not {values['LOCAL']!r}")
            providers.append(Provider(ident, values.get("NAME") or ident, url, values.get("KEY", ""), models,
                                      _yes(local) if local else None))
        else:
            command = tuple(shlex.split(values.get("COMMAND", "")))
            if not command:
                raise ConfigError(f"AGENT_{ident.upper()}_COMMAND is missing")
            models = tuple(m.strip() for m in values.get("MODELS", "").split(",") if m.strip())
            agents.append(Agent(ident, values.get("NAME") or ident, command,
                                os.path.expanduser(values.get("CWD") or workspace), values.get("MODEL", ""), models))

    try:
        port = int(env.get("PORT", "3000"))
        idle = float(env.get("AGENT_IDLE_MINUTES", "10"))
        upload_mb = int(env.get("UPLOAD_MB", "25"))
    except ValueError as exc:
        raise ConfigError(f"not a number: {exc}") from None
    roots = tuple(str(Path(os.path.expanduser(r.strip())).resolve())
                  for r in env.get("FILES_ROOTS", "").split(",") if r.strip())
    settings = Settings(
        host=env.get("HOST", "127.0.0.1"), port=port, data_dir=Path(env.get("DATA_DIR", "data")),
        password=env.get("PASSWORD", ""), login_email=env.get("LOGIN_EMAIL", "").strip().lower(), user_name=env.get("USER_NAME", "").strip()[:60],
        system_prompt=env.get("SYSTEM_PROMPT", ""),
        workspace=os.path.expanduser(workspace), agent_idle_minutes=idle,
        providers=tuple(providers), agents=tuple(agents), files_roots=roots,
        trust_proxy=_yes(env.get("TRUST_PROXY", "")), notify_webhook=env.get("NOTIFY_WEBHOOK", "").strip(),
        rich_replies=_yes(env.get("RICH_REPLIES", "true")), upload_mb=max(upload_mb, 1),
        brand_name=env.get("BRAND_NAME", "").strip()[:40] or "AgentWebUI", brand_logo=env.get("BRAND_LOGO", "").strip(),
        brand_greeting=env.get("BRAND_GREETING", "").strip()[:120], brand_accent=env.get("BRAND_ACCENT", "").strip(),
        brand_theme=env.get("BRAND_THEME", "").strip(),
        embed_secret=env.get("EMBED_SECRET", "").strip(),
        frame_ancestors=tuple(env.get("FRAME_ANCESTORS", "").split()),
        lock_model=_yes(env.get("LOCK_MODEL", "")), lock_folder=_yes(env.get("LOCK_FOLDER", "")))
    if not settings.password and not is_loopback(settings.host):
        raise ConfigError(f"HOST={settings.host} is reachable from other machines: set PASSWORD in .env")
    if settings.login_email and not settings.password:
        raise ConfigError("LOGIN_EMAIL is asked for together with PASSWORD, so it needs PASSWORD too")
    if settings.embed_secret and not settings.password:
        raise ConfigError("EMBED_SECRET signs browsers in, so it needs PASSWORD too")
    if settings.embed_secret and len(settings.embed_secret) < 32:
        raise ConfigError("EMBED_SECRET is too short: use at least 32 characters")
    bad = [a for a in settings.frame_ancestors if not a.startswith(("https://", "http://"))]
    if bad:
        raise ConfigError(f"FRAME_ANCESTORS takes full origins like https://app.example.com, not {bad[0]!r}")
    return settings


def _yes(value: str) -> bool:
    return value.strip().lower() in ("1", "true", "yes", "on")


def is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False
