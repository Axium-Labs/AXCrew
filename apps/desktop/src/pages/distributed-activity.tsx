import { useState } from 'react'
import { distributed, type ClusterEvent, workflowTasks } from '../lib/distributed'
import { Empty, Status } from '../components/shared'
import { Button } from '../components/ui/button'
import { fileDownload } from './distributed-forms'
import type { WorkbenchProps } from './Distributed'

export const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
export const parse=(value:string):unknown=>{try{return JSON.parse(value)}catch{return value}}
export const eventTitle=(kind:string,label:WorkbenchProps['label'])=>{
  const names:Record<string,[string,string]>={'task.activity':['AX 工作','AX activity'],'task.observation':['协作消息','Collaboration message'],'task.completed':['任务完成','Task completed'],'task.failed':['执行失败','Execution failed'],'task.lease_lost':['执行连接中断','Execution disconnected'],'task.assigned':['任务已分配','Task assigned'],'task.reassigned':['任务重新分配','Task reassigned'],'workflow.checkpoint':['状态已保存','State saved'],'task.session':['Session 已连接','Session connected'],'session.command':['消息已提交','Command submitted'],'session.command_result':['Session 操作结果','Session command result'],'instance.management':['实例配置操作','Instance configuration'],'instance.management_result':['实例配置结果','Instance configuration result']}
  const value=names[kind];return value?label(...value):kind
}
export function EventContent({event}:{event:ClusterEvent}){
  const value=parse(event.detail),items=Array.isArray(value)?value:[value]
  return <>{items.map((item,n)=>{
    const body=object(item),update=object(body.update),content=object(update.content),rotation=object(object(update._meta).axSessionRotation)
    if(update.sessionUpdate==='agent_message_chunk'||update.sessionUpdate==='user_message_chunk')return content.text?<p className={update.sessionUpdate==='user_message_chunk'?'cluster-user-message':''} key={n}>{String(content.text)}</p>:Object.keys(rotation).length?<p key={n}>Session Rotation · {String(rotation.previous_session)} → {String(rotation.session)}</p>:null
    if(update.sessionUpdate==='tool_call'||update.sessionUpdate==='tool_call_update')return <details key={n} className="cluster-tool-event"><summary>{String(update.title??update.toolCallId??'Tool')} · {String(update.status??'')} </summary><pre>{JSON.stringify(update,null,2)}</pre></details>
    if(update.sessionUpdate==='agent_question')return <p key={n}>{String(object(update.question).question??object(update.question).text??'AX is waiting for your answer')}</p>
    if(body.permission)return <p key={n}>Permission · {String(object(body.permission).toolCall?object(object(body.permission).toolCall).title:'AX')}</p>
    return <pre key={n}>{typeof item==='string'?item:JSON.stringify(item,null,2)}</pre>
  })}</>
}
export function Activity({state,label,onTask,busy,run}:WorkbenchProps){
  const [goal,setGoal]=useState(''),[ax,setAx]=useState(''),[host,setHost]=useState(''),[status,setStatus]=useState(''),[view,setView]=useState('executions')
  const goals=Object.values(state.workflows),instances=Object.values(state.instances)
  const tasks=Object.values(state.tasks).filter(t=>(!goal||workflowTasks(state,state.workflows[goal]).some(x=>x.id===t.id))&&(!status||t.status===status))
  const executions=tasks.flatMap(t=>t.attempts.map(a=>({t,a}))).filter(({a})=>(!ax||a.instance_id===ax)&&(!host||state.instances[a.instance_id]?.host_id===host))
  const ids=new Set(tasks.map(t=>t.id))
  const events=state.events.filter(e=>(!goal||(e.task_id&&ids.has(e.task_id)))&&(!status||(e.task_id&&ids.has(e.task_id)))&&(!ax||e.instance_id===ax||(!e.instance_id&&e.task_id&&state.tasks[e.task_id]?.attempts.some(a=>a.instance_id===ax)))&&(!host||(e.instance_id&&state.instances[e.instance_id]?.host_id===host)||(!e.instance_id&&e.task_id&&state.tasks[e.task_id]?.attempts.some(a=>state.instances[a.instance_id]?.host_id===host)))).slice(-200).reverse()
  const artifacts=Object.values(state.artifacts).filter(a=>ids.has(a.task_id)&&(!ax||executions.some(e=>e.t.id===a.task_id&&e.a.generation===a.generation))&&(!host||executions.some(e=>e.t.id===a.task_id&&e.a.generation===a.generation)))
  return <div className="cluster-activity">
    <div className="cluster-filters">
      <label>{label('协作','Collaboration')}<select value={goal} onChange={e=>setGoal(e.target.value)}><option value="">{label('所有 Goal / 任务','All Goals / tasks')}</option>{goals.map(w=><option key={w.id} value={w.id}>{w.title}</option>)}</select></label>
      <label>AX<select value={ax} onChange={e=>setAx(e.target.value)}><option value="">{label('所有 AX','All AX')}</option>{instances.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <label>Host<select value={host} onChange={e=>setHost(e.target.value)}><option value="">{label('所有机器','All hosts')}</option>{Object.values(state.hosts).map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
      <label>{label('任务状态','Task status')}<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">{label('所有状态','All states')}</option>{['pending','running','paused','completed','failed','cancelled'].map(s=><option key={s}>{s}</option>)}</select></label>
    </div>
    <div className="cluster-segments">{[['executions','执行记录','Executions'],['events','实时事件','Live events'],['artifacts','执行产物','Artifacts']].map(([id,cn,en])=><Button key={id} variant={view===id?'secondary':'ghost'} onClick={()=>setView(id)}>{label(cn,en)}</Button>)}</div>
    {view==='executions'&&<div className="cluster-table-wrap"><table className="cluster-table"><thead><tr><th>{label('任务 / 协作','Task / collaboration')}</th><th>Host → AX</th><th>Execution → Session</th><th>{label('状态 / 恢复记录','State / recovery')}</th></tr></thead><tbody>{executions.reverse().map(({t,a})=><tr key={`${t.id}:${a.generation}`}><td><button className="cluster-link" onClick={()=>onTask(t.id)}>{t.spec.title}</button><small>{goals.find(w=>w.id===t.spec.workflow_id||w.root_task_id===t.id)?.title}</small></td><td>{state.hosts[state.instances[a.instance_id]?.host_id]?.name??'—'}<small>{state.instances[a.instance_id]?.name??a.instance_id}</small></td><td>#{a.generation}<small>{a.sessions?.join(' → ')||label('Worker 尚未上报 Session','Worker has not reported a Session')}</small></td><td><Status value={a.ended_at?(a.error?'failed':'completed'):'running'}/><small>{a.error??new Date(a.started_at*1000).toLocaleString()}</small></td></tr>)}</tbody></table>{!executions.length&&<Empty title={label('暂无执行记录','No execution records')}/>}<p className="cluster-footnote">{tasks.filter(t=>!t.attempts.length).length} {label('个任务尚未开始执行','tasks have not started execution')}</p></div>}
    {view==='events'&&<div className="cluster-event-list">{!events.length&&<Empty title={label('暂无匹配事件','No matching events')}/>}<p className="cluster-footnote">{label('显示最新 200 条事件；完整任务记录可从任务详情追溯。','Showing the latest 200 events; inspect tasks for their execution history.')}</p>{events.map(e=><div className="cluster-event" key={e.sequence}><span className="tiny text-muted">{new Date(e.timestamp*1000).toLocaleTimeString()} · {eventTitle(e.kind,label)} · #{e.sequence}</span>{e.task_id&&<button className="cluster-link" onClick={()=>onTask(e.task_id!)}>{state.tasks[e.task_id]?.spec.title??e.task_id}</button>}{state.instance_commands?.[e.detail]?<><b>{state.instance_commands[e.detail].action} · {state.instance_commands[e.detail].status}</b><pre>{JSON.stringify(state.instance_commands[e.detail].result,null,2)}</pre></>:<EventContent event={e}/>}</div>)}</div>}
    {view==='artifacts'&&<div>{!artifacts.length&&<Empty title={label('暂无执行产物','No execution artifacts')}/>} {artifacts.map(a=><div className="row" key={a.id}><div className="cluster-task-title"><b>{a.name}</b><small>{state.tasks[a.task_id]?.spec.title} · #{a.generation} · {a.kind} · {a.size} bytes</small></div><Button disabled={busy} variant="ghost" onClick={()=>void run(async()=>{const value=await distributed.artifact(a.id);fileDownload(a.name,Uint8Array.from(atob(value.content_base64),c=>c.charCodeAt(0)),'application/octet-stream')})}>{label('下载','Download')}</Button></div>)}</div>}
  </div>
}
