import { translate, useLang } from '../lib/i18n'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Copy, Monitor, Plus, Radio, Trash2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Action, Empty, Field, PageHead, Status } from '../components/shared'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { api, endpoints } from '../lib/api'
import { useDevices, useSessions, useTasks } from '../lib/query'
import { short,time } from '../lib/utils'
import { useUi } from '../store/ui'

export function Devices(){
  useLang(state=>state.lang);

  const devices=useDevices(),[params,setParams]=useSearchParams(),[pair,setPair]=useState<{code:string;expires_in_seconds:number;issued:number}|null>(null),[now,setNow]=useState(Date.now()),{gatewayUrl,setGatewayUrl}=useUi()
  const open=params.get('pair')==='1'
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  const issue=async()=>{const value=await api<{code:string;expires_in_seconds:number}>('/api/pairing','POST',{});setPair({...value,issued:Date.now()})}
  const remaining=pair?Math.max(0,Math.ceil((pair.issued+pair.expires_in_seconds*1000-now)/1000)):0
  return <div className="page"><PageHead eyebrow={translate("english.57")} title={translate("english.58")} description={translate("english.59")} actions={<Button onClick={()=>{setParams({pair:'1'})}}><Plus size={14}/> {translate("copy.131")}</Button>}/>
    <div className="panel">{devices.data?.map(d=><Link to={`/devices/${d.id}`} className="row no-underline text-foreground" key={d.id}><Monitor size={17} className="text-muted"/><div className="min-w-0 flex-1"><div className="row-title">{d.name}{d.id==='local'&&<span className="ml-2 tiny">{translate("english.60")}</span>}</div><div className="row-sub">{d.hostname} · {d.platform}/{d.arch} {translate("english.61")}{d.ax_version}</div></div><Status value={d.status}/><span className="tiny w-36 text-right">{time(d.last_seen)}</span></Link>)}{!devices.data?.length&&<Empty title={translate("english.62")}/>}</div>
    <Dialog open={open} onOpenChange={value=>{if(!value){setParams({});setPair(null)}}} title={translate("copy.116")}><p className="mb-4 text-sm text-muted">{translate("copy.132")}</p><Field label={translate("english.63")}><Input value={gatewayUrl} onChange={e=>setGatewayUrl(e.target.value)} placeholder="https://crew.example.com"/></Field>{pair&&remaining>0?<><div className="mt-4 flex items-center gap-3 rounded-[var(--radius-chip)] border border-border bg-surface p-3"><code className="mono flex-1 break-all text-sm">{pair.code}</code><Button variant="ghost" size="icon" onClick={()=>navigator.clipboard.writeText(pair.code)} aria-label={translate("english.64")}><Copy size={15}/></Button></div><div className="mt-2 text-xs text-warning">{translate("english.65")}{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</div>{gatewayUrl?<><div className="mt-5 text-xs text-muted">{translate("english.66")}</div><pre className="mt-2 overflow-x-auto rounded-[var(--radius-chip)] border border-border bg-surface p-3 text-xs">ax crew pair {pair.code} --gateway {gatewayUrl}{ '\n' }ax crew connect {gatewayUrl}</pre></>:<p className="mt-4 text-xs text-warning">{translate("english.70")}</p>}<div className="mt-4 flex items-center gap-2 text-xs text-muted"><Radio size={14}/> {translate("english.71")}</div></>:<div className="mt-4"><Action run={issue}>{translate("english.72")}</Action></div>}</Dialog>
  </div>
}
export function DeviceDetail(){
  useLang(state=>state.lang);

  const {id=''}=useParams(),devices=useDevices(),tasks=useTasks(),sessions=useSessions(),device=devices.data?.find(d=>d.id===id)
  const settings=useQuery({queryKey:['settings'],queryFn:endpoints.settings}),[cwd,setCwd]=useState(''),[name,setName]=useState(''),[editing,setEditing]=useState(false),[fingerprint,setFingerprint]=useState('')
  useEffect(()=>{if(settings.data&&!cwd)setCwd(settings.data.default_cwd)},[settings.data,cwd])
  useEffect(()=>{if(!device?.public_key){setFingerprint(translate('detail.17'));return}const binary=Uint8Array.from(atob(device.public_key),c=>c.charCodeAt(0));void crypto.subtle.digest('SHA-256',binary).then(hash=>setFingerprint([...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join(':')))},[device?.public_key])
  const catalogCwd=useDebouncedValue(cwd)
  const catalog=useQuery({queryKey:['capabilities',id,catalogCwd],queryFn:()=>endpoints.capabilities(id,catalogCwd),enabled:!!device&&!!catalogCwd&&['online','busy'].includes(device.status),retry:0})
  if(!device)return <div className="page"><Empty title={devices.isPending?translate("copy.133"):devices.isError?translate("copy.134"):translate("copy.135")}/></div>
  const running=(tasks.data??[]).filter(t=>t.assigned_device===id&&['running','waiting_permission','ready'].includes(t.status))
  return <div className="page"><PageHead eyebrow={translate("english.11")} title={device.name} description={`${device.hostname} · ${device.platform}/${device.arch}`} actions={<><Status value={device.status}/><Button variant="secondary" onClick={()=>{setName(device.name);setEditing(true)}}>{translate("english.73")}</Button>{id!=='local'&&<Action variant="danger" run={async()=>{if(window.confirm(`Revoke ${device.name}? Active work will fail.`))await api(`/api/devices/${id}/revoke`,'POST',{})}}><Trash2 size={13}/> {translate("english.74")}</Action>}</>}/>
    <div className="grid gap-5 xl:grid-cols-2"><section className="panel"><div className="panel-header">{translate("english.75")}</div><div className="grid grid-cols-[140px_1fr] gap-y-3 p-4 text-sm">{[['ID',device.id],[translate('detail.16'),device.status],[translate('detail.12'),device.ax_version],[translate('detail.13'),String(device.protocol_version)],[translate('detail.14'),time(device.last_seen)],[translate('detail.15'),fingerprint]].map(([label,value])=><div className="contents" key={label}><span className="text-muted">{label}</span><span className="mono break-all text-xs">{value}</span></div>)}</div></section>
    <section className="panel"><div className="panel-header">{translate("english.76")}</div><div className="p-4"><Field label={translate("english.77")}><Input value={cwd} onChange={e=>setCwd(e.target.value)} placeholder={translate("english.78")}/></Field>{catalog.isLoading?<p className="mt-3 text-xs text-muted">{translate("english.79")}</p>:catalog.error?<p className="mt-3 text-xs text-danger">{String(catalog.error)}</p>:catalog.data?<div className="mt-4 space-y-3 text-xs"><div>{translate("english.80")}{catalog.data.models.providers.map(p=>p.id).join(', ')||translate('detail.8')}</div><div>{translate("english.81")}{catalog.data.skills.skills.map(s=>s.name).join(', ')||translate('detail.9')}</div><div>{translate("english.82")}{catalog.data.mcp.servers.map(s=>s.name).join(', ')||translate('detail.8')}</div></div>:null}</div></section></div>
    <h2 className="section-title">{translate("english.83")}</h2><div className="panel">{running.length?running.map(t=><Link key={t.id} to={`/tasks/${t.id}`} className="row justify-between no-underline text-foreground"><span>{t.title}</span><Status value={t.status}/></Link>):<Empty title={translate("english.84")}/>}</div>
    <h2 className="section-title">{translate("english.85")}</h2><div className="panel">{sessions.data?.filter(s=>s.device_id===id).map(s=><Link key={s.task_id} to={`/sessions/${s.task_id}`} className="row no-underline text-foreground"><span className="flex-1">{tasks.data?.find(t=>t.id===s.task_id)?.title??short(s.ax_session_id)}</span><span className="tiny mono">{short(s.ax_session_id)}</span></Link>)}{!sessions.data?.some(s=>s.device_id===id)&&<Empty title={translate("english.86")}/>}</div>
    <Dialog open={editing} onOpenChange={setEditing} title={translate("english.87")}><Field label={translate("english.88")}><Input value={name} onChange={e=>setName(e.target.value)}/></Field><div className="mt-5"><Action run={async()=>{await api(`/api/devices/${id}/rename`,'POST',{name});setEditing(false)}} disabled={!name.trim()}>{translate("english.89")}</Action></div></Dialog>
  </div>
}
