import { api } from './api'
export type ChatPlatform='slack'|'discord'|'telegram'|'webex'|'wecom'|'feishu'|'teams'|'weixin'|'imessage'|'whatsapp'
export type ChatChannel={platform:ChatPlatform;enabled:boolean;configured:boolean;app_id:string;cwd:string;account:string;state:string;available?:boolean;app_token_configured?:boolean;tenant_id?:string;public_url?:string;bridge_path?:string;database_path?:string;qr?:string|null;peers:{id:string;sender:string;approved:boolean}[]}
export const chatChannels={
  installWhatsapp:()=>api<{installed:boolean}>('/api/channels/whatsapp/install','POST',{}),
  list:()=>api<ChatChannel[]>('/api/channels'),
  save:(platform:ChatPlatform,body:{enabled:boolean;cwd:string;app_id?:string;secret?:string;app_token?:string;tenant_id?:string;public_url?:string;bridge_path?:string;database_path?:string})=>api<ChatChannel[]>('/api/channels/'+platform,'PUT',body),
  disconnect:(platform:ChatPlatform)=>api('/api/channels/'+platform,'DELETE'),
  pairing:(platform:ChatPlatform)=>api<{command:string;expires_at:number}>('/api/channels/'+platform+'/pairing','POST',{}),
  approve:(platform:ChatPlatform,id:string)=>api('/api/channels/'+platform+'/peers/'+encodeURIComponent(id)+'/approve','POST',{}),
  revoke:(platform:ChatPlatform,id:string)=>api('/api/channels/'+platform+'/peers/'+encodeURIComponent(id),'DELETE'),
  weixinLogin:()=>api<{id:string;content:string;expires_at:number}>('/api/channels/weixin/login','POST',{}),
  weixinPoll:(id:string,verify_code?:string)=>api<{status:string}>('/api/channels/weixin/login/status','POST',{id,verify_code}),
}
