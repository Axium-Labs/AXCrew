import { api } from './api'

export type Resources = { cpu:number; ram_mb:number; gpu:number }
export type Capabilities = { roles:string[]; skills:string[]; mcp:string[]; tools:string[]; models:string[]; permissions:string[]; environments:string[] }
export type HostInventory = {hostname:string;os:string;arch:string;cpu_name:string;cpu:number;ram_mb:number|null;gpu:number|null;gpu_names:string[];errors:string[];metrics?:{system:{cpu_usage:number|null;memory_used_mb:number|null;memory_total_mb:number|null;gpus:{name:string;usage:number|null;memory_used_mb:number|null;memory_total_mb:number|null}[]|null};disks:{mount:string;total_mb:number;available_mb:number}[];network:{received_bytes_per_second:number;transmitted_bytes_per_second:number}}|null}
export type ClusterHost = { id:string; name:string; resources:Resources; last_seen:number; enabled:boolean;inventory?:HostInventory|null;inventory_at?:number }
export type ExecutionModel = {provider:string;model:string}
export type ModelOption = ExecutionModel & {name:string;source:string}
export type ModelCatalog = {current:ExecutionModel|null;models:ModelOption[];error:string|null}
export type PlacementMatch = {instance_id:string;reasons:string[]}
export type Requirements = {capabilities:Partial<Capabilities>;resources:Resources;instance_id?:string|null;host_id?:string|null;model?:ExecutionModel|null;duty?:string}
export type AxInstance = { id:string; host_id:string; name:string; capabilities:Capabilities;pending_capabilities?:Capabilities|null; projects:string[]; max_executions:number; can_delegate:boolean; enabled:boolean; last_seen:number; incarnation:string;remote_management?:boolean;model_catalog?:ModelCatalog|null;model_catalog_at?:number }
export type DistributedTask = { removed?:boolean; id:string; creator:string; spec:{title:string;input:string;project_id:string;workflow_id?:string|null;context_summary:string;dependencies:string[];artifacts:string[];parent_id:string|null;workspace_revision?:string|null;requirements:Requirements};status:string;owner:string|null;generation:number;lease_until:number;result:string|null;failure:string|null;artifacts:string[];attempts:{generation:number;instance_id:string;started_at:number;ended_at:number|null;error:string|null;sessions?:string[];model?:ExecutionModel|null;duty?:string}[];placement?:PlacementMatch[] }
export type ClusterArtifact = { id:string;task_id:string;generation:number;project_id:string;kind:string;name:string;sha256:string;size:number }
export type ClusterEvent = { sequence:number;timestamp:number;kind:string;task_id:string|null;instance_id:string|null;detail:string }
export type Collaboration = {kind:string;paused:boolean;participants:Record<string,string>;requirements:Partial<Capabilities>;member_models?:Record<string,ExecutionModel>;excluded_instances?:string[]}
export type ExecutionCommand = {id:string;task_id:string;generation:number;session_id:string;kind:string;request_id?:string|null;text:string;status:string;result:string|null;created_at:number}
export type Workflow = {removed?:boolean;objective?:string|null;id:string;title:string;project_id:string;root_task_id:string;status:string;revision:number;state:Record<string,unknown>;updated_at:number;collaboration?:Collaboration}
export type InstanceCommand = {id:string;instance_id:string;incarnation:string;action:string;scope:string;project_id:string|null;input:unknown;status:string;result:unknown}
export type Cluster = {revision:number;server_time:number;hosts:Record<string,ClusterHost>;removed_hosts?:Record<string,ClusterHost>;instances:Record<string,AxInstance>;removed_instances?:Record<string,AxInstance>;tasks:Record<string,DistributedTask>;artifacts:Record<string,ClusterArtifact>;events:ClusterEvent[];workflows:Record<string,Workflow>;commands?:Record<string,ExecutionCommand>;instance_commands?:Record<string,InstanceCommand>}
export const workflowTasks=(state:Cluster,w:Workflow)=>Object.values(state.tasks).filter(t=>!t.removed&&(t.spec.workflow_id===w.id||t.id===w.root_task_id))
export const historyHost=(state:Cluster,id:string)=>state.hosts[id]??state.removed_hosts?.[id]
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
  removeHost:(id:string)=>api(`/api/distributed/hosts/${encodeURIComponent(id)}`,'DELETE'),
  removeWorkflow:(w:Workflow)=>api(`/api/distributed/workflows/${encodeURIComponent(w.id)}`,'DELETE',{expected_revision:w.revision}),
  removeInstance:(id:string)=>api(`/api/distributed/instances/${encodeURIComponent(id)}`,'DELETE'),
  configure:(id:string,body:Capabilities)=>api(`/api/distributed/instances/${encodeURIComponent(id)}/capabilities`,'POST',body),
  plan:(body:unknown)=>api<DistributedTask[]>('/api/distributed/plans','POST',body),
  preview:(body:unknown)=>api<PlacementMatch[]>('/api/distributed/placement','POST',body),
  submit:(body:unknown)=>api<DistributedTask>('/api/distributed/tasks','POST',body),
  control:(id:string,action:'cancel'|'retry'|'pause'|'resume')=>api(`/api/distributed/tasks/${encodeURIComponent(id)}/${action}`,'POST',{}),
  workflowControl:(id:string,action:string)=>api(`/api/distributed/workflows/${encodeURIComponent(id)}/control/${action}`,'POST',{}),
  settings:(w:Workflow,policy:Omit<Collaboration,'paused'> & {new_tasks?:unknown[];title?:string;objective?:string})=>api(`/api/distributed/workflows/${encodeURIComponent(w.id)}/settings`,'POST',{expected_revision:w.revision,...policy}),
  editTask:(t:DistributedTask,title:string,input:string,remove=false)=>api(`/api/distributed/tasks/${encodeURIComponent(t.id)}/edit`,'POST',{generation:t.generation,expected_title:t.spec.title,expected_input:t.spec.input,title,input,remove}),
  reassign:(t:DistributedTask,instance_id:string|null,model:ExecutionModel|null=null,duty?:string,dependencies?:string[],placement?:{host_id:string|null;resources:Resources})=>api(`/api/distributed/tasks/${encodeURIComponent(t.id)}/reassign`,'POST',{generation:t.generation,instance_id,model,duty,dependencies,...(placement?{host_id:placement.host_id,clear_host:!placement.host_id,resources:placement.resources}:{})}),
  command:(t:DistributedTask,session_id:string,kind:string,text:string,request_id?:string)=>api(`/api/distributed/tasks/${encodeURIComponent(t.id)}/commands`,'POST',{generation:t.generation,session_id,kind,text,request_id}),
  batch:(body:unknown)=>api<{results:{instance_id:string;accepted:boolean;error:string|null}[]}>('/api/distributed/batch','POST',body),
  manage:(id:string,body:unknown)=>api<InstanceCommand>(`/api/distributed/instances/${encodeURIComponent(id)}/manage`,'POST',body),
  checkpoint:(w:Workflow,state:Record<string,unknown>)=>api(`/api/distributed/workflows/${encodeURIComponent(w.id)}/checkpoint`,'POST',{expected_revision:w.revision,state}),
  enable:(kind:'hosts'|'instances',id:string,enabled:boolean)=>api(`/api/distributed/${kind}/${encodeURIComponent(id)}/enabled`,'POST',{enabled}),
  artifact:(id:string)=>api<{artifact:ClusterArtifact;content_base64:string}>(`/api/distributed/artifacts/${encodeURIComponent(id)}`),
}

