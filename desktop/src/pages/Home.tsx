import { translate, useLang } from '../lib/i18n'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, ShieldAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Action, Empty, PageHead, Status } from '../components/shared'
import { api, endpoints } from '../lib/api'
import { useAllMembers, useDevices, usePermissions, useTasks } from '../lib/query'
import { useLive } from '../lib/live'
import type { CrewEvent } from '../lib/types'
import { readable, time } from '../lib/utils'

function EventRow({event}:{event:CrewEvent}){
  useLang(state=>state.lang);
return <div className="event"><span className="tiny mono">{time(event.timestamp)}</span><span>{readable(event.kind)}</span><span className="truncate text-muted">{event.task_id?<Link className="link" to={`/tasks/${event.task_id}`}>{event.task_id.slice(0,8)}</Link>:event.device_id?<Link className="link" to={`/devices/${event.device_id}`}>{event.device_id}</Link>:'System'}</span></div>}
export function Home(){
  useLang(state=>state.lang);

  const tasks=useTasks(),devices=useDevices(),members=useAllMembers(),permissions=usePermissions(),recent=useQuery({queryKey:['events',0],queryFn:()=>endpoints.events(0,30)}),live=useLive(s=>s.events),[params]=useSearchParams()
  const active=(tasks.data??[]).filter(t=>['running','waiting_permission','ready'].includes(t.status))
  const events=[...live,...(recent.data??[])].filter((e,i,a)=>a.findIndex(x=>x.event_id===e.event_id)===i).slice(0,30)
  return <div className="page"><PageHead eyebrow={translate("english.90")} title={translate("english.91")} description={translate("english.92")} actions={<Link to="/activity" className="link flex items-center gap-1 text-sm">{translate("english.1")}<ArrowUpRight size={13}/></Link>}/>
    {!!permissions.data?.length&&<section className="panel mb-5 border-warning/50"><div className="panel-header flex items-center gap-2 text-warning"><ShieldAlert size={14}/> {translate("english.93")}{permissions.data.length}</div><div>{permissions.data.map(p=><div key={p.request_id} className="row"><div className="min-w-0 flex-1"><div className="row-title">{p.request.toolCall.title}</div><div className="row-sub mono truncate">{JSON.stringify(p.request.toolCall.rawInput)}</div></div><Action run={()=>api(`/api/permissions/${p.request_id}/resolve`,'POST',{option_id:'reject_once'})} variant="danger">{translate("english.41")}</Action><Action run={()=>api(`/api/permissions/${p.request_id}/resolve`,'POST',{option_id:'allow_once'})}>{translate("english.94")}</Action></div>)}</div></section>}
    <div className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]"><div><h2 className="section-title">{translate("english.95")}</h2><div className="panel">{active.length?active.map(t=><Link to={`/tasks/${t.id}`} className="row no-underline text-foreground" key={t.id}><Status value={t.status}/><div className="min-w-0 flex-1"><div className="row-title truncate">{t.title}</div><div className="row-sub">{members.data?.find(m=>m.id===t.assigned_member)?.name??t.assigned_member.slice(0,8)} · {devices.data?.find(d=>d.id===t.assigned_device)?.name??t.assigned_device}</div></div><ArrowUpRight size={14} className="text-muted"/></Link>):<Empty title={translate("english.96")} description={translate("english.97")} action={<Link className="link" to="/tasks?create=1">{translate("english.98")}</Link>}/>}</div>
      <h2 className="section-title">{translate("english.99")}</h2><div className="panel">{events.length?events.slice(0,12).map(e=><EventRow key={e.event_id} event={e}/>):<Empty title={translate("english.100")}/>}</div></div>
      <div><h2 className="section-title">{translate("english.101")}</h2><div className="panel">{(devices.data??[]).filter(d=>['online','busy'].includes(d.status)).map(d=><Link to={`/devices/${d.id}`} className="row justify-between no-underline text-foreground" key={d.id}><div><div className="row-title">{d.name}</div><div className="row-sub">{d.hostname} · {d.platform}</div></div><Status value={d.status}/></Link>)}{!devices.data?.some(d=>['online','busy'].includes(d.status))&&<Empty title={translate("english.102")}/>}</div><h2 className="section-title">{translate("english.103")}</h2><div className="panel p-4 text-sm">{permissions.data?.length?<a href="#permissions" className="text-warning">{permissions.data.length} {translate("english.104")}</a>:<span className="text-muted">{translate("english.105")}</span>}</div>{params.get('permissions')&&<p className="mt-2 text-xs text-muted">{translate("english.106")}</p>}</div></div>
  </div>
}
