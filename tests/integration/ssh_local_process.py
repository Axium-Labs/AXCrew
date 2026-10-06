"""Real local AX + Crew + mock OpenSSH; remote POSIX shell has no AX installed."""
import json,os,sys,subprocess,tempfile,time,socket,threading,urllib.request,urllib.error,urllib.parse
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from connections_process import wait,free_port

def main(ax,crew):
    with tempfile.TemporaryDirectory(prefix="ax-local-ssh-") as tmp:
        root=Path(tmp);remote=root/'remote';remote.mkdir()
        shell=Path('C:/Program Files/Git/bin/bash.exe') if os.name=='nt' else Path('/bin/bash')
        shell_path='C:/Program Files/Git/usr/bin' if os.name=='nt' else '/usr/bin:/bin'
        assert shell.exists()
        fixture=root/('ssh.exe' if os.name=='nt' else 'ssh')
        subprocess.run(['rustc',str(Path(__file__).with_name('ssh_fixture.rs')),'-o',str(fixture)],check=True,capture_output=True)
        for i in range(8):
            d=remote/f'host{i}';d.mkdir();(d/'src').mkdir()
        state={'ids':[],'active':0,'max':0,'calls':0};lock=threading.Lock()
        class Model(BaseHTTPRequestHandler):
            def do_POST(self):
                body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                user=next(m['content'] for m in reversed(body['messages']) if m['role']=='user')
                tools=body.get('tools',[])
                names=[t['function']['name'] for t in tools]
                assert 'ssh' in names and 'shell' not in names and 'filesystem' not in names,names
                current= max(i for i,m in enumerate(body['messages']) if m['role']=='user')
                done=any(m['role']=='tool' for m in body['messages'][current+1:])
                if 'SLOW SSH' in user:
                    with lock:state['active']+=1;state['max']=max(state['max'],state['active'])
                    time.sleep(3)
                    with lock:state['active']-=1
                    delta={'content':'LOCAL MODEL DONE'};reason='stop'
                elif not done:
                    chosen=state['ids'][:6] if 'MULTI SSH' in user else [None]
                    calls=[{'index':i,'id':f'ssh-call-{i}','function':{'name':'ssh','arguments':json.dumps({'action':'exec','command':"if command -v ax >/dev/null 2>&1; then exit 9; fi; sleep 1; printf 'LOCAL_AX_REMOTE_SHELL' > controlled.txt; cat controlled.txt",**({'host_id':host} if host else {})})}} for i,host in enumerate(chosen)]
                    delta={'tool_calls':calls};reason='tool_calls'
                else:
                    outputs=[m['content'] for m in body['messages'][current+1:] if m['role']=='tool']
                    assert all('LOCAL_AX_REMOTE_SHELL' in str(v) for v in outputs),outputs
                    delta={'content':'LOCAL AX SSH SUCCESS'};reason='stop'
                chunk=json.dumps({'choices':[{'delta':delta,'finish_reason':reason}]})
                payload=f'data: {chunk}\n\ndata: [DONE]\n\n'.encode()
                self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(payload)));self.end_headers();
                try:self.wfile.write(payload)
                except (BrokenPipeError,ConnectionAbortedError,ConnectionResetError):pass
            def log_message(self,*args):pass
        model=ThreadingHTTPServer(('127.0.0.1',0),Model);threading.Thread(target=model.serve_forever,daemon=True).start()
        env=dict(os.environ,AX_HOME=str(root/'local-ax-home'),PATH=str(root)+os.pathsep+os.environ['PATH'],
                 MOCK_SSH_ROOT=str(remote),MOCK_REMOTE_SHELL=str(shell),MOCK_REMOTE_PATH=shell_path,
                 DEEPSEEK_API_KEY='local-test-key',DEEPSEEK_API_URL=f'http://127.0.0.1:{model.server_port}/chat/completions',
                 NO_PROXY='127.0.0.1,localhost',AX_CREW_ADMIN_TOKEN='ssh-test-token')
        port=free_port();base=f'http://127.0.0.1:{port}'
        def request(path,data=None,method=None):
            r=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),method=method,headers={'Content-Type':'application/json','Authorization':'Bearer ssh-test-token'})
            with urllib.request.urlopen(r,timeout=40) as response:return json.load(response)
        log=open(root/'crew.log','w',encoding='utf-8')
        server=subprocess.Popen([crew,'--ax',ax,'--database',str(root/'crew.db'),'--listen',f'127.0.0.1:{port}','--concurrency','1'],env=env,cwd=root,stdout=log,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        try:
            wait(lambda:request('/api/health'))
            members=[]
            for i in range(8):
                host=request('/api/connections/ssh',{'name':f'Host {i}','host':f'user@host{i}','port':None,'identity_file':None});state['ids'].append(host['id'])
                workspace=request('/api/connections/ssh/'+host['id']+'/connect',{})
                assert [d['name'] for d in workspace['directories']]==['src']
                project=request('/api/projects',{'name':f'Project {i}','device_id':host['id'],'cwd':workspace['cwd']})
                catalog=request('/api/devices/'+host['id']+'/capabilities?cwd='+urllib.parse.quote(workspace['cwd']))
                assert any(p['id']=='deepseek' for p in catalog['models']['providers'])
                member=request('/api/environments/'+project['member_id']+'/model',{'provider':'deepseek','model':'deepseek-chat'})
                members.append(member)
            # A catalogue larger than Windows' environment block still launches AX.
            for i in range(256):
                request('/api/connections/ssh',{'name':f'Extra host {i}', 'host':f'extra{i}.example.test','port':None,'identity_file':None})
            assert len(request('/api/connections/ssh'))==264
            assert len(json.dumps(request('/api/connections/ssh')))>32767
            def settled(id):
                t=request('/api/tasks/'+id);return t if t['status'] in ['completed','failed'] else None
            first=request('/api/sessions',{'member_id':members[0]['id'],'text':'ONE SSH','permission_profile':'trust'})
            task=wait(lambda:settled(first['id']));assert task['status']=='completed',task
            assert (remote/'host0'/'controlled.txt').read_text()=='LOCAL_AX_REMOTE_SHELL'
            follow=request('/api/sessions/'+first['id']+'/message',{'text':'MULTI SSH','permission_profile':'trust'})
            task=wait(lambda:settled(follow['id']));assert task['status']=='completed',task
            for i in range(6):assert (remote/f'host{i}'/'controlled.txt').exists()
            events=[]
            for i in range(6):
                # Last interval on host0 belongs to this multi-host round.
                a,b=map(int,(remote/f'host{i}'/'execution-times.txt').read_text().splitlines()[-1].split())
                events.extend([(a,1),(b,-1)])
            concurrent=peak=0
            for at,change in sorted(events):
                concurrent+=change;peak=max(peak,concurrent)
            assert peak>=5,('SSH tool calls still capped at four',events)
            assert request('/api/sessions/'+first['id'])['ax_session_id']==request('/api/sessions/'+follow['id'])['ax_session_id']
            assert request('/api/sessions/'+follow['id']+'/history')['updates']
            # Prove SSH bypasses --concurrency 1 and per-member max_concurrency 1.
            tasks=[request('/api/sessions',{'member_id':members[0]['id'],'text':f'SLOW SSH {i}','permission_profile':'trust'}) for i in range(8)]
            for t in tasks:
                result=wait(lambda:settled(t['id']));assert result['status']=='completed',result
            assert state['max']>=5,state
            (remote/'host0'/'disabled').write_text('offline')
            before=(remote/'host0'/'ssh.log').read_text()
            assert request('/api/sessions/'+follow['id']+'/history')['updates']
            assert before==(remote/'host0'/'ssh.log').read_text(),'History must not contact remote SSH'
            request('/api/devices/'+state['ids'][0]+'/revoke',{})
            assert request('/api/sessions/'+follow['id']+'/history')['updates'],'Local history survives host removal'
            for p in remote.rglob('ssh.log'):assert 'ax acp' not in p.read_text()
            print('PASS: local model/AX, 264 saved hosts, remote shell without AX, one-session six-host SSH, local follow-up/history, eight concurrent same-member SSH tasks; peak=',state['max'])
        except Exception:
            log.flush();print((root/'crew.log').read_text(errors='replace')[-6000:]);raise
        finally:
            try:
                for task in request('/api/tasks'):
                    if task['status'] in ['running','ready','waiting_permission']:
                        request('/api/tasks/'+task['id']+'/cancel',{})
            except (OSError,urllib.error.URLError):pass
            server.terminate();server.wait(timeout=15);log.close();model.shutdown();model.server_close()
if __name__=='__main__':main(*[str(Path(arg).resolve()) for arg in sys.argv[1:3]])
