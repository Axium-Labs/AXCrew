"""Process-level ACP, Crew API, pairing, and remote connection smoke test.

Run after building both binaries:
  python tests/smoke.py C:/path/to/ax.exe C:/path/to/ax-crew.exe
No provider credential or model call is needed.
"""
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def hidden():
    return subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def request(base, path, data=None, method=None):
    payload = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(base + path, data=payload, headers={"Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise AssertionError(f"{path}: HTTP {error.code}: {error.read().decode()}") from error


def wait_until(predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.2)
    raise AssertionError("timed out")


def acp_call(process, id, method, params):
    process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": id, "method": method, "params": params}) + "\n")
    process.stdin.flush()
    result = json.loads(process.stdout.readline())
    assert result.get("id") == id and "error" not in result, result
    return result["result"]


def main(ax, crew):
    with tempfile.TemporaryDirectory(prefix="ax-crew-smoke-") as temp:
        root = Path(temp)
        model_prompts = []
        class MockModel(BaseHTTPRequestHandler):
            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                prompt = next(item["content"] for item in reversed(request["messages"]) if item["role"] == "user")
                model_prompts.append(prompt)
                if "slow" in prompt:
                    time.sleep(3)
                if prompt == "permission" and request["messages"][-1]["role"] != "tool":
                    chunk = json.dumps({"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call-1", "function": {"name": "shell", "arguments": json.dumps({"command": "echo approved"})}}]}, "finish_reason": "tool_calls"}]})
                else:
                    output = "done:" + prompt.rsplit("Task:\n", 1)[-1]
                    chunk = json.dumps({"choices": [{"delta": {"content": output}, "finish_reason": "stop"}]})
                body = f"data: {chunk}\n\ndata: [DONE]\n\n".encode()
                try:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

            def log_message(self, *_):
                pass

        mock = ThreadingHTTPServer(("127.0.0.1", 0), MockModel)
        threading.Thread(target=mock.serve_forever, daemon=True).start()
        env = dict(os.environ, AX_HOME=str(root / "ax-home"), DEEPSEEK_API_KEY="test",
                   DEEPSEEK_API_URL=f"http://127.0.0.1:{mock.server_port}/chat/completions",
                   NO_PROXY="127.0.0.1,localhost")
        acp = subprocess.Popen([ax, "acp", "--data-dir", str(root / "ax-data")], cwd=root,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, env=env, creationflags=hidden())
        try:
            assert acp_call(acp, 1, "initialize", {"protocolVersion": 1})["protocolVersion"] == 1
            session = acp_call(acp, 2, "session/new", {"cwd": str(root), "mcpServers": []})["sessionId"]
            assert acp_call(acp, 3, "session/load", {"sessionId": session, "cwd": str(root), "mcpServers": []}) == {}
        finally:
            acp.stdin.close()
            acp.wait(timeout=10)
            assert acp.returncode == 0, acp.stderr.read()

        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        server = subprocess.Popen([crew, "--listen", f"127.0.0.1:{port}", "--database", str(root / "crew.sqlite3"), "--ax", ax],
                                  cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  env=env, creationflags=hidden())
        remote = None
        try:
            wait_until(lambda: request(base, "/api/health")["status"] == "ok")
            code = request(base, "/api/pairing", {})["code"]
            # URL-safe pairing codes may start with '-'; terminate option parsing.
            pair = subprocess.run([ax, "crew", "pair", "--gateway", base, "--", code], cwd=root, env=env,
                                  capture_output=True, text=True, timeout=15, creationflags=hidden())
            assert pair.returncode == 0, pair.stderr
            remote = subprocess.Popen([ax, "crew", "connect", base], cwd=root, env=env,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=hidden())
            device = wait_until(lambda: next((item for item in request(base, "/api/devices") if item["id"] != "local" and item["status"] == "online"), None))
            settings = request(base, "/api/settings")
            assert settings["protocol_version"] == 1
            assert settings["default_cwd"] == str(root)
            local_catalog = request(base, "/api/devices/local/capabilities?cwd=" + urllib.parse.quote(str(root)))
            assert any(item["id"] == "deepseek" for item in local_catalog["models"]["providers"])
            assert "skills" in local_catalog["skills"] and "servers" in local_catalog["mcp"]
            remote_catalog = request(base, f"/api/devices/{device['id']}/capabilities?cwd=" + urllib.parse.quote(str(root)))
            assert "providers" in remote_catalog["models"]
            crew_obj = request(base, "/api/crews", {"name": "smoke"})
            local = request(base, f"/api/crews/{crew_obj['id']}/members", {"name": "local", "role": "research", "device_id": "local", "cwd": str(root), "provider": "deepseek", "model": "deepseek-chat"})
            edited_local = request(base, f"/api/crews/{crew_obj['id']}/members/{local['id']}", {"name": "local edited", "role": "research", "device_id": "local", "cwd": str(root), "provider": "deepseek", "model": "deepseek-chat"}, method="PUT")
            assert edited_local["name"] == "local edited"
            remote_member = request(base, f"/api/crews/{crew_obj['id']}/members", {"name": "remote", "role": "test", "device_id": device["id"], "cwd": str(root), "provider": "deepseek", "model": "deepseek-chat"})
            disposable = request(base, "/api/tasks", {"crew_id": crew_obj["id"], "title": "disposable", "assigned_member": local["id"], "input": "remove"})
            edited = request(base, f"/api/tasks/{disposable['id']}", {"title": "renamed", "description": "edit", "assigned_member": remote_member["id"], "parent_id": None, "dependencies": [], "priority": 2, "input": "remove"}, method="PUT")
            assert edited["title"] == "renamed" and edited["assigned_device"] == device["id"]
            assert request(base, f"/api/tasks/{disposable['id']}", method="DELETE")["deleted"]
            first = request(base, "/api/tasks", {"crew_id": crew_obj["id"], "title": "A", "assigned_member": local["id"], "input": "first"})
            second = request(base, "/api/tasks", {"crew_id": crew_obj["id"], "title": "B", "assigned_member": remote_member["id"], "dependencies": [first["id"]], "input": {"prompt": "second", "include_dependencies": True}})
            assert second["dependencies"] == [first["id"]]
            request(base, f"/api/tasks/{first['id']}/start", {})
            completed = wait_until(lambda: (value if (value := request(base, f"/api/tasks/{second['id']}"))["status"] in ("completed", "failed") else None), 25)
            assert completed["status"] == "completed", completed
            assert completed["output"]["text"] == "done:second", completed
            assert request(base, f"/api/tasks/{first['id']}")["output"]["text"] == "done:first"
            assert any("done:first" in prompt and "Task:\nsecond" in prompt for prompt in model_prompts)
            first_session = request(base, f"/api/sessions/{first['id']}")["ax_session_id"]
            history = request(base, f"/api/sessions/{first['id']}/history")
            assert any(u["update"].get("sessionUpdate") == "agent_message_chunk" for u in history["updates"])
            assert request(base, f"/api/sessions/{first['id']}/resume", {})["ax_session_id"] == first_session
            followup = request(base, f"/api/sessions/{first['id']}/message", {"text": "follow up"})
            assert followup["parent_id"] == first["id"]
            assert wait_until(lambda: request(base, f"/api/tasks/{followup['id']}")["status"] == "completed", 15)
            assert request(base, f"/api/sessions/{followup['id']}")["ax_session_id"] == first_session
            fresh_session = request(base, "/api/sessions", {"title": "Fresh session", "text": "from new session", "cwd": str(root), "provider": "deepseek", "model": "deepseek-chat"})
            assert fresh_session["title"] == "Fresh session"
            assert fresh_session["assigned_device"] == "local"
            connection = sqlite3.connect(root / "crew.sqlite3")
            try:
                selected = connection.execute("SELECT cwd,provider,model FROM crew_members WHERE id=?", (fresh_session["assigned_member"],)).fetchone()
            finally:
                connection.close()
            assert selected == (str(root), "deepseek", "deepseek-chat")
            fresh_result = wait_until(lambda: (value if (value := request(base, f"/api/tasks/{fresh_session['id']}"))["status"] in ("completed", "failed") else None), 15)
            assert fresh_result["status"] == "completed", fresh_result
            assert request(base, f"/api/sessions/{fresh_session['id']}")["ax_session_id"]
            assert request(base, "/api/events?limit=10&offset=0")
            replay = subprocess.Popen([ax, "acp"], cwd=root, stdin=subprocess.PIPE,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                      env=env, creationflags=hidden())
            try:
                acp_call(replay, 1, "initialize", {"protocolVersion": 1})
                replay.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "session/load", "params": {"sessionId": first_session, "cwd": str(root), "mcpServers": []}}) + "\n")
                replay.stdin.flush()
                updates = []
                while True:
                    message = json.loads(replay.stdout.readline())
                    if message.get("id") == 2:
                        assert message.get("result") == {}, message
                        break
                    updates.append(message["params"]["update"])
                assert any(item["sessionUpdate"] == "user_message_chunk" and item["content"]["text"] == "first" for item in updates)
                assert any(item["sessionUpdate"] == "agent_message_chunk" and item["content"]["text"] == "done:first" for item in updates)
            finally:
                replay.stdin.close()
                replay.wait(timeout=10)

            approval_task = request(base, "/api/tasks", {"crew_id": crew_obj["id"], "title": "approval", "assigned_member": local["id"], "input": "permission"})
            request(base, f"/api/tasks/{approval_task['id']}/start", {})
            def pending_approval():
                conn = sqlite3.connect(root / "crew.sqlite3")
                row = conn.execute("SELECT payload_json FROM events WHERE kind='permission.requested' AND task_id=? ORDER BY timestamp DESC LIMIT 1", (approval_task["id"],)).fetchone()
                conn.close()
                return json.loads(row[0])["request_id"] if row else None
            approval_id = wait_until(pending_approval, 10)
            assert any(item["request_id"] == approval_id for item in request(base, "/api/permissions"))
            request(base, f"/api/permissions/{approval_id}/resolve", {"option_id": "allow_once"})
            approved = wait_until(lambda: (value if (value := request(base, f"/api/tasks/{approval_task['id']}"))["status"] in ("completed", "failed") else None), 10)
            assert approved["status"] == "completed", approved
            assert approved["output"]["text"] == "done:permission"

            slow = request(base, "/api/tasks", {"crew_id": crew_obj["id"], "title": "cancel", "assigned_member": local["id"], "input": "slow"})
            request(base, f"/api/tasks/{slow['id']}/start", {})
            wait_until(lambda: request(base, f"/api/tasks/{slow['id']}")["status"] == "running")
            request(base, f"/api/tasks/{slow['id']}/cancel", {})
            request(base, f"/api/tasks/{slow['id']}/retry", {})
            request(base, f"/api/tasks/{slow['id']}/start", {})
            retried = wait_until(lambda: (value if (value := request(base, f"/api/tasks/{slow['id']}"))["status"] in ("completed", "failed") else None), 20)
            assert retried["status"] == "completed", retried

            interrupted = request(base, "/api/tasks", {"crew_id": crew_obj["id"], "title": "disconnect", "assigned_member": remote_member["id"], "input": "slow remote"})
            request(base, f"/api/tasks/{interrupted['id']}/start", {})
            original_session = wait_until(lambda: request(base, f"/api/sessions/{interrupted['id']}"), 10)["ax_session_id"]
            remote.terminate()
            remote.wait(timeout=10)
            remote = None
            wait_until(lambda: request(base, f"/api/tasks/{interrupted['id']}")["status"] == "ready", 10)
            remote = subprocess.Popen([ax, "crew", "connect", base], cwd=root, env=env,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=hidden())
            wait_until(lambda: next((item for item in request(base, "/api/devices") if item["id"] == device["id"] and item["status"] == "online"), None))
            resumed = wait_until(lambda: (value if (value := request(base, f"/api/tasks/{interrupted['id']}"))["status"] in ("completed", "failed") else None), 20)
            assert resumed["status"] == "completed", resumed
            assert request(base, f"/api/sessions/{interrupted['id']}")["ax_session_id"] == original_session

            conn = sqlite3.connect(root / "crew.sqlite3")
            try:
                kinds = {row[0] for row in conn.execute("SELECT kind FROM events")}
                assert {"task.started", "task.completed", "agent.message.delta", "tool.started", "permission.requested"} <= kinds, kinds
                stored_events = " ".join(row[0] for row in conn.execute("SELECT payload_json FROM events"))
                assert "done:first" not in stored_events and "echo approved" not in stored_events
                assert conn.execute("SELECT COUNT(*) FROM task_runs WHERE status='completed'").fetchone()[0] >= 4
            finally:
                conn.close()
            request(base, f"/api/devices/{device['id']}/revoke", {})
            assert not any(item["id"] == device["id"] for item in request(base, "/api/devices"))
            print("ACP session, local-to-remote DAG, streamed events, cancel/retry, disconnect/reconnect/resume, pairing, revoke: OK")
        finally:
            if remote:
                remote.terminate()
                remote.wait(timeout=10)
            server.terminate()
            server.wait(timeout=10)
            mock.shutdown()


if __name__ == "__main__":
    main(*sys.argv[1:3])
