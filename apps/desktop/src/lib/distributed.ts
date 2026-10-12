import { api } from './api'

export type Resources = { cpu:number; ram_mb:number; gpu:number }
export type Capabilities = { roles:string[]; skills:string[]; mcp:string[]; tools:string[]; models:string[]; permissions:string[]; environments:string[] }
export type HostInventory = {hostname:string;os:string;arch:string;cpu_name:string;cpu:number;ram_mb:number|null;gpu:number|null;gpu_names:string[];errors:string[];metrics?:{system:{cpu_usage:number|null;memory_used_mb:number|null;memory_total_mb:number|null;gpus:{name:string;usage:number|null;memory_used_mb:number|null;memory_total_mb:number|null}[]|null};disks:{mount:string;total_mb:number;available_mb:number}[];network:{received_bytes_per_second:number;transmitted_bytes_per_second:number}}|null}
export type ClusterHost = { id:string; name:string; resources:Resources; last_seen:number; enabled:boolean;inventory?:HostInventory|null;inventory_at?:number }
export type AxInstance = { id:string; host_id:string; name:string; capabilities:Capabilities;pending_capabilities?:Capabilities|null; projects:string[]; max_executions:number; can_delegate:boolean; enabled:boolean; last_seen:number; incarnation:string;remote_management?:boolean }
export type DistributedTask = { id:string; creator:string; spec:{title:string;input:string;project_id:string;workflow_id?:string|null;context_summary:string;dependencies:string[];artifacts:string[];parent_id:string|null;workspace_revision?:string|null;requirements:{capabilities:Partial<Capabilities>;resources:Resources;instance_id?:string|null}};status:string;owner:string|null;generation:number;lease_until:number;result:string|null;failure:string|null;artifacts:string[];attempts:{generation:number;instance_id:string;started_at:number;ended_at:number|null;error:string|null;sessions?:string[]}[] }
export type ClusterArtifact = { id:string;task_id:string;generation:number;project_id:string;kind:string;name:string;sha256:string;size:number }
export type ClusterEvent = { sequence:number;timestamp:number;kind:string;task_id:string|null;instance_id:string|null;detail:string }
export type Collaboration = {kind:string;paused:boolean;participants:Record<string,string>;requirements:Partial<Capabilities>}
export type ExecutionCommand = {id:string;task_id:string;generation:number;session_id:string;kind:string;request_id?:string|null;text:string;status:string;result:string|null;created_at:number}
export type Workflow = {id:string;title:string;project_id:string;root_task_id:string;status:string;revision:number;state:Record<string,unknown>;updated_at:number;collaboration?:Collaboration}
export type InstanceCommand = {id:string;instance_id:string;incarnation:string;action:string;scope:string;project_id:string|null;input:unknown;status:string;result:unknown}
export type Cluster = {revision:number;server_time:number;hosts:Record<string,ClusterHost>;instances:Record<string,AxInstance>;removed_instances?:Record<string,AxInstance>;tasks:Record<string,DistributedTask>;artifacts:Record<string,ClusterArtifact>;events:ClusterEvent[];workflows:Record<string,Workflow>;commands?:Record<string,ExecutionCommand>;instance_commands?:Record<string,InstanceCommand>}
export const workflowTasks=(state:Cluster,w:Workflow)=>Object.values(state.tasks).filter(t=>t.spec.workflow_id===w.id||t.id===w.root_task_id)
export const historyInstance=(state:Cluster,id:string)=>state.instances[id]??state.removed_instances?.[id]
export function instanceRemovalBlockers(state:Cluster,id:string,label:(cn:string,en:string)=>string):string[]{
  const reasons:string[]=[]
  const tasks=Object.values(state.tasks).filter(t=>!['completed','failed','cancelled'].includes(t.status)&&(t.owner===id||t.spec.requirements.instance_id===id))
  const goals=Object.values(state.workflows).filter(w=>!['completed','cancelled'].includes(w.status)&&id in (w.collaboration?.participants??{}))
  if(tasks.length)reasons.push(label('请先重新分配或取消关联任务：','Reassign or cancel assigned tasks first: ')+tasks.map(t=>t.spec.title).join('、'))
  if(goals.length)reasons.push(label('请先从未完成协作中移除此成员：','Remove this member from unfinished collaborations first: ')+goals.map(w=>w.title).join('、'))
  if(Object.values(state.instance_commands??{}).some(c=>c.instance_id===id&&c.status==='executing'))reasons.push(label('原生配置操作正在执行，请等待结果后删除。','Native management is executing; wait for its outcome before deleting.'))
  return reasons
}
export const distributed = {
  state:()=>api<Cluster>('/api/distributed'),
  enroll:(body:unknown)=>api<{instance:AxInstance;token:string}>('/api/distributed/enroll','POST',body),
  removeInstance:(id:string)=>api(`/api/distributed/instances/${encodeURIComponent(id)}`,'DELETE'),
  configure:(id:string,body:Capabilities)=>api(`/api/distributed/instances/${encodeURIComponent(id)}/capabilities`,'POST',body),
  submit:(body:unknown)=>api<DistributedTask>('/api/distributed/tasks','POST',body),
  control:(id:string,action:'cancel'|'retry'|'pause'|'resume')=>api(`/api/distributed/tasks/${encodeURIComponent(id)}/${action}`,'POST',{}),
  workflowControl:(id:string,action:string)=>api(`/api/distributed/workflows/${encodeURIComponent(id)}/control/${action}`,'POST',{}),
  settings:(w:Workflow,policy:Omit<Collaboration,'paused'>)=>api(`/api/distributed/workflows/${encodeURIComponent(w.id)}/settings`,'POST',{expected_revision:w.revision,...policy}),
  reassign:(t:DistributedTask,instance_id:string|null)=>api(`/api/distributed/tasks/${encodeURIComponent(t.id)}/reassign`,'POST',{generation:t.generation,instance_id}),
  command:(t:DistributedTask,session_id:string,kind:string,text:string,request_id?:string)=>api(`/api/distributed/tasks/${encodeURIComponent(t.id)}/commands`,'POST',{generation:t.generation,session_id,kind,text,request_id}),
  batch:(body:unknown)=>api<{results:{instance_id:string;accepted:boolean;error:string|null}[]}>('/api/distributed/batch','POST',body),
  manage:(id:string,body:unknown)=>api<InstanceCommand>(`/api/distributed/instances/${encodeURIComponent(id)}/manage`,'POST',body),
  checkpoint:(w:Workflow,state:Record<string,unknown>)=>api(`/api/distributed/workflows/${encodeURIComponent(w.id)}/checkpoint`,'POST',{expected_revision:w.revision,state}),
  enable:(kind:'hosts'|'instances',id:string,enabled:boolean)=>api(`/api/distributed/${kind}/${encodeURIComponent(id)}/enabled`,'POST',{enabled}),
  artifact:(id:string)=>api<{artifact:ClusterArtifact;content_base64:string}>(`/api/distributed/artifacts/${encodeURIComponent(id)}`),
}
