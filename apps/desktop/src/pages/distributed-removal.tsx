import { distributed, workflowTasks, type ClusterHost, type Workflow } from '../lib/distributed'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import type { WorkbenchProps } from './Distributed'

export function RemoveCollaboration({state,workflow:w,label,busy,error,run,close,onTask}:WorkbenchProps&{workflow:Workflow;close:()=>void}){
  const tasks=workflowTasks(state,w),ids=new Set(tasks.map(t=>t.id))
  const blockers=Object.values(state.tasks).filter(t=>!t.removed&&!ids.has(t.id)&&(t.spec.dependencies.some(id=>ids.has(id))||!!t.spec.parent_id&&ids.has(t.spec.parent_id)))
  return <Dialog open title={label('移除协作','Remove collaboration')} onOpenChange={open=>{if(!open&&!busy)close()}}><div className="cluster-form">
    <strong>{w.title}</strong>
    <p>{label(`将移除此协作及其 ${tasks.length} 项工作任务，并停止未完成的执行。执行历史、Session、产物和检查点保留在“执行活动”中。`,`Remove this collaboration and its ${tasks.length} work tasks, stopping unfinished execution. Execution history, Sessions, artifacts and checkpoints remain in Activity.`)}</p>
    {blockers.length>0&&<div role="alert"><p>{label('其他协作中的以下任务仍依赖此协作，请先处理这些任务：','Tasks in other collaborations still depend on this work. Resolve them first:')}</p>{blockers.map(t=><Button key={t.id} variant="ghost" onClick={()=>{close();onTask(t.id)}}>{t.spec.title}</Button>)}</div>}
    {error&&<p role="alert" className="text-danger">{error}</p>}
    <div className="cluster-toolbar"><Button disabled={busy} variant="secondary" onClick={close}>{label('保留协作','Keep collaboration')}</Button><Button disabled={busy||blockers.length>0} variant="danger" onClick={()=>void run(async()=>{await distributed.removeWorkflow(w);close()})}>{label('确认移除协作','Confirm removal')}</Button></div>
  </div></Dialog>
}

export function RemoveHost({state,host:h,label,busy,error,run,close,onTask}:WorkbenchProps&{host:ClusterHost;close:()=>void}){
  const instances=Object.values(state.instances).filter(i=>i.host_id===h.id)
  const tasks=Object.values(state.tasks).filter(t=>!t.removed&&!['completed','failed','cancelled'].includes(t.status)&&t.spec.requirements.host_id===h.id)
  return <Dialog open title={label('移除机器','Remove host')} onOpenChange={open=>{if(!open&&!busy)close()}}><div className="cluster-form">
    <strong>{h.name}</strong><p>{label('将此 Host 从节点列表移除，保留历史机器信息。不会删除机器上的程序、配置或文件。再次连接 AX 时可重新注册此机器。','Remove this Host from Nodes while retaining historical inventory. Programs, configuration and files on the machine are unchanged. A new AX enrollment can register this host again.')}</p>
    {instances.length>0&&<p role="alert">{label('请先删除此机器上的 AX 实例连接：','Delete the AX instance connections on this host first: ')}{instances.map(i=>i.name).join(', ')}</p>}
    {tasks.length>0&&<div role="alert"><p>{label('请先重新分配或取消指定此机器的任务：','Reassign or cancel tasks pinned to this host first:')}</p>{tasks.map(t=><Button key={t.id} variant="ghost" onClick={()=>{close();onTask(t.id)}}>{t.spec.title}</Button>)}</div>}
    {error&&<p role="alert" className="text-danger">{error}</p>}
    <div className="cluster-toolbar"><Button disabled={busy} variant="secondary" onClick={close}>{label('保留机器','Keep host')}</Button><Button disabled={busy||!!instances.length||!!tasks.length} variant="danger" onClick={()=>void run(async()=>{await distributed.removeHost(h.id);close()})}>{label('确认移除机器','Confirm removal')}</Button></div>
  </div></Dialog>
}
