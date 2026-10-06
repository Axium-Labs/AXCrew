"""Real AX workers + Crew + local fake model. No external model/service required.

Three independent AX processes on two logical Hosts verify async delegation,
patch transport, failed test observations, analysis, replanning, re-test,
coordinator-independent durable state, scoped auth and Crew restart.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request
import urllib.error


def wait(predicate, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(.3)
    raise AssertionError("condition timed out")


def main(ax, crew):
    ax, crew = str(Path(ax).resolve()), str(Path(crew).resolve())
    processes, files = [], []
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    with tempfile.TemporaryDirectory(prefix='ax-distributed-process-') as temp:
        root = Path(temp)
        copied_ax=root/Path(ax).name;copied_crew=root/Path(crew).name
        shutil.copy2(ax,copied_ax);shutil.copy2(crew,copied_crew)
        ax,crew=str(copied_ax),str(copied_crew)
        def launch(args, env, log):
            output = open(root / log, 'w', encoding='utf-8'); files.append(output)
            process = subprocess.Popen(args, env=env, cwd=root, stdout=output, stderr=output, creationflags=flags)
            processes.append(process)
            return process

        class Model(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                messages = body.get('messages', [])
                user = next((m['content'] for m in reversed(messages) if m['role'] == 'user'), '')
                results = [m['content'] for m in messages if m['role'] == 'tool']
                def text_result(n):
                    wrapped=json.loads(results[n])
                    return wrapped.get('output',results[n]).replace('\\n','\n').replace('\\r','\r').replace('\\"','"')
                def result(n):
                    return json.loads(text_result(n))
                def call(name, args):
                    return {'tool_calls': [{'index': 0, 'id': f'call-{len(results)}', 'function': {'name': name, 'arguments': json.dumps(args)}}]}
                def collaboration(action, **args):
                    return call('collaboration', dict(action=action, **args))
                try:
                    if user.startswith('COORDINATE'):
                        n = len(results)
                        if n == 0: delta = call('filesystem', {'operation':'write','path':'code.txt','content':'bad\n'})
                        elif n == 1: delta = call('shell', {'command':'git diff --binary HEAD --output=changes.patch'})
                        elif n == 2: delta = collaboration('publish_artifact', path='changes.patch',kind='patch')
                        elif n == 3: delta = collaboration('delegate', task={'request_id':'test-first','title':'first-test','input':'REMOTE_TEST','artifacts':[result(2)['id']], 'requirements':{'capabilities':{'roles':['test']}}})
                        elif n == 4: delta = collaboration('checkpoint_workflow', expected_revision=0, state={'stage':'awaiting_test','test':result(3)['id'],'patch':result(2)['id']})
                        elif n == 5: delta = collaboration('wait', task_id=result(3)['id'],timeout_secs=90)
                        elif n == 6:
                            assert 'TEST_FAILED' in result(5)['task']['result'], results
                            delta = collaboration('delegate',task={'request_id':'diagnose','title':'diagnose','input':'REMOTE_ANALYZE','context_summary':result(5)['task']['result'],'requirements':{'capabilities':{'roles':['ops']}}})
                        elif n == 7: delta = collaboration('wait',task_id=result(6)['id'],timeout_secs=90)
                        elif n == 8: delta = call('filesystem',{'operation':'write','path':'code.txt','content':'fixed\n'})
                        elif n == 9: delta = call('shell',{'command':'git diff --binary HEAD --output=fixed.patch'})
                        elif n == 10: delta = collaboration('publish_artifact',path='fixed.patch',kind='patch')
                        elif n == 11: delta = collaboration('delegate',task={'request_id':'test-again','title':'retest','input':'REMOTE_RETEST','artifacts':[result(10)['id']],'context_summary':result(7)['task']['result'],'requirements':{'capabilities':{'roles':['test']}}})
                        elif n == 12: delta = collaboration('wait',task_id=result(11)['id'],timeout_secs=90)
                        elif n == 13:
                            assert 'TEST_PASSED' in result(12)['task']['result'], results
                            delta = collaboration('checkpoint_workflow',expected_revision=1,state={'stage':'complete','final_test':result(11)['id']})
                        else: delta = {'content':'FIXED_AFTER_REMOTE_FAILURE'}
                    elif user.startswith('REMOTE_TEST') or user.startswith('REMOTE_RETEST'):
                        if not results: delta = call('filesystem',{'operation':'read','path':'code.txt'})
                        elif len(results) == 1: delta = collaboration('observe',text='TEST_PASSED' if text_result(0).strip() == 'fixed' else 'TEST_FAILED: expected fixed, found bad')
                        else: delta = {'content':'TEST_PASSED' if text_result(0).strip() == 'fixed' else 'TEST_FAILED: expected fixed, found bad'}
                    elif user.startswith('REMOTE_ANALYZE'):
                        delta = collaboration('observe',text='DIAGNOSIS: change code.txt from bad to fixed') if not results else {'content':'Set code.txt to fixed and re-test'}
                    elif user.startswith('SLOW_DURABLE'):
                        time.sleep(4)
                        delta = {'content':'DURABLE_CHILD_COMPLETED'}
                    else: delta = {'content':'local-model'}
                    chunk = json.dumps({'choices':[{'delta':delta,'finish_reason':'tool_calls' if 'tool_calls' in delta else 'stop'}]})
                    output = f'data: {chunk}\n\ndata: [DONE]\n\n'.encode()
                    self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.send_header('Content-Length',str(len(output))); self.end_headers();self.wfile.write(output)
                except Exception as error:
                    self.send_response(500);self.end_headers()
                    print('mock error:',error,'tool results:',results,file=sys.stderr)
            def log_message(self, *_): pass

        model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        admin = 'distributed-test-admin'
        env = dict(os.environ, AX_HOME=str(root/'ax-home'), AX_CREW_ADMIN_TOKEN=admin,
                   NO_PROXY='127.0.0.1,localhost',
                   DEEPSEEK_API_KEY='test', DEEPSEEK_API_URL=f'http://127.0.0.1:{model.server_port}/chat/completions',
                   AX_CREW_WORKSPACE=str(root/'legacy-workspace'))
        def request(path, data=None, token=admin, method=None):
            payload = None if data is None else json.dumps(data).encode()
            req = urllib.request.Request(base+path, data=payload, headers={'Authorization':f'Bearer {token}','Content-Type':'application/json'},method=method)
            with urllib.request.urlopen(req,timeout=15) as response: return json.load(response)
        def rejected(path,data=None,token='bad'):
            try: request(path,data,token);return False
            except urllib.error.HTTPError: return True
        server_args = [crew,'--ax',ax,'--database',str(root/'crew.db'),'--listen',f'127.0.0.1:{port}']
        try:
            server = launch(server_args,env,'crew.log')
            wait(lambda:request('/api/health'),20)
            source = root/'source';source.mkdir();(source/'code.txt').write_text('base\n')
            def git(args,cwd=source): return subprocess.check_output(['git',*args],cwd=cwd,stderr=subprocess.DEVNULL,creationflags=flags).decode().strip()
            git(['init']);git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','base'])
            revision = git(['rev-parse','HEAD'])
            instances = []
            for index,(host,role) in enumerate([('host-a','code'),('host-a','test'),('host-b','ops')]):
                mapping = root/f'project-path-{index}'
                git(['clone','--no-hardlinks',str(source),str(mapping)],cwd=root)
                instance = request('/api/distributed/enroll',{'host_id':host,'host_name':host,'name':f'AX-{role}',
                    'projects':['project-ax'],'max_executions':2,'can_delegate':True})
                config = {'gateway':base,'token':instance['token'],'instance_id':instance['instance']['id'],'projects':{'project-ax':str(mapping)},'execution_root':str(root/f'executions-{index}'),
                          'roles':[role],'max_executions':2,'provider':'deepseek','model':'deepseek-chat','permission_profile':'allow','sandbox':'off'}
                path = root/f'worker-{index}.json';path.write_text(json.dumps(config))
                worker = launch([ax,'crew','worker',str(path)],env,f'worker-{index}.log')
                instances.append((instance,worker,mapping))
            wait(lambda:all(i['last_seen']>0 for i in request('/api/distributed')['instances'].values()),30)
            wait(lambda:all(h.get('inventory') for h in request('/api/distributed')['hosts'].values()),30)
            detected=request('/api/distributed')
            assert detected['hosts']['host-a']['resources']['cpu'] == detected['hosts']['host-b']['resources']['cpu']
            assert detected['hosts']['host-a']['resources']['cpu'] > 0
            first=instances[0][0]['instance']['id']
            desired=dict(detected['instances'][first]['capabilities']);desired['environments'].append('configured')
            request('/api/distributed/instances/'+first+'/capabilities',desired)
            pending=request('/api/distributed')['instances'][first]
            assert pending['pending_capabilities'] == desired and 'configured' not in pending['capabilities']['environments']
            instances[0][1].terminate();instances[0][1].wait(timeout=10)
            updated_path=root/'worker-0.json';updated=json.loads(updated_path.read_text());updated['environments']=desired['environments'];updated_path.write_text(json.dumps(updated))
            new_worker=launch([ax,'crew','worker',str(updated_path)],env,'worker-0-configured.log')
            instances[0]=(instances[0][0],new_worker,instances[0][2])
            wait(lambda:request('/api/distributed')['instances'][first]['pending_capabilities'] is None,30)
            assert rejected('/api/distributed')
            assert rejected('/api/distributed/enroll',{},instances[0][0]['token'])
            assert rejected('/api/tasks',None,instances[0][0]['token'])
            task = request('/api/distributed/tasks',{'request_id':'root-plan','title':'coordinate','input':'COORDINATE','project_id':'project-ax','workspace_revision':revision,'requirements':{'capabilities':{'roles':['code']}}})
            task_id = task['id']
            def finished():
                current = request('/api/distributed/tasks/'+task_id)['task']
                if current['status'] == 'failed': raise AssertionError(current)
                return current if current['status'] == 'completed' else None
            done = wait(finished,180)
            assert done['result'] == 'FIXED_AFTER_REMOTE_FAILURE',done
            state = request('/api/distributed')
            assert len(state['hosts']) == 2 and len(state['instances']) == 3
            assert len(state['tasks']) == 4,state['tasks']
            assert state['workflows'][done['spec']['workflow_id']]['state']['stage'] == 'complete'
            assert state['workflows'][done['spec']['workflow_id']]['status'] == 'completed'
            assert any(e['kind']=='task.observation' and 'TEST_FAILED' in e['detail'] for e in state['events'])
            for _,_,mapping in instances: assert (mapping/'code.txt').read_text().strip() == 'base'
            for artifact in state['artifacts'].values():
                stored = request('/api/distributed/artifacts/'+artifact['id'])
                assert hashlib.sha256(base64.b64decode(stored['content_base64'])).hexdigest() == artifact['sha256']
            # No coordinator is alive: a previously submitted durable task continues on another AX.
            instances[0][1].terminate();instances[0][1].wait(timeout=10)
            durable = request('/api/distributed/tasks',{'request_id':'durable','title':'durable','input':'SLOW_DURABLE','project_id':'project-ax','requirements':{'capabilities':{'roles':['ops']}}})
            wait(lambda:request('/api/distributed/tasks/'+durable['id'])['task']['status']=='running',20)
            server.terminate();server.wait(timeout=10)
            server = launch(server_args,env,'crew-restart.log');wait(lambda:request('/api/health'),20)
            wait(lambda:request('/api/distributed/tasks/'+durable['id'])['task']['status']=='completed',45)
            assert request('/api/distributed/tasks/'+task_id)['task']['result'] == done['result']
            events = request('/api/distributed/events?after_sequence=0&limit=2');assert len(events['events'])==2
            later = request('/api/distributed/events?after_sequence='+str(events['cursor']));assert all(e['sequence']>events['cursor'] for e in later['events'])
            print('PASS: three AX / two Hosts, remote failure -> analysis -> artifact patch -> re-test; automatic hardware inventory, post-connect capability configuration, durable workflow, auth, Crew restart without coordinator')
        except Exception:
            for stream in files: stream.flush()
            for log in root.glob('*.log'):
                print(f'\n{log.name}:\n{log.read_text(errors="replace")[-14000:]}',file=sys.stderr)
            raise
        finally:
            for process in reversed(processes):
                if process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=10)
                    except subprocess.TimeoutExpired: process.kill();process.wait(timeout=10)
            for stream in files: stream.close()
            model.shutdown()
            # A terminated worker's ACP child may need a moment to release Windows file handles.
            time.sleep(1)


if __name__ == '__main__': main(*sys.argv[1:])