export const activeSession=(t:DistributedTask)=>t.status==='running'?t.attempts.at(-1)?.sessions?.at(-1):undefined
export const executionSession=(t:DistributedTask)=>t.attempts.at(-1)?.sessions?.at(-1)
export const modelKey=(m:ExecutionModel)=>JSON.stringify([m.provider,m.model])
export const parseModel=(value:string):ExecutionModel|null=>{if(!value)return null;const [provider,model]=JSON.parse(value) as string[];return {provider,model}}
export const modelOptions=(instances:AxInstance[],now:number)=>{
  const models=new Map<string,ModelOption>();
  for(const i of instances)if(i.enabled&&i.last_seen>now-30&&(i.model_catalog_at??0)>now-180&&!i.model_catalog?.error)for(const m of i.model_catalog?.models??[])models.set(modelKey(m),m)
  return [...models.values()]
}
export const placementReason=(reason:string,label:(cn:string,en:string)=>string)=>{
  const reasons:Record<string,string>={'AX offline or disabled':'AX 离线或禁用','project not approved':'项目未授权','different AX requested':'指定了其他 AX','different Host requested':'指定了其他 Host','task capabilities unavailable':'任务所需能力不可用','collaboration paused':'协作已暂停','outside collaboration members':'不在当前协作成员范围','collaboration capabilities unavailable':'协作所需能力不可用','system resource limits unsupported':'未实现系统资源强制限制','execution model unavailable or catalog stale':'执行模型不可用或目录已过期','AX execution slots full':'AX 并发槽位已满','AX default model not configured':'AX 未配置默认模型','instance configuration executing':'实例正在更新配置','Host offline or disabled':'Host 离线或禁用','Host scheduling capacity insufficient or unknown':'Host 可用调度资源不足或未知','Host missing':'Host 不存在','dependencies unfinished':'依赖任务未完成'}
  return label(reasons[reason]??reason,reason)
}
