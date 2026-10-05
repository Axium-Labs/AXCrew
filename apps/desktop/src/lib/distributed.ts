import { api } from './api'

export type Resources = { cpu:number; ram_mb:number; gpu:number }
export type Capabilities = { roles:string[]; skills:string[]; mcp:string[]; tools:string[]; models:string[]; permissions:string[]; environments:string[] }
export type ClusterHost = { id:string; name:string; resources:Resources; last_seen:number; enabled:boolean }
export type AxInstance = { id:string; host_id:string; name:string; capabilities:Capabilities; projects:string[]; max_executions:number; can_delegate:boolean; enabled:boolean; last_seen:number; incarnation:string }
export type DistributedTask = { id:string; creator:string; spec:{title:string;input:string;project_id:string;context_summary:string;dependencies:string[];artifacts:string[];parent_id:string|null;workspace_revision?:string|null;requirements:{capabilities:Partial<Capabilities>;resources:Resources;instance_id?:string|null}};status:string;owner:string|null;generation:number;lease_until:number;result:string|null;failure:string|null;artifacts:string[];attempts:{generation:number;instance_id:string;started_at:number;ended_at:number|null;error:string|null}[] }
export type ClusterArtifact = { id:string;task_id:string;generation:number;project_id:string;kind:string;name:string;sha256:string;size:number }
export type ClusterEvent = { sequence:number;timestamp:number;kind:string;task_id:string|null;instance_id:string|null;detail:string }
export type Workflow = {id:string;title:string;project_id:string;root_task_id:string;status:string;revision:number;state:Record<string,unknown>;updated_at:number}
export type Cluster = {revision:number;server_time:number;hosts:Record<string,ClusterHost>;instances:Record<string,AxInstance>;tasks:Record<string,DistributedTask>;artifacts:Record<string,ClusterArtifact>;events:ClusterEvent[];workflows:Record<string,Workflow>}
export const distributed = {
  state:()=>api<Cluster>('/api/distributed'),
  enroll:(body:unknown)=>api<{instance:AxInstance;token:string}>('/api/distributed/enroll','POST',body),
  submit:(body:unknown)=>api<DistributedTask>('/api/distributed/tasks','POST',body),
  control:(id:string,action:'cancel'|'retry')=>api(`/api/distributed/tasks/${encodeURIComponent(id)}/${action}`,'POST',{}),
  enable:(kind:'hosts'|'instances',id:string,enabled:boolean)=>api(`/api/distributed/${kind}/${encodeURIComponent(id)}/enabled`,'POST',{enabled}),
  resources:(id:string,body:Resources)=>api(`/api/distributed/hosts/${encodeURIComponent(id)}/resources`,'POST',body),
  artifact:(id:string)=>api<{artifact:ClusterArtifact;content_base64:string}>(`/api/distributed/artifacts/${encodeURIComponent(id)}`),
}
