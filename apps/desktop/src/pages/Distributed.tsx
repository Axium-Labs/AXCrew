import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, LayoutDashboard, Server, Activity as ActivityIcon } from 'lucide-react'
import { useLang } from '../lib/i18n'
import { distributed, type Cluster } from '../lib/distributed'
import { ClusterOverview, QuietEmpty } from './distributed-ui'
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
    <ClusterOverview state={state} label={label} loading={query.isPending}/>
    <div className="cluster-navigation"><div className="cluster-tabs" role="tablist" aria-label={label('协作视图','Collaboration views')}>{[['workbench','协作工作台','Workspace'],['nodes','节点管理','Nodes'],['activity','执行活动','Activity']].map(([id,cn,en])=>{const Icon=id==='workbench'?LayoutDashboard:id==='nodes'?Server:ActivityIcon;return <button type="button" role="tab" id={`cluster-tab-${id}`} aria-controls={`cluster-view-${id}`} aria-selected={tab===id} key={id} onClick={()=>setTab(id)}><Icon size={14}/>{label(cn,en)}</button>})}</div><span className={`cluster-sync ${query.error?'is-error':''}`}><i/>{query.error?label('同步中断','Sync interrupted'):query.isPending?label('连接中','Connecting'):label('自动同步 · 每 2 秒','Auto sync · every 2s')}</span><Button variant="ghost" size="icon" aria-label={label('刷新','Refresh')} onClick={()=>void query.refetch()}><RefreshCw size={14}/></Button></div>
    {(error||query.error)&&<p role="alert" className="ax-notice is-error is-flush">{error||String(query.error)}</p>}
    {query.isPending&&<QuietEmpty title={label('正在读取协作状态…','Loading collaboration state…')}/>}
    {state&&props&&<div role="tabpanel" id={`cluster-view-${tab}`} aria-labelledby={`cluster-tab-${tab}`}>
      {tab==='workbench'&&<Workbench {...props} selected={workflow} select={setWorkflow} create={()=>setCreating(true)} nodes={()=>setTab('nodes')}/>}
      {tab==='nodes'&&<Nodes {...props} enroll={()=>setEnrolling(true)}/>}
      {tab==='activity'&&<Activity {...props}/>}
    </div>}
    {state&&task&&state.tasks[task]&&<TaskInspector key={task} {...props!} task={state.tasks[task]} close={()=>setTask(null)}/>}
    <Enroll open={enrolling} close={()=>setEnrolling(false)} state={state} run={run} busy={busy} label={label} error={error}/>
    <CreateTask key={creating?'creating':'closed'} open={creating} close={()=>setCreating(false)} state={state} run={run} busy={busy} label={label} error={error} onCreated={id=>{setWorkflow(id);setTab('workbench')}}/>
  </div>
}
