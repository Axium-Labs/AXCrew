import { api } from './api'
import type { Member } from './types'
export type SshConnection={id:string;name:string;host:string;port:number|null;identity_file:string|null}
export type Project={id:string;name:string;device_id:string;cwd:string;member_id:string}
export type Workspace={cwd:string;parent:string|null;directories:{name:string;path:string}[];hint?:string}
export const connections={
  selectModel:(id:string,provider:string,model:string)=>api<Member>(`/api/environments/${encodeURIComponent(id)}/model`,'POST',{provider,model}),
  ssh:()=>api<SshConnection[]>('/api/connections/ssh'),
  discover:()=>api<SshConnection[]>('/api/connections/ssh/discover'),
  add:(body:Omit<SshConnection,'id'>)=>api<SshConnection>('/api/connections/ssh','POST',body),
  connect:(id:string)=>api<Workspace>(`/api/connections/ssh/${encodeURIComponent(id)}/connect`,'POST',{}),
  workspace:(id:string,cwd?:string)=>api<Workspace>(`/api/devices/${encodeURIComponent(id)}/workspace${cwd?`?cwd=${encodeURIComponent(cwd)}`:''}`),
  projects:()=>api<Project[]>('/api/projects'),
  createProject:(body:{name:string;device_id:string;cwd:string})=>api<Project>('/api/projects','POST',body),
  removeProject:(id:string)=>api(`/api/projects/${encodeURIComponent(id)}`,'DELETE'),
}
