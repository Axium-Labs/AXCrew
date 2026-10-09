import { translate, useLang } from '../lib/i18n'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Virtuoso } from 'react-virtuoso'
import { PageHead, Select } from '../components/shared'
import { endpoints } from '../lib/api'
import { useLive } from '../lib/live'
import { useAllMembers, useCrews, useDevices, useTasks } from '../lib/query'
import type { CrewEvent } from '../lib/types'
import { readable,short,time } from '../lib/utils'
import { useUi } from '../store/ui'

export function ActivityPage(){
  useLang(state=>state.lang);

  const live=useLive(s=>s.events),crews=useCrews(),devices=useDevices(),members=useAllMembers(),tasks=useTasks(),developer=useUi(s=>s.developer)
  const [crew,setCrew]=useState(''),[device,setDevice]=useState(''),[member,setMember]=useState(''),[task,setTask]=useState(''),[kind,setKind]=useState('')
  const history=useInfiniteQuery({queryKey:['eventHistory'],queryFn:({pageParam})=>endpoints.events(pageParam,100),initialPageParam:0,getNextPageParam:(last,pages)=>last.length===100?pages.length*100:undefined})
  const events=useMemo(()=>{const all=[...live,...(history.data?.pages.flat()??[])];const unique=new Set<string>();return all.filter(e=>{if(unique.has(e.event_id))return false;unique.add(e.event_id);return (!crew||e.crew_id===crew)&&(!device||e.device_id===device)&&(!member||e.member_id===member)&&(!task||e.task_id===task)&&(!kind||e.kind===kind)}).sort((a,b)=>b.timestamp-a.timestamp)},[live,history.data,crew,device,member,task,kind])
  const types=[...new Set([...live,...(history.data?.pages.flat()??[])].map(e=>e.kind))].sort()
  return <div className="page"><PageHead eyebrow={translate("english.0")} title={translate("english.1")} description={translate("english.2")}/><div className="mb-4 grid grid-cols-5 gap-2"><Select value={crew} onChange={setCrew}><option value="">{translate("english.3")}</option>{crews.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select><Select value={device} onChange={setDevice}><option value="">{translate("english.4")}</option>{devices.data?.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</Select><Select value={member} onChange={setMember}><option value="">{translate("english.5")}</option>{members.data?.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</Select><Select value={task} onChange={setTask}><option value="">{translate("english.6")}</option>{tasks.data?.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</Select><Select value={kind} onChange={setKind}><option value="">{translate("english.7")}</option>{types.map(t=><option key={t}>{t}</option>)}</Select></div>
    <div className="panel"><div className="panel-header flex justify-between"><span>{translate("english.8")}{events.length} {translate("english.9")}</span><span className="font-normal text-muted">{developer?translate('detail.10'):translate('detail.11')}</span></div><div style={{height:'calc(100vh - 280px)',minHeight:350}}><Virtuoso data={events} endReached={()=>{if(history.hasNextPage&&!history.isFetchingNextPage)void history.fetchNextPage()}} itemContent={(_,e)=><EventLine event={e} developer={developer} name={tasks.data?.find(t=>t.id===e.task_id)?.title??devices.data?.find(d=>d.id===e.device_id)?.name}/>}/></div></div>
  </div>
}
function EventLine({event:e,developer,name}:{event:CrewEvent;developer:boolean;name?:string}){
  useLang(state=>state.lang);
return <div className="border-b border-border px-3 py-2 text-xs"><div className="grid grid-cols-[140px_190px_1fr_95px] items-center gap-3"><span className="mono text-muted">{time(e.timestamp)}</span><span>{readable(e.kind)}</span><span className="truncate text-muted">{name??e.task_id??e.device_id??translate('detail.6')}</span>{e.task_id?<Link className="link text-right" to={`/tasks/${e.task_id}`}>{translate("english.10")}{short(e.task_id)}</Link>:e.device_id?<Link className="link text-right" to={`/devices/${e.device_id}`}>{translate("english.11")}</Link>:<span/>}</div>{developer&&<pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-[var(--radius-chip)] border border-border bg-surface p-2 text-[11px] text-muted">{JSON.stringify(e,null,2)}</pre>}</div>}
