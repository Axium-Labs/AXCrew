"""Native-client WebSocket regression: bearer header, idle ping, live task events.

python tests/gateway_socket.py target/android-validation/debug/ax-crew.exe
Uses an isolated database and no real AX/model/credentials.
"""
import base64
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid


def main(binary):
    with tempfile.TemporaryDirectory(prefix="crew-native-ws-") as directory:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        token = uuid.uuid4().hex
        process = subprocess.Popen([str(Path(binary).resolve()), "--listen", f"127.0.0.1:{port}", "--database", str(Path(directory) / "crew.db"), "--ax", str(Path(directory) / "not-installed-ax")], cwd=directory, env=dict(os.environ, AX_CREW_ADMIN_TOKEN=token), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        def api(path, body=None, method=None):
            req = urllib.request.Request(f"http://127.0.0.1:{port}/api/{path}", data=None if body is None else json.dumps(body).encode(), method=method, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=3) as response:
                return json.load(response)
        try:
            for _ in range(50):
                try:
                    api("health")
                    break
                except OSError:
                    time.sleep(.1)
            with socket.create_connection(("127.0.0.1", port), timeout=5) as ws:
                key = base64.b64encode(os.urandom(16)).decode()
                ws.sendall((f"GET /api/ws HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nAuthorization: Bearer {token}\r\n\r\n").encode())
                stream = ws.makefile("rb")
                assert b"101" in stream.readline()
                while stream.readline() != b"\r\n":
                    pass
                def frame():
                    header = stream.read(2)
                    assert len(header) == 2, "socket closed"
                    size = header[1] & 127
                    if size == 126:
                        size = struct.unpack("!H", stream.read(2))[0]
                    elif size == 127:
                        size = struct.unpack("!Q", stream.read(8))[0]
                    return header[0] & 15, stream.read(size)
                mask = os.urandom(4)
                ping = b"android-idle"
                ws.sendall(bytes([0x89, 0x80 | len(ping)]) + mask + bytes(value ^ mask[i % 4] for i, value in enumerate(ping)))
                assert frame() == (10, ping), "idle native ping must receive pong"
                crew = api("crews", {"name": "native socket test"})
                member = api(f"crews/{crew['id']}/members", {"name": "AX", "role": "test", "device_id": "local", "cwd": directory, "permission_profile": "ask"})
                task = api("tasks", {"crew_id": crew["id"], "title": "failure stream", "assigned_member": member["id"], "input": "test"})
                api(f"tasks/{task['id']}/start", {})
                kinds = set()
                while "task.failed" not in kinds:
                    opcode, payload = frame()
                    if opcode == 1:
                        event = json.loads(payload)
                        if event.get("task_id") == task["id"]:
                            kinds.add(event["kind"])
                assert "task.started" in kinds
                assert api(f"tasks/{task['id']}")["status"] == "failed"
                stream.close()
            assert api("settings")["session_files"] is True
            uploaded = api("sessions", {"member_id": member["id"], "text": "Read my file", "permission_profile": "ask", "files": [{"name": "../../report.txt", "data": base64.b64encode(b"mobile attachment").decode()}]})
            saved = api(f"tasks/{uploaded['id']}")["input"]
            assert saved["permission_profile"] == "ask"
            relative = saved["file_paths"][0]
            assert (Path(directory) / relative).read_bytes() == b"mobile attachment"
            assert (Path(directory) / relative).resolve().is_relative_to(Path(directory).resolve())
            plan_body = {"name": "Mobile schedule", "message": "Check project", "schedule_kind": "weekly", "daily_time": "09:00", "weekdays": "1,3,5", "member_id": member["id"], "approval": "ask", "enabled": False}
            plan = api("automations", plan_body)
            assert plan["approval"] == "ask"
            plan = api(f"automations/{plan['id']}", dict(plan_body, name="Edited mobile schedule"), "PUT")
            assert plan["name"] == "Edited mobile schedule"
            assert api(f"automations/{plan['id']}/toggle", {"enabled": True})["enabled"] is True
            scheduled = api(f"automations/{plan['id']}/run", {})
            assert scheduled["assigned_member"] == member["id"]
            api(f"automations/{plan['id']}", method="DELETE")
            assert all(p["id"] != plan["id"] for p in api("automations"))
            print("Native WebSocket, authenticated file upload, schedule CRUD/toggle/run: OK")
        finally:
            process.terminate()
            process.wait(timeout=10)


if __name__ == "__main__":
    main(sys.argv[1])
