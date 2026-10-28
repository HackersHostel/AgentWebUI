# HTTP API

The web page talks to the server through this API, and so can your own scripts. It is JSON over HTTP, and a reply
streams back as [server-sent events](#replies-as-server-sent-events). The routes are in `agentwebui/server.py`.

The API follows the app, not a version number: a release can change it, and the [changelog](../CHANGELOG.md) says
when one does.

## Requests and errors

- Send JSON with `Content-Type: application/json` on every `POST`, `PATCH` and `DELETE` that has a body. Anything
  else is refused with `415 send JSON`.
- A request with an `Origin` header from another site is refused with `403 cross-site request refused`. Scripts
  that send no `Origin` are fine.
- Without `PASSWORD`, the server answers only requests addressed to `localhost`, `127.0.0.1` or `[::1]`. Any other
  `Host` gets `403 this server only answers on localhost`, which also stops DNS-rebinding pages.
- Errors come back as `{"error": "what went wrong"}` with a status code: `401` sign in first, `403` not allowed,
  `404` not found, `409` a reply is still running (or the agent refused), `413` too large, `422` the request
  doesn't make sense, `429` too many wrong passwords, `502` the agent couldn't start.

## Signing in

Without `PASSWORD` there is nothing to sign in to: every route is open to this machine.

With `PASSWORD`, every route needs the `awl_session` cookie except these, which are always open:

| Route | Why it is open |
|---|---|
| `GET /` | The page itself, which shows the sign-in form |
| `GET /assets/…` | The page's scripts, styles and fonts |
| `GET /api/health` | `{"status": "ok", "version": "0.3.0"}` for health checks |
| `GET /api/session` | `{"password_required", "email_required", "signed_in"}` |
| `POST /api/login` | Sign in |
| `GET /manifest.webmanifest`, `GET /brand/logo` | So a phone can install the page as an app |
| `GET /embed?token=…` | [One-time sign-in links](#signing-embed-links) for a site that frames the page |

`POST /api/login` takes `{"password": "…"}`, plus `"email"` when `LOGIN_EMAIL` is set, and sets the cookie. It
answers `401` for a wrong password and `429` after 8 wrong tries from one address in 10 minutes. `POST /api/logout`
clears the cookie.

The cookie is an HMAC of `PASSWORD` keyed with `DATA_DIR/secret.key`. It lasts 30 days, is `HttpOnly` and
`SameSite=Strict`, and is `Secure` over HTTPS. With `FRAME_ANCESTORS` set it is `SameSite=None; Secure`, so a framing
site needs HTTPS. Changing `PASSWORD` or losing `secret.key` signs every browser out.

From a script, keep the cookie in a jar:

```bash
curl -c jar -H 'Content-Type: application/json' -d '{"password": "…"}' http://127.0.0.1:3000/api/login
curl -b jar http://127.0.0.1:3000/api/chats
```

## Routes

`{id}` is a chat, project, file or agent id. Ids of temporary chats start with `t`.

### Settings and agents

| Route | What it does |
|---|---|
| `GET /api/config` | Models, providers, agents (with their cached options), shared folders, brand and limits. `?refresh=1` asks the providers for their models again. |
| `GET /api/agents/{id}/options` | The agent's options (models, effort, toggles): cached, or by starting the agent once. `?refresh=1` asks again. |

### Chats

| Route | What it does |
|---|---|
| `GET /api/chats` | Every saved chat, pinned first, then the most recently changed, with `running` and `waiting` |
| `POST /api/chats` | Create one: `{"target": "model:<provider>/<model>"` or `"agent:<id>", "cwd", "config", "project_id", "title", "temporary"}`. `201` |
| `GET /api/chats/{id}` | The chat and the thread on screen (`messages`); for an agent chat, also the agent's state |
| `PATCH /api/chats/{id}` | Change `title`, `pinned`, `archived`, `project_id`; for a model chat also `config` (`temperature` 0 to 2, `max_tokens`, `instructions`) and `target` (another model) |
| `DELETE /api/chats/{id}` | Delete it and its files. `409` while a reply runs. `204` |
| `POST /api/chats/{id}/clone` | Copy the chat, or with `{"upto": <message id>}` branch it from that message. `201` |
| `GET /api/search?q=` | Chats whose title or messages match |

### Replies

| Route | What it does |
|---|---|
| `POST /api/chats/{id}/messages` | Send `{"text", "files": [<file ids>], "edit": <message id>}`. The response is the reply, as events. `edit` makes it a new version of that message (model chats only). |
| `POST /api/chats/{id}/retry` | Answer the last message again, as a new version. The response is the reply, as events. |
| `GET /api/chats/{id}/events` | Follow a reply that is still running, from its first event. `204` when none is. |
| `POST /api/chats/{id}/cancel` | Stop the reply. `202`, or `204` when none is running |
| `POST /api/chats/{id}/version` | Show the thread through another version: `{"message": <message id>}` |
| `POST /api/chats/{id}/permissions/{question}` | Answer an agent's permission question: `{"option": "<option id>"}`. `204`, or `404` when it is no longer open |
| `POST /api/chats/{id}/mode` | Switch an agent chat's mode: `{"mode": "<mode id>"}` |
| `POST /api/chats/{id}/config` | Change an agent option: `{"id": "<option id>", "value": "<choice>"` or `true`/`false}`. `409` while a reply runs, `422` for an unknown option or choice, `403` for the model with `LOCK_MODEL` |

A chat runs one reply at a time; sending while one runs gives `409`. The reply carries on when the request that
started it closes, so a script can send, disconnect, and pick it up again from `/events`.

### Files

| Route | What it does |
|---|---|
| `POST /api/files` | Attach a file: `{"name", "type", "data": "<base64>"}`, or `{"path"}` of a file in a shared folder. Up to `UPLOAD_MB`. Answers `{"id", "name", "mime", "size"}` with `201`; send the `id` in a message's `files`. |
| `GET /api/files/{id}` | The file. `?download=1` to download it. |
| `GET /api/chats/{id}/local?path=` | A file in the agent chat's folder, such as one the agent wrote. `?download=1` to download it. |

Files are served with `Content-Security-Policy: sandbox` and `nosniff`, so an HTML or SVG file can't run as the page.

### Projects

| Route | What it does |
|---|---|
| `GET /api/projects` | Every project |
| `POST /api/projects` | Create one: `{"name", "folder", "target", "instructions", "config"}`. `201` |
| `PATCH /api/projects/{id}` | Change any of those fields |
| `DELETE /api/projects/{id}` | Delete it. `204` |

### Files and Git inside `FILES_ROOTS`

Every `path` must be inside a shared folder (`403` otherwise).

| Route | What it does |
|---|---|
| `GET /api/fs/roots` | The shared folders |
| `GET /api/fs/list?path=` | A folder's entries. `&hidden=1` includes hidden ones. |
| `GET /api/fs/read?path=` | A text file's content |
| `GET /api/fs/raw?path=` | The file itself. `&download=1` to download it. |
| `GET /api/fs/find?path=&q=` | Files whose name matches, for Go to file |
| `GET /api/fs/grep?path=&q=` | Lines that match. `&regex=1`, `&case=1`, `&include=*.py` |
| `POST /api/fs/write` | `{"path", "content", "create"}` |
| `POST /api/fs/upload` | `{"folder", "name", "data": "<base64>"}`. `201` |
| `POST /api/fs/mkdir` | `{"path"}`. `201` |
| `POST /api/fs/rename` | `{"path", "to"}` |
| `POST /api/fs/delete` | `{"path"}`. `204` |
| `GET /api/git/status?path=` | Branch, upstream and changed files |
| `GET /api/git/diff?path=&file=` | The diff of one file |
| `GET /api/git/log?path=` | Recent commits |
| `GET /api/git/branches?path=` | Branches |
| `POST /api/git/commit` | `{"path", "message", "files": [<paths>]}`; without `files`, everything |
| `POST /api/git/switch` | `{"path", "branch", "create"}` |
| `POST /api/git/sync` | `{"path", "action"}`: `push`, `pull` (fast-forward only) or `fetch` |
| `POST /api/git/init` | `{"path"}` |
| `POST /api/git/clone` | `{"url", "into"}`. `201` |

## Replies as server-sent events

`POST /api/chats/{id}/messages`, `POST /api/chats/{id}/retry` and `GET /api/chats/{id}/events` answer with
`Content-Type: text/event-stream`. Each event is one `data:` line holding a JSON object with a `type`, followed by a
blank line. The last event is always `end`.

This is a model's whole reply to "How do we ship the next release?":

```
data: {"type": "user", "message": {"id": 1, "chat_id": "3ccac7dfaf5addab", "role": "user", "content": "How do we ship the next release?", "parts": [], "meta": {}, "created_at": 1792923020.14, "parent": 0, "siblings": [1]}}

data: {"type": "thought", "text": "The user wants release steps."}

data: {"type": "delta", "text": "Here is a short plan for the release:\n\n"}

data: {"type": "delta", "text": "1. **Freeze** `main` on Thursday.\n"}

data: {"type": "delta", "text": "Want me to draft the changelog?"}

data: {"type": "message", "message": {"id": 2, "chat_id": "3ccac7dfaf5addab", "role": "assistant", "content": "Here is a short plan for the release:\n\n1. **Freeze** `main` on Thursday.\nWant me to draft the changelog?", "parts": [{"type": "thought", "text": "The user wants release steps.", "seconds": 0.1}, {"type": "text", "text": "Here is a short plan …"}], "meta": {"model": "openai/gpt-4.1", "finish": "stop", "usage": {"prompt_tokens": 12, "completion_tokens": 48}, "seconds": 0.41}, "created_at": 1792923020.55, "parent": 1, "siblings": [2]}}

data: {"type": "end"}
```

An agent's reply adds its plan, tool calls and a permission question (shortened):

```
data: {"type": "modes", "modes": {"current": "ask", "option": "mode", "available": [{"id": "ask", "name": "Ask first", "description": ""}, …]}}
data: {"type": "plan", "part": {"type": "plan", "id": "plan", "items": [{"text": "Write hello.txt", "status": "in_progress"}]}}
data: {"type": "tool", "part": {"type": "tool", "id": "t1", "title": "Write hello.txt", "kind": "edit", "status": "pending", "input": "/home/sam/work/hello.txt", "locations": ["/home/sam/work/hello.txt"], "output": "", "diffs": []}}
data: {"type": "permission", "part": {"type": "permission", "id": "5e14cf378ef9", "state": "waiting", "title": "Write hello.txt", "kind": "edit", "input": "/home/sam/work/hello.txt", "options": [{"id": "allow", "name": "Allow once", "kind": "allow_once"}, {"id": "reject", "name": "Reject", "kind": "reject_once"}], "answer": null, "expires_in": 600}}
data: {"type": "permission_answered", "part": {"type": "permission", "id": "5e14cf378ef9", "state": "answered", "answer": "allow", "answer_name": "Allow once", "answer_kind": "allow_once", …}}
data: {"type": "tool", "part": {"type": "tool", "id": "t1", "status": "completed", "diffs": [{"path": "/home/sam/work/hello.txt", "old": "", "new": "hello\n"}], "seconds": 0.5, …}}
data: {"type": "part", "part": {"type": "outputs", "id": "outputs", "paths": ["/home/sam/work/hello.txt"]}}
```

To answer that question, `POST /api/chats/{id}/permissions/5e14cf378ef9` with `{"option": "allow"}`. Unanswered, it
expires after 600 seconds and the agent is told the request was cancelled.

| Event | Payload | When |
|---|---|---|
| `user` | `message`: the message just sent, saved | First, when you send a message |
| `delta` | `text`: the next piece of the answer | As the answer streams |
| `thought` | `text`: the next piece of reasoning | As the model or agent thinks |
| `plan` | `part`: the whole plan, `{"type": "plan", "items": [{"text", "status"}]}` | When an agent's plan changes |
| `tool` | `part`: the whole tool call, `{"id", "title", "kind", "status", "input", "locations", "output", "diffs", "seconds"}` | When an agent starts or updates a tool call |
| `part` | `part`: a `file` the agent sent (`{"id", "name", "mime", "size"}`, or `path`/`url` for a link) or the `outputs` it changed (`{"paths"}`) | When an agent sends a file, and at the end |
| `permission` | `part`: the question, its `options` and `expires_in` | When an agent asks before it acts |
| `permission_answered` | `part`: the same, with `state` (`answered`, `expired` or `cancelled`) and the `answer` | When it is answered or runs out |
| `modes` | `modes`: `{"current", "available": [{"id", "name", "description"}]}` | At the start of an agent reply, and when the mode changes |
| `config` | `config`: the agent's options with their current values; `modes` | At the start of an agent reply, and when an option changes |
| `commands` | `commands`: the agent's slash commands, `[{"name", "description", "hint"}]` | When the agent lists them |
| `notice` | `text`: something worth knowing, such as the agent having restarted | Any time |
| `error` | `message`: why the reply failed | When it fails; `message` and `end` still follow |
| `message` | `message`: the reply as saved, with its `parts` and `meta` | Last but one, always |
| `end` | nothing | Last, always |

A saved message has `id`, `chat_id`, `role` (`user` or `assistant`), `content` (the text), `parts`, `meta`,
`created_at`, `parent` (the message it follows) and `siblings` (the ids of its other versions). A reply's `parts`
are what the page draws: `text`, `thought` (with `seconds`), `plan`, `tool`, `permission`, `file` and `outputs`. Its
`meta` can hold `model` or `agent` and `agent_model`, `usage`, `finish` or `stop_reason`, `seconds`, and `error`.

## Signing embed links

A site that shows AgentWebUI in a frame (`FRAME_ANCESTORS`) can sign the browser in without a password prompt: it
opens the frame at a one-time `/embed?token=…` link, signed with `EMBED_SECRET` (32 characters or more, and the server
needs `PASSWORD`).

The token is base64url JSON `{"exp", "nonce"}` without padding, a dot, then the hex HMAC-SHA256 of that base64url
text, keyed with `EMBED_SECRET`. `exp` is a Unix time at most five minutes ahead, and `nonce` is random. Each link
works once: the server sets the sign-in cookie and redirects to `/`. A used, expired or wrongly signed link gets `401`.

Make the link on your server, never in the browser, so the secret stays there.

Python:

```python
import base64, hashlib, hmac, json, secrets, time

def embed_link(base_url: str, secret: str) -> str:
    claims = json.dumps({"exp": int(time.time()) + 60, "nonce": secrets.token_hex(16)})
    text = base64.urlsafe_b64encode(claims.encode()).decode().rstrip("=")
    signature = hmac.new(secret.encode(), text.encode(), hashlib.sha256).hexdigest()
    return f"{base_url}/embed?token={text}.{signature}"
```

Node.js:

```js
import { createHmac, randomBytes } from 'node:crypto';

function embedLink(baseUrl, secret) {
  const claims = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60, nonce: randomBytes(16).toString('hex') });
  const text = Buffer.from(claims).toString('base64url');
  const signature = createHmac('sha256', secret).update(text).digest('hex');
  return `${baseUrl}/embed?token=${text}.${signature}`;
}
```

Then put `<iframe src="…the link…">` in your page. `LOCK_MODEL` and `LOCK_FOLDER` hide the model and folder choices
when your site decides them.
