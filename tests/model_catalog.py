"""Process-level AX/Crew model contract regression; no real credentials or external API calls."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class Handler(BaseHTTPRequestHandler):
    reject = False
    def do_GET(self):
        body = json.dumps({"error":{"message":"invalid test key"}} if self.reject else
                          {"data":[{"id":"deepseek-chat"},{"id":"test-tts"}]}).encode()
        self.send_response(401 if self.reject else 200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_):
        pass

with tempfile.TemporaryDirectory(prefix="ax-model-contract-") as temp:
    root = Path(temp)
    home = root / "home"
    home.mkdir()
    (home / "auth.json").write_text(json.dumps({p:{"type":"api_key","key":"test-only"}
        for p in ["deepseek","minimax","fireworks","xiaomi-token-plan-cn","anthropic"]}))
    env = {k:v for k,v in os.environ.items() if not k.endswith(("_API_KEY", "_TOKEN"))}
    env["AX_HOME"] = str(home)
    env["NO_PROXY"] = "127.0.0.1,localhost"
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    env["DEEPSEEK_API_URL"] = f"http://127.0.0.1:{server.server_port}/chat/completions"
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    def rpc(method, params=None):
        requests=[{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}},
                  {"jsonrpc":"2.0","id":2,"method":method,"params":params or {}}]
        result=subprocess.run([str(Path(sys.argv[1]).resolve()),"acp"],cwd=root,env=env,
            input="".join(json.dumps(item)+"\n" for item in requests),text=True,
            encoding="utf-8",capture_output=True,timeout=25,check=True)
        reply=next(json.loads(line) for line in result.stdout.splitlines() if json.loads(line).get("id")==2)
        assert "error" not in reply, reply
        return reply["result"]
    try:
        catalog={p["id"]:p for p in rpc("_ax/models")["catalog"]}
        for provider in ["minimax","fireworks","xiaomi-token-plan-cn"]:
            assert catalog[provider]["configured"] and catalog[provider]["supported"]
            assert catalog[provider]["models"] and catalog[provider]["model_source"]=="fallback"
            assert all(m["supports_tools"] for m in catalog[provider]["models"])
        assert not catalog["anthropic"]["supported"] and not catalog["anthropic"]["models"]
        assert not catalog["openai-codex"]["configured"]
        live=rpc("_ax/refresh-models",{"provider":"deepseek"})
        assert live["source"]=="live" and live["warning"] is None, live
        Handler.reject=True
        cached=rpc("_ax/refresh-models",{"provider":"deepseek"})
        assert cached["source"]=="cache" and "401" in cached["warning"], cached
        catalog={p["id"]:p for p in rpc("_ax/models")["catalog"]}
        assert catalog["deepseek"]["model_source"]=="cache"
        assert [m["id"] for m in catalog["deepseek"]["models"]]==["deepseek-chat"]
        print("PASS: clean home fallback, provider support, live discovery, cached 401 warning, non-chat filtering")
    finally:
        server.shutdown()
        server.server_close()
