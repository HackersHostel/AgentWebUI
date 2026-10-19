"""A scripted ACP agent. FAKE_MODE: "full" (think, plan, ask, write a file, answer), "slow" (wait to be cancelled),
"echo" (repeat the prompt). Every method it receives is appended to $FAKE_LOG when set."""
from __future__ import annotations

import json
import os
import sys

MODE = os.environ.get("FAKE_MODE", "full")
LOG = os.environ.get("FAKE_LOG")
sessions: dict[str, str] = {}


def send(message: dict) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def note(session: str, update: dict) -> None:
    send({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": session, "update": update}})


def read() -> dict | None:
    line = sys.stdin.readline()
    if not line:
        return None
    message = json.loads(line)
    if LOG and "method" in message:
        with open(LOG, "a") as log:
            log.write(message["method"] + "\n")
    return message


def ask(method: str, params: dict, number: str) -> dict:
    send({"jsonrpc": "2.0", "id": number, "method": method, "params": params})
    while True:
        message = read()
        if message is None:
            sys.exit(0)
        if message.get("id") == number and "method" not in message:
            return message


def text_of(prompt: list) -> str:
    return "".join(block.get("text", "") for block in prompt if block.get("type") == "text")


def main() -> None:
    while (message := read()) is not None:
        method, number, params = message.get("method"), message.get("id"), message.get("params") or {}
        if method == "initialize":
            send({"jsonrpc": "2.0", "id": number, "result": {
                "protocolVersion": 1, "agentCapabilities": {"loadSession": True}, "authMethods": []}})
        elif method == "session/new":
            session = f"sess-{len(sessions) + 1}"
            sessions[session] = params["cwd"]
            send({"jsonrpc": "2.0", "id": number, "result": {"sessionId": session}})
        elif method == "session/load":
            sessions[params["sessionId"]] = params["cwd"]
            note(params["sessionId"], {"sessionUpdate": "agent_message_chunk",
                                       "content": {"type": "text", "text": "replayed history"}})
            send({"jsonrpc": "2.0", "id": number, "result": {}})
        elif method == "session/prompt":
            session = params["sessionId"]
            if MODE == "echo":
                note(session, {"sessionUpdate": "agent_message_chunk",
                               "content": {"type": "text", "text": f"You said: {text_of(params['prompt'])}"}})
                send({"jsonrpc": "2.0", "id": number, "result": {"stopReason": "end_turn"}})
            elif MODE == "slow":
                note(session, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "Working"}})
                while (other := read()) is not None and other.get("method") != "session/cancel":
                    pass
                send({"jsonrpc": "2.0", "id": number, "result": {"stopReason": "cancelled"}})
            else:
                full_turn(session, number)
        elif number is not None:
            send({"jsonrpc": "2.0", "id": number, "error": {"code": -32601, "message": "method not found"}})


def full_turn(session: str, number: object) -> None:
    path = os.path.join(sessions[session], "hello.txt")
    note(session, {"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "Planning."}})
    note(session, {"sessionUpdate": "plan", "entries": [{"content": "Write hello.txt", "status": "in_progress"}]})
    note(session, {"sessionUpdate": "tool_call", "toolCallId": "t1", "title": "Write hello.txt", "kind": "edit",
                   "status": "pending", "locations": [{"path": path}]})
    answer = ask("session/request_permission", {"sessionId": session, "toolCall": {
        "toolCallId": "t1", "title": "Write hello.txt", "kind": "edit"}, "options": [
            {"optionId": "allow", "name": "Allow once", "kind": "allow_once"},
            {"optionId": "reject", "name": "Reject", "kind": "reject_once"}]}, "perm-1")
    outcome = answer.get("result", {}).get("outcome", {})
    if outcome.get("optionId") == "allow":
        written = ask("fs/write_text_file", {"sessionId": session, "path": path, "content": "hello\n"}, "w-1")
        status = "failed" if "error" in written else "completed"
        note(session, {"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": status,
                       "content": [{"type": "diff", "path": path, "oldText": None, "newText": "hello\n"}]})
        reply = "Done."
    else:
        note(session, {"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "failed"})
        reply = "Rejected."
    note(session, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": reply}})
    send({"jsonrpc": "2.0", "id": number, "result": {"stopReason": "end_turn"}})


if __name__ == "__main__":
    main()
