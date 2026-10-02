import { invoke } from '@tauri-apps/api/core'
import type { Automation,AutomationRun,Catalog,Crew,CrewEvent,Device,LocalAxOverview,Member,Permission,Session,SessionHistory,Task } from './types'

type Connection={endpoint:string;token:string;lan_url?:string}
let connection:Promise<Connection>|null=null
export function getConnection(){return connection??=invoke<Connection>('backend_connection').catch(error=>{connection=null;throw error})}
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
  const {endpoint,token}=await getConnection()
  const response=await fetch(endpoint+path,{method,headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)})
  if(!response.ok){const text=await response.text();let detail=text;try{detail=JSON.parse(text).error??text}catch{/* plain-text gateway error */}throw new Error(detail||`${response.status} ${response.statusText}`)}
  if(response.status===204)return undefined as T
  return response.json() as Promise<T>
}
export const endpoints={
  health:()=>api<{status:string;version:string}>('/api/health'),
  settings:()=>api<{version:string;default_cwd:string;protocol_version:number}>('/api/settings'),
  devices:()=>api<Device[]>('/api/devices'),
  device:(id:string)=>api<Device|null>(`/api/devices/${encodeURIComponent(id)}`),
  capabilities:(id:string,cwd:string)=>api<Catalog>(`/api/devices/${encodeURIComponent(id)}/capabilities?cwd=${encodeURIComponent(cwd)}`),
  crews:()=>api<Crew[]>('/api/crews'),
  members:(id:string)=>api<Member[]>(`/api/crews/${encodeURIComponent(id)}/members`),
  tasks:()=>api<Task[]>('/api/tasks'),
  task:(id:string)=>api<Task|null>(`/api/tasks/${encodeURIComponent(id)}`),
  sessions:()=>api<Session[]>('/api/sessions'),
  history:(id:string)=>api<SessionHistory>(`/api/sessions/${encodeURIComponent(id)}/history`),
  permissions:()=>api<Permission[]>('/api/permissions'),
  automations:()=>api<Automation[]>('/api/automations'),
  automationRuns:(limit=100)=>api<AutomationRun[]>(`/api/automations/runs?limit=${limit}`),
  localAx:()=>api<LocalAxOverview>('/api/ax/local'),
  localSession:(id:string)=>api<SessionHistory>(`/api/ax/local/${encodeURIComponent(id)}`),
  events:(offset=0,limit=100)=>api<CrewEvent[]>(`/api/events?offset=${offset}&limit=${limit}`),
  tokens:()=>api<{tokens:GatewayToken[]}>('/api/tokens'),
  createToken:(ttlSeconds:number|null,label?:string)=>api<{token:string;label?:string|null;expires_at:number|null;created_at:number}>('/api/tokens','POST',{ttl_seconds:ttlSeconds,label}),
  revokeToken:(value:string)=>api<{revoked:string}>(`/api/tokens/${encodeURIComponent(value)}`,'DELETE'),
  // 手机配对与设备授权
  issuePairing:()=>api<{code:string;short_code:string;expires_at:number;expires_in_seconds:number}>('/api/pairing/client','POST',{}),
  authorizations:()=>api<{pending:AuthorizedClient[];authorized:AuthorizedClient[]}>('/api/authorizations'),
  confirmAuthorization:(id:string)=>api<{confirmed:boolean;device_id:string}>(`/api/authorizations/${encodeURIComponent(id)}/confirm`,'POST',{}),
  denyAuthorization:(id:string)=>api<{denied:boolean;device_id:string}>(`/api/authorizations/${encodeURIComponent(id)}/deny`,'POST',{}),
  revokeAuthorization:(id:string)=>api<{revoked:boolean;device_id:string}>(`/api/authorizations/${encodeURIComponent(id)}`,'DELETE'),
  // 讯飞语音识别配置（桌面端写入 / 手机端读取）
  xfy:()=>api<{configured?:boolean;appid?:string;api_key?:string;api_secret?:string}>('/api/xfy'),
  setXfy:(body:{appid:string;api_key:string;api_secret:string})=>api<{configured:boolean}>('/api/xfy','POST',body),
}
export type GatewayToken={value:string;label?:string|null;expires_at?:number|null;created_at:number}
export type AuthorizedClient={device_id:string;name:string;platform:string;status:string;created_at:number;last_active:number}
