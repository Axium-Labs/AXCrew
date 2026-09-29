"""Gateway workspace recovery regression; uses an isolated database and never calls a model."""
import tempfile, subprocess, os, socket, json, time, sqlite3, urllib.request, urllib.error, sys
from pathlib import Path
exe=Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix="crew-workspace-regression-") as tmp:
    root=Path(tmp); valid=root/"valid"; valid.mkdir(); db=root/"crew.sqlite3"
    with socket.socket() as sock:
        sock.bind(("127.0.0.1",0)); port=sock.getsockname()[1]
    env=dict(os.environ,AX_CREW_WORKSPACE=str(valid),AX_CREW_ADMIN_TOKEN="test-workspace-token")
    client=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def request(path,body=None):
        req=urllib.request.Request(f"http://127.0.0.1:{port}{path}",data=None if body is None else json.dumps(body).encode(),headers={"Authorization":"Bearer test-workspace-token","Content-Type":"application/json"})
        return json.loads(client.open(req,timeout=3).read())
    def start():
        p=subprocess.Popen([str(exe),"--listen",f"127.0.0.1:{port}","--database",str(db),"--ax",str(root/"no-model.exe")],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        for _ in range(100):
            try: request("/api/health"); return p
            except (OSError, urllib.error.URLError): time.sleep(.05)
        p.kill(); _, error=p.communicate(); raise RuntimeError(error.decode(errors="replace"))
    p=start(); p.terminate(); p.wait(); p.stderr.close()
    conn=sqlite3.connect(db); missing=str(root/"deleted")
    conn.execute("update crew_members set cwd=?",(missing,)); conn.commit(); conn.close()
    p=start()
    try:
        assert request("/api/settings")["default_cwd"]==str(valid)
        try:
            request("/api/sessions",{"text":"test","cwd":missing})
            raise AssertionError("invalid path accepted")
        except urllib.error.HTTPError as error:
            assert error.code==400
            assert missing in json.loads(error.read())["error"]
        conn=sqlite3.connect(db)
        assert conn.execute("select count(*) from crew_members where cwd=?",(missing,)).fetchone()[0]==1
        assert conn.execute("select count(*) from tasks").fetchone()[0]==0
        conn.close()
        print("PASS: stale database recovered, valid default returned, invalid submission rejected without task or history mutation")
    finally:
        p.terminate(); p.wait(); p.stderr.close()
