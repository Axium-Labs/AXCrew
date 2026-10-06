"""Real AX/Crew regression for directory discovery, named projects and remote sessions.

Runs against an isolated home/database and a local model fixture. SSH failure uses
an unused loopback port; no personal SSH config, key or remote server is required.
"""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request
import urllib.error
import urllib.parse


def wait(predicate, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(.15)
    raise AssertionError('condition timed out')


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main(ax, crew):
    processes, logs = [], []
    with tempfile.TemporaryDirectory(prefix='crew-connections-') as tmp:
        root = Path(tmp)
        binaries = []
        for source in [ax, crew]:
            target = root / Path(source).name
            shutil.copy2(source, target)
            binaries.append(str(target))
        ax, crew = binaries
        workspace = root / 'project with spaces'
        workspace.mkdir()
        (workspace / 'src').mkdir()
        (workspace / 'private.txt').write_text('file content is not in directory discovery')
        port, closed_port = free_port(), free_port()
        base = f'http://127.0.0.1:{port}'

        class Model(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                prompt = next(m['content'] for m in reversed(body['messages']) if m['role'] == 'user')
                delta = json.dumps({'choices': [{'delta': {'content': 'done:' + prompt}, 'finish_reason': 'stop'}]})
                output = f'data: {delta}\n\ndata: [DONE]\n\n'.encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Content-Length', str(len(output)))
                self.end_headers()
                self.wfile.write(output)
            def log_message(self, *_):
                pass

        model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        env = dict(os.environ, AX_HOME=str(root/'ax-home'), AX_CREW_ADMIN_TOKEN='test-admin',
                   AX_CREW_WORKSPACE=str(workspace), DEEPSEEK_API_KEY='test',
                   DEEPSEEK_API_URL=f'http://127.0.0.1:{model.server_port}/chat/completions', NO_PROXY='127.0.0.1,localhost')
        client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        def request(path, body=None, method=None, token='test-admin'):
            req = urllib.request.Request(base+path, data=None if body is None else json.dumps(body).encode(), method=method,
                                         headers={'Authorization': 'Bearer '+token, 'Content-Type': 'application/json'})
            with client.open(req, timeout=35) as response:
                return json.load(response)
        def rejected(path, body=None, **kwargs):
            try:
                request(path, body, **kwargs)
            except urllib.error.HTTPError:
                return True
            return False
        def launch(args, name):
            log = open(root/name, 'w', encoding='utf-8'); logs.append(log)
            process = subprocess.Popen(args, cwd=workspace, env=env, stdout=log, stderr=log,
                                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            processes.append(process)
            return process
        args = [crew, '--ax', ax, '--database', str(root/'crew.db'), '--listen', f'127.0.0.1:{port}']
        try:
            # Register a trusted AX project on the paired host without a model call.
            frames = [{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':1}},
                      {'jsonrpc':'2.0','id':2,'method':'session/new','params':{'cwd':str(workspace),'mcpServers':[]}}]
            seeded = subprocess.run([ax,'acp'], input=''.join(json.dumps(f)+'\n' for f in frames), text=True, cwd=workspace, env=env,
                                    capture_output=True, timeout=20, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            assert seeded.returncode == 0, seeded.stderr
            assert all('error' not in json.loads(line) for line in seeded.stdout.splitlines()), seeded.stdout
            server = launch(args,'crew.log'); wait(lambda:request('/api/health'))
            for path in ['/api/projects','/api/connections/ssh','/api/connections/ssh/discover','/api/devices/local/workspace']:
                assert rejected(path,token='invalid'), path
            listing = request('/api/devices/local/workspace?cwd='+urllib.parse.quote(str(workspace)))
            assert [d['name'] for d in listing['directories']] == ['src']
            assert rejected('/api/projects',{'name':'Missing','device_id':'local','cwd':str(root/'missing')})
            local = request('/api/projects',{'name':'Local demo','device_id':'local','cwd':str(workspace)})
            assert local['device_id'] == 'local'
            code = request('/api/pairing',{})['code']
            paired = subprocess.run([ax,'crew','pair','--gateway',base,'--',code],env=env,cwd=workspace,capture_output=True,text=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            assert paired.returncode == 0, paired.stderr
            remote = launch([ax,'crew','connect',base],'remote.log')
            device = wait(lambda:next((d for d in request('/api/devices') if d['id']!='local' and d['status']=='online' and d['capabilities'].get('workspaces')),None))
            roots = request('/api/devices/'+device['id']+'/workspace')
            assert roots['hint'] == 'registered_workspaces' and roots['directories']
            assert rejected('/api/projects',{'name':'Unregistered','device_id':device['id'],'cwd':str(root)})
            project = request('/api/projects',{'name':'Remote demo','device_id':device['id'],'cwd':roots['directories'][0]['path']})
            chosen = request('/api/environments/'+project['member_id']+'/model',{'provider':'deepseek','model':'deepseek-chat'})
            assert chosen['device_id']==device['id'] and chosen['cwd']==project['cwd']
            assert chosen['id'] != project['member_id']
            assert request('/api/environments/'+project['member_id']+'/model',{'provider':'deepseek','model':'deepseek-chat'})['id']==chosen['id']
            original = next(m for c in request('/api/crews') for m in request('/api/crews/'+c['id']+'/members') if m['id']==project['member_id'])
            assert original['provider'] is None and original['model'] is None
            turn = request('/api/sessions',{'member_id':chosen['id'],'text':'remote first'})
            def settled(id):
                value = request('/api/tasks/'+id)
                return value if value['status'] in ['completed','failed'] else None
            first = wait(lambda:settled(turn['id']))
            assert first['status']=='completed' and first['assigned_device']==device['id'],first
            follow = request('/api/sessions/'+turn['id']+'/message',{'text':'remote follow-up'})
            assert wait(lambda:settled(follow['id']))['status']=='completed'
            assert request('/api/sessions/'+turn['id'])['ax_session_id']==request('/api/sessions/'+follow['id'])['ax_session_id']
            assert request('/api/sessions/'+follow['id']+'/history')['updates']
            host = request('/api/connections/ssh',{'name':'Unavailable test','host':'127.0.0.1','port':closed_port,'identity_file':None})
            assert rejected('/api/connections/ssh/'+urllib.parse.quote(host['id'],safe='')+'/connect',{})
            assert next(d for d in request('/api/devices') if d['id']==host['id'])['status']=='offline'
            remote.terminate();remote.wait(timeout=10)
            server.terminate();server.wait(timeout=10)
            server = launch(args,'crew-restarted.log');wait(lambda:request('/api/health'))
            assert {p['name'] for p in request('/api/projects')}=={'Local demo','Remote demo'}
            assert request('/api/connections/ssh')[0]['id']==host['id']
            request('/api/projects/'+project['id'],method='DELETE')
            assert request('/api/sessions/'+follow['id'])['device_id']==device['id']
            print('PASS: authenticated discovery, local/paired projects, remote multi-turn/history, rejected paths, SSH failure and restart persistence')
        except Exception:
            for log in logs: log.flush()
            for path in root.glob('*.log'): print(path.name, path.read_text(errors='replace')[-4000:])
            raise
        finally:
            for process in reversed(processes):
                if process.poll() is None: process.terminate()
                process.wait(timeout=10)
            for log in logs: log.close()
            model.shutdown();model.server_close()


if __name__ == '__main__':
    main(*[str(Path(arg).resolve()) for arg in sys.argv[1:3]])
