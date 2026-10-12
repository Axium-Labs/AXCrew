import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Network } from 'lucide-react'
import { useLang } from '../lib/i18n'
import { distributed, type Cluster } from '../lib/distributed'
import { PageHead, Empty } from '../components/shared'
import { Button } from '../components/ui/button'
import { Enroll, CreateTask, type Label } from './distributed-forms'
import { Workbench, TaskInspector } from './distributed-workbench'
import { Nodes } from './distributed-nodes'
import { Activity } from './distributed-activity'
import './distributed.css'

export type WorkbenchProps={state:Cluster;label:Label;busy:boolean;error:string;run:(action:()=>Promise<unknown>)=>Promise<void>;onTask:(id:string)=>void}
export function Distributed(){
  const zh=useLang(s=>s.lang)==='zh',label:Label=(cn,en)=>zh?cn:en
  const client=useQueryClient(),query=useQuery({queryKey:['distributed'],queryFn:distributed.state,refetchInterval:2000,retry:false})
  const [tab,setTab]=useState('workbench'),[enrolling,setEnrolling]=useState(false),[creating,setCreating]=useState(false)
  const [workflow,setWorkflow]=useState<string|null>(null),[task,setTask]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const run=async(action:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await action();await client.invalidateQueries({queryKey:['distributed']})}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  const state=query.data,props=state?{state,label,busy,error,run,onTask:setTask}:null
  return <div className="page distributed-page">
    <PageHead eyebrow={label('AXCrew · 多 Agent 协作','AXCrew · Multi-agent collaboration')} title={label('协作工作台','Collaboration workspace')} description={label('围绕目标组织 AX，在每一次执行中保持掌控。','Organize AX around objectives and stay in control of every execution.')} actions={<><Button variant="ghost" aria-label={label('刷新','Refresh')} onClick={()=>void query.refetch()}><RefreshCw size={14}/></Button><Button variant="secondary" onClick={()=>setEnrolling(true)}><Plus size={14}/>{label('连接 AX','Connect AX')}</Button><Button disabled={!state} onClick={()=>setCreating(true)}><Plus size={14}/>{label('创建协作','Create collaboration')}</Button></>}/>
    <div className="cluster-tabs" role="tablist" aria-label={label('协作视图','Collaboration views')}>{[['workbench','协作工作台','Workspace'],['nodes','节点管理','Nodes'],['activity','执行活动','Activity']].map(([id,cn,en])=><button type="button" role="tab" id={`cluster-tab-${id}`} aria-controls={`cluster-view-${id}`} aria-selected={tab===id} key={id} onClick={()=>setTab(id)}>{label(cn,en)}</button>)}<span className="cluster-summary">{Object.values(state?.tasks??{}).filter(t=>t.status==='running').length} {label('执行中','running')} · {Object.values(state?.instances??{}).filter(i=>i.enabled&&i.last_seen>(state?.server_time??0)-30&&i.last_seen>0).length} AX {label('在线','online')}</span></div>
    {(error||query.error)&&<p role="alert" className="ax-notice is-error is-flush">{error||String(query.error)}</p>}
    {query.isPending&&<Empty title={label('正在读取协作状态…','Loading collaboration state…')}/>}
    {state&&props&&<div role="tabpanel" id={`cluster-view-${tab}`} aria-labelledby={`cluster-tab-${tab}`}>
      {tab==='workbench'&&<Workbench {...props} selected={workflow} select={setWorkflow} create={()=>setCreating(true)}/>}
      {tab==='nodes'&&<Nodes {...props} enroll={()=>setEnrolling(true)}/>}
      {tab==='activity'&&<Activity {...props}/>}
    </div>}
    {state&&!Object.keys(state.hosts).length&&tab==='nodes'&&<div className="cluster-intro"><Network size={28}/><h2>{label('连接你的第一个 AX','Connect your first AX')}</h2><p>{label('一台机器可以连接多个 AX；每个 AX 的执行数量由实际能力和可用资源决定。','One machine can connect several AX instances; execution capacity depends on runtime support and available resources.')}</p><Button onClick={()=>setEnrolling(true)}>{label('连接 AX','Connect AX')}</Button></div>}
    {state&&task&&state.tasks[task]&&<TaskInspector {...props!} task={state.tasks[task]} close={()=>setTask(null)}/>}
    <Enroll open={enrolling} close={()=>setEnrolling(false)} state={state} run={run} busy={busy} label={label} error={error}/>
    <CreateTask key={creating?'creating':'closed'} open={creating} close={()=>setCreating(false)} state={state} run={run} busy={busy} label={label} error={error} onCreated={id=>{setWorkflow(id);setTab('workbench')}}/>
  </div>
}
