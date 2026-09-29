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
  const devices=useDevices(),[params,setParams]=useSearchParams(),[pair,setPair]=useState<{code:string;expires_in_seconds:number;issued:number}|null>(null),[now,setNow]=useState(Date.now()),{gatewayUrl,setGatewayUrl}=useUi()
  const open=params.get('pair')==='1'
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  const issue=async()=>{const value=await api<{code:string;expires_in_seconds:number}>('/api/pairing','POST',{});setPair({...value,issued:Date.now()})}
  const remaining=pair?Math.max(0,Math.ceil((pair.issued+pair.expires_in_seconds*1000-now)/1000)):0
  return <div className="page"><PageHead eyebrow="Infrastructure" title="Devices" description="AX runtimes available to Crew" actions={<Button onClick={()=>{setParams({pair:'1'})}}><Plus size={14}/> 配对设备</Button>}/>
    <div className="panel">{devices.data?.map(d=><Link to={`/devices/${d.id}`} className="row no-underline text-foreground" key={d.id}><Monitor size={17} className="text-muted"/><div className="min-w-0 flex-1"><div className="row-title">{d.name}{d.id==='local'&&<span className="ml-2 tiny">local AX</span>}</div><div className="row-sub">{d.hostname} · {d.platform}/{d.arch} · AX {d.ax_version}</div></div><Status value={d.status}/><span className="tiny w-36 text-right">{time(d.last_seen)}</span></Link>)}{!devices.data?.length&&<Empty title="No devices registered"/>}</div>
    <Dialog open={open} onOpenChange={value=>{if(!value){setParams({});setPair(null)}}} title="配对远程 AX 设备"><p className="mb-4 text-sm text-muted">本地 AX 设备已自动就绪。输入另一台机器可访问的 HTTPS 网关地址，在那台机器上执行下方命令，把它加入 Crew（与手机连接无关，手机连接请使用「连接手机」）。</p><Field label="Remote gateway URL"><Input value={gatewayUrl} onChange={e=>setGatewayUrl(e.target.value)} placeholder="https://crew.example.com"/></Field>{pair&&remaining>0?<><div className="mt-4 flex items-center gap-3 border border-border bg-surface p-3"><code className="mono flex-1 break-all text-sm">{pair.code}</code><Button variant="ghost" size="icon" onClick={()=>navigator.clipboard.writeText(pair.code)} aria-label="Copy code"><Copy size={15}/></Button></div><div className="mt-2 text-xs text-warning">Expires in {Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</div>{gatewayUrl?<><div className="mt-5 text-xs text-muted">On the remote AX device:</div><pre className="mt-2 overflow-x-auto border border-border bg-surface p-3 text-xs">ax crew pair {pair.code} --gateway {gatewayUrl}{ '\n' }ax crew connect {gatewayUrl}</pre></>:<p className="mt-4 text-xs text-warning">Enter a reachable gateway URL to see the exact pairing commands.</p>}<div className="mt-4 flex items-center gap-2 text-xs text-muted"><Radio size={14}/> Waiting for the device heartbeat. Devices appear automatically after connection.</div></>:<div className="mt-4"><Action run={issue}>Generate new code</Action></div>}</Dialog>
  </div>
}
export function DeviceDetail(){
  const {id=''}=useParams(),devices=useDevices(),tasks=useTasks(),sessions=useSessions(),device=devices.data?.find(d=>d.id===id)
  const settings=useQuery({queryKey:['settings'],queryFn:endpoints.settings}),[cwd,setCwd]=useState(''),[name,setName]=useState(''),[editing,setEditing]=useState(false),[fingerprint,setFingerprint]=useState('')
  useEffect(()=>{if(settings.data&&!cwd)setCwd(settings.data.default_cwd)},[settings.data,cwd])
  useEffect(()=>{if(!device?.public_key){setFingerprint('local device');return}const binary=Uint8Array.from(atob(device.public_key),c=>c.charCodeAt(0));void crypto.subtle.digest('SHA-256',binary).then(hash=>setFingerprint([...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join(':')))},[device?.public_key])
  const catalogCwd=useDebouncedValue(cwd)
  const catalog=useQuery({queryKey:['capabilities',id,catalogCwd],queryFn:()=>endpoints.capabilities(id,catalogCwd),enabled:!!device&&!!catalogCwd&&['online','busy'].includes(device.status),retry:0})
  if(!device)return <div className="page"><Empty title={devices.isPending?'正在加载设备…':devices.isError?'无法加载设备':'设备不存在'}/></div>
  const running=(tasks.data??[]).filter(t=>t.assigned_device===id&&['running','waiting_permission','ready'].includes(t.status))
  return <div className="page"><PageHead eyebrow="Device" title={device.name} description={`${device.hostname} · ${device.platform}/${device.arch}`} actions={<><Status value={device.status}/><Button variant="secondary" onClick={()=>{setName(device.name);setEditing(true)}}>Rename</Button>{id!=='local'&&<Action variant="danger" run={async()=>{if(window.confirm(`Revoke ${device.name}? Active work will fail.`))await api(`/api/devices/${id}/revoke`,'POST',{})}}><Trash2 size={13}/> Revoke</Action>}</>}/>
    <div className="grid gap-5 xl:grid-cols-2"><section className="panel"><div className="panel-header">Identity and connection</div><div className="grid grid-cols-[140px_1fr] gap-y-3 p-4 text-sm">{[['ID',device.id],['Status',device.status],['AX version',device.ax_version],['Protocol',String(device.protocol_version)],['Last seen',time(device.last_seen)],['Fingerprint',fingerprint]].map(([label,value])=><div className="contents" key={label}><span className="text-muted">{label}</span><span className="mono break-all text-xs">{value}</span></div>)}</div></section>
    <section className="panel"><div className="panel-header">Capability catalog</div><div className="p-4"><Field label="Working directory on this device"><Input value={cwd} onChange={e=>setCwd(e.target.value)} placeholder="Absolute path on device"/></Field>{catalog.isLoading?<p className="mt-3 text-xs text-muted">Reading AX catalog…</p>:catalog.error?<p className="mt-3 text-xs text-danger">{String(catalog.error)}</p>:catalog.data?<div className="mt-4 space-y-3 text-xs"><div>Providers: {catalog.data.models.providers.map(p=>p.id).join(', ')||'None configured'}</div><div>Skills: {catalog.data.skills.skills.map(s=>s.name).join(', ')||'None installed'}</div><div>MCP: {catalog.data.mcp.servers.map(s=>s.name).join(', ')||'None configured'}</div></div>:null}</div></section></div>
    <h2 className="section-title">Running tasks</h2><div className="panel">{running.length?running.map(t=><Link key={t.id} to={`/tasks/${t.id}`} className="row justify-between no-underline text-foreground"><span>{t.title}</span><Status value={t.status}/></Link>):<Empty title="No running tasks"/>}</div>
    <h2 className="section-title">Sessions on device</h2><div className="panel">{sessions.data?.filter(s=>s.device_id===id).map(s=><Link key={s.task_id} to={`/sessions/${s.task_id}`} className="row no-underline text-foreground"><span className="flex-1">{tasks.data?.find(t=>t.id===s.task_id)?.title??short(s.ax_session_id)}</span><span className="tiny mono">{short(s.ax_session_id)}</span></Link>)}{!sessions.data?.some(s=>s.device_id===id)&&<Empty title="No sessions bound"/>}</div>
    <Dialog open={editing} onOpenChange={setEditing} title="Rename device"><Field label="Device name"><Input value={name} onChange={e=>setName(e.target.value)}/></Field><div className="mt-5"><Action run={async()=>{await api(`/api/devices/${id}/rename`,'POST',{name});setEditing(false)}} disabled={!name.trim()}>Save name</Action></div></Dialog>
  </div>
}
