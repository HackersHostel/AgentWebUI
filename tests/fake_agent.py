"""A scripted ACP agent. FAKE_MODE: "full" (think, plan, ask, write a file, answer), "slow" (wait to be cancelled),
"echo" (repeat the prompt), "media" (answer with an image and a link to a file it wrote).
FAKE_CONFIG: "options" (configOptions: a model, an effort that depends on the model, a toggle), "legacy" (the older
`models` shape), unset (neither). Every method it receives is appended to $FAKE_LOG when set, and the kinds of
blocks in each prompt as a `blocks:` line."""
from __future__ import annotations

import json
import os
import sys

MODE = os.environ.get("FAKE_MODE", "full")
CONFIG = os.environ.get("FAKE_CONFIG", "")
LOG = os.environ.get("FAKE_LOG")
sessions: dict[str, str] = {}
state: dict[str, dict] = {}  # per session: model, effort, fast
EFFORTS = {"opus": ["low", "high", "max"], "sonnet": ["low", "high"]}


def options(session: str) -> list:
    current = state[session]
    return [
        {"id": "mode", "name": "Mode", "category": "mode", "type": "select", "currentValue": "ask",
         "options": [{"value": "ask", "name": "Ask first"}, {"value": "code", "name": "Edit files"}]},
        {"id": "model", "name": "Model", "category": "model", "type": "select", "currentValue": current["model"],
         "options": [{"value": "opus", "name": "Opus", "description": "Most capable"},
                     {"value": "sonnet", "name": "Sonnet", "description": "Fast"}]},
        {"id": "effort", "name": "Effort", "category": "thought_level", "type": "select",
         "currentValue": current["effort"],
         "options": [{"value": e, "name": e.title()} for e in EFFORTS[current["model"]]]},
        {"id": "fast", "name": "Fast mode", "type": "boolean", "currentValue": current["fast"]},
    ]


def session_result(session: str) -> dict:
    state.setdefault(session, {"model": "opus", "effort": "high", "fast": False})
    if CONFIG == "options":
        return {"configOptions": options(session)}
    if CONFIG == "legacy":
        return {"models": {"currentModelId": state[session]["model"], "availableModels": [
            {"modelId": "opus", "name": "Opus"}, {"modelId": "sonnet", "name": "Sonnet"}]}}
    return {}


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
            if message["method"] == "session/prompt":
                log.write("blocks:" + ",".join(b.get("type", "") for b in message["params"]["prompt"]) + "\n")
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
                "protocolVersion": 1, "authMethods": [], "agentCapabilities": {
                    "loadSession": True, "promptCapabilities": {"image": True, "embeddedContext": True}}}})
        elif method == "session/new":
            session = f"sess-{len(sessions) + 1}"
            sessions[session] = params["cwd"]
            send({"jsonrpc": "2.0", "id": number, "result": {"sessionId": session, "modes": {
                "currentModeId": "ask", "availableModes": [
                    {"id": "ask", "name": "Ask first", "description": "Asks before every edit"},
                    {"id": "code", "name": "Edit files"}]}, **session_result(session)}})
            note(session, {"sessionUpdate": "available_commands_update", "availableCommands": [
                {"name": "review", "description": "Review the changes", "input": {"hint": "what to look at"}}]})
        elif method == "session/set_config_option":
            current = state[params["sessionId"]]
            if params["configId"] == "model":
                current["model"] = params["value"]
                if current["effort"] not in EFFORTS[current["model"]]:
                    current["effort"] = "high"
            elif params["configId"] == "effort":
                current["effort"] = params["value"]
            elif params["configId"] == "fast":
                current["fast"] = params["value"]
            send({"jsonrpc": "2.0", "id": number, "result": {"configOptions": options(params["sessionId"])}})
        elif method == "session/set_model":
            state[params["sessionId"]]["model"] = params["modelId"]
            send({"jsonrpc": "2.0", "id": number, "result": {}})
        elif method == "session/set_mode":
            send({"jsonrpc": "2.0", "id": number, "result": {}})
            note(params["sessionId"], {"sessionUpdate": "current_mode_update", "currentModeId": params["modeId"]})
        elif method == "session/load":
            sessions[params["sessionId"]] = params["cwd"]
            note(params["sessionId"], {"sessionUpdate": "agent_message_chunk",
                                       "content": {"type": "text", "text": "replayed history"}})
            send({"jsonrpc": "2.0", "id": number, "result": session_result(params["sessionId"])})
        elif method == "session/prompt":
            session = params["sessionId"]
            if MODE == "echo":
                said = text_of(params["prompt"][-1:])
                if said == "change model" and CONFIG == "options":
                    state[session]["model"] = "sonnet"
                    note(session, {"sessionUpdate": "config_option_update", "configOptions": options(session)})
                model = f" [{state[session]['model']}]" if CONFIG else ""
                note(session, {"sessionUpdate": "agent_message_chunk",
                               "content": {"type": "text", "text": f"You said: {said}{model}"}})
                send({"jsonrpc": "2.0", "id": number, "result": {"stopReason": "end_turn"}})
            elif MODE == "media":
                path = os.path.join(sessions[session], "chart.svg")
                written = ask("fs/write_text_file", {"sessionId": session, "path": path, "content": "<svg/>"}, "w-m")
                assert "error" not in written
                note(session, {"sessionUpdate": "agent_message_chunk", "content": {
                    "type": "image", "mimeType": "image/png", "data": "iVBORw0KGgo="}})
                note(session, {"sessionUpdate": "agent_message_chunk", "content": {
                    "type": "resource_link", "uri": "file://" + path, "name": "chart.svg"}})
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
                   "status": "pending", "locations": [{"path": path}], "rawInput": {"file_path": path}})
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
