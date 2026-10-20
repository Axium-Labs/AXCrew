import { translate, useLang } from '../lib/i18n'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, Plus, Settings2, Users } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Action, Empty, Field, PageHead, Status } from '../components/shared'
import { Select } from '../components/ui/select'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { api, endpoints } from '../lib/api'
import { useCrews, useDevices, useMembers, useTasks } from '../lib/query'
import type { Member } from '../lib/types'
import { SessionThread } from './Sessions'
import './management.css'

const blank=(cwd:string,device='local'):Omit<Member,'id'|'crew_id'>=>({name:'',role:'',device_id:device,cwd,provider:null,model:null,skills:[],mcp_servers:[],permission_profile:'ask',max_concurrency:1})
export function Crews(){
  useLang(state=>state.lang);
const crews=useCrews(),tasks=useTasks(),[params,setParams]=useSearchParams(),[name,setName]=useState(''),open=params.get('create')==='1'
  return <div className="page management-page"><PageHead eyebrow={translate("english.13")} title={translate("english.14")} description={translate("english.15")} actions={<Button onClick={()=>setParams({create:'1'})}><Plus size={14}/> {translate("english.16")}</Button>}/>
    {crews.data?.length?<div className="management-crews-grid">{crews.data.map(c=><Link key={c.id} to={`/crews/${c.id}`} className="management-crew-card"><span className="management-icon"><Users size={19}/></span><div className="management-row-copy"><div className="row-title" title={c.name}>{c.name}</div><div className="row-sub">{tasks.data?.filter(t=>t.crew_id===c.id&&['running','waiting_permission'].includes(t.status)).length??0} {translate("english.17")}</div></div><ArrowUpRight size={15} className="text-muted"/></Link>)}</div>:<div className="panel"><Empty title={translate("english.18")} description={translate("english.19")} icon={<Users size={21} strokeWidth={1.5}/>} action={<Button variant="secondary" onClick={()=>setParams({create:'1'})}><Plus size={14}/>{translate("english.16")}</Button>}/></div>}
    <Dialog open={open} onOpenChange={value=>!value&&setParams({})} title={translate("english.16")}><Field label={translate("english.20")}><Input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder={translate("english.21")}/></Field><div className="mt-5"><Action disabled={!name.trim()} run={async()=>{await api('/api/crews','POST',{name});setName('');setParams({})}}>{translate("english.16")}</Action></div></Dialog></div>}


function MemberEditor({crewId,member,close}:{crewId:string;member?:Member;close:()=>void}){
  useLang(state=>state.lang);

  const devices=useDevices(),settings=useQuery({queryKey:['settings'],queryFn:endpoints.settings}),[form,setForm]=useState<Omit<Member,'id'|'crew_id'>>(member??blank(settings.data?.default_cwd??''))
  useEffect(()=>{if(!member&&settings.data&&!form.cwd)setForm(f=>({...f,cwd:settings.data!.default_cwd}))},[settings.data,member,form.cwd])
  const catalogCwd=useDebouncedValue(form.cwd)
  const catalog=useQuery({queryKey:['capabilities',form.device_id,catalogCwd],queryFn:()=>endpoints.capabilities(form.device_id,catalogCwd),enabled:!!form.device_id&&!!catalogCwd&&devices.data?.find(d=>d.id===form.device_id)?.status!=='offline',retry:0})
  const set=<K extends keyof typeof form>(key:K,value:(typeof form)[K])=>setForm(f=>({...f,[key]:value}))
  const providers=catalog.data?.models.providers??[];const selected=providers.find(p=>p.id===form.provider)
  return <div className="stack"><div className="form-grid"><Field label={translate("english.22")}><Input value={form.name} onChange={e=>set('name',e.target.value)} placeholder={translate("english.23")}/></Field><Field label={translate("english.24")}><Input value={form.role} onChange={e=>set('role',e.target.value)} placeholder={translate("english.25")}/></Field><Field label={translate("english.11")}><Select label={translate("english.11")} value={form.device_id} onChange={v=>{setForm(f=>({...f,device_id:v,provider:null,model:null,skills:[],mcp_servers:[]}))}} options={(devices.data??[]).map(d=>({value:d.id,label:`${d.name} · ${translate('status.'+d.status)}`}))}/></Field><Field label={translate("english.26")}><Input value={form.cwd} onChange={e=>set('cwd',e.target.value)} placeholder={translate("english.27")}/></Field></div>
    {catalog.error&&<div className="text-xs text-danger">{translate("english.28")}{String(catalog.error)}</div>}
    <div className="form-grid"><Field label={translate("english.29")}><Select label={translate("english.29")} value={form.provider??''} onChange={v=>{set('provider',v||null);set('model',null)}} disabled={!catalog.data} options={[{value:'',label:translate("english.30")},...providers.map(p=>({value:p.id,label:p.id}))]}/></Field><Field label={translate("english.31")}><Select label={translate("english.31")} value={form.model??''} onChange={v=>set('model',v||null)} disabled={!catalog.data||!form.provider} options={[{value:'',label:translate("english.30")},...(selected?.models??[]).map(m=>({value:m.id,label:m.display_name||m.id}))]}/></Field></div>
    <div className="form-grid"><Field label={translate("english.32")} hint={translate("english.33")}><div className="max-h-36 overflow-y-auto rounded-[var(--radius-chip)] border border-border p-2">{catalog.data?.skills.skills.map(s=><label className="flex gap-2 py-1 text-xs text-foreground" key={s.name}><input type="checkbox" checked={form.skills.includes(s.name)} onChange={e=>set('skills',e.target.checked?[...form.skills,s.name]:form.skills.filter(n=>n!==s.name))}/><span>{s.name}<span className="ml-1 text-muted">{s.description}</span></span></label>)}{!catalog.data?.skills.skills.length&&<span className="text-xs text-muted">{translate("english.34")}</span>}</div></Field><Field label={translate("english.35")} hint={translate("english.36")}><div className="max-h-36 overflow-y-auto rounded-[var(--radius-chip)] border border-border p-2">{catalog.data?.mcp.servers.filter(s=>s.enabled).map(s=><label className="flex gap-2 py-1 text-xs text-foreground" key={s.name}><input type="checkbox" checked={form.mcp_servers.includes(s.name)} onChange={e=>set('mcp_servers',e.target.checked?[...form.mcp_servers,s.name]:form.mcp_servers.filter(n=>n!==s.name))}/>{s.name}</label>)}{!catalog.data?.mcp.servers.length&&<span className="text-xs text-muted">{translate("english.37")}</span>}</div></Field></div>
    <div className="form-grid"><Field label={translate("english.38")}><Select label={translate("english.38")} value={form.permission_profile} onChange={v=>set('permission_profile',v as Member['permission_profile'])} options={[{value:'ask',label:translate("english.39")},{value:'allow',label:translate("english.40")},{value:'deny',label:translate("english.41")}]}/></Field><Field label={translate("english.42")}><Input type="number" min={1} value={form.max_concurrency} onChange={e=>set('max_concurrency',Number(e.target.value))}/></Field></div>
    <div className="flex justify-end"><Action disabled={!form.name.trim()||!form.cwd.trim()||form.cwd!==catalogCwd||!Number.isInteger(form.max_concurrency)||form.max_concurrency<1||!catalog.data} run={async()=>{await api(member?`/api/crews/${crewId}/members/${member.id}`:`/api/crews/${crewId}/members`,member?'PUT':'POST',form);close()}}>{member?translate('detail.0'):translate('detail.1')}</Action></div>
  </div>
}
export function CrewDetail(){
  useLang(state=>state.lang);
const {id=''}=useParams(),crews=useCrews(),members=useMembers(id),tasks=useTasks(),devices=useDevices(),[editing,setEditing]=useState<Member|'new'|null>(null),crew=crews.data?.find(c=>c.id===id)
  if(!crew)return <div className="page management-page"><Empty title={crews.isPending?translate("copy.136"):crews.isError?translate("copy.137"):translate("copy.138")}/></div>
  return <div className="page management-page"><PageHead eyebrow={translate("english.43")} title={crew.name} description={`${members.data?.length??0} agents · ${(tasks.data??[]).filter(t=>t.crew_id===id).length} tasks`} actions={<><Button variant="secondary" onClick={()=>setEditing('new')}><Plus size={14}/> {translate("english.44")}</Button><Link to={`/tasks?crew=${id}`}><Button>{translate("english.45")}</Button></Link></>}/>
    <h2 className="section-title">{translate("english.46")}</h2><div className="panel">{members.data?.map(m=>{const active=tasks.data?.find(t=>t.assigned_member===m.id&&['running','waiting_permission','ready'].includes(t.status)),device=devices.data?.find(d=>d.id===m.device_id);return <div className="row" key={m.id}><Link to={`/crews/${id}/members/${m.id}`} className="flex min-w-0 flex-1 items-center gap-4 no-underline text-foreground"><Status value={active?.status??device?.status??'offline'}/><div className="min-w-0"><div className="row-title">{m.name}<span className="ml-2 font-normal text-muted">{m.role}</span></div><div className="row-sub">{device?.name??m.device_id} · {m.provider??'AX default'} / {m.model??'default'}{active&&` · ${active.title}`}</div></div></Link><Button variant="ghost" size="icon" onClick={()=>setEditing(m)} aria-label={`Edit ${m.name}`}><Settings2 size={15}/></Button><Link to={`/crews/${id}/members/${m.id}`} className="link"><ArrowUpRight size={15}/></Link></div>})}{!members.data?.length&&<Empty title={translate("english.47")} description={translate("english.48")} action={<Button onClick={()=>setEditing('new')}>{translate("english.44")}</Button>}/>}</div>
    <h2 className="section-title">{translate("english.49")}</h2><div className="panel">{tasks.data?.filter(t=>t.crew_id===id).slice(-12).reverse().map(t=><Link key={t.id} to={`/tasks/${t.id}`} className="row justify-between no-underline text-foreground"><span className="min-w-0 flex-1 truncate" title={t.title}>{t.title}</span><Status value={t.status}/></Link>)}{!tasks.data?.some(t=>t.crew_id===id)&&<Empty title={translate("english.50")}/>}</div>
    <Dialog open={!!editing} onOpenChange={v=>!v&&setEditing(null)} title={editing==='new'?translate('detail.2'):translate('detail.3')} wide>{editing&&<MemberEditor key={editing==='new'?'new':editing.id} crewId={id} member={editing==='new'?undefined:editing} close={()=>setEditing(null)}/>}</Dialog>
  </div>
}
export function MemberWorkspace(){
  useLang(state=>state.lang);
const {id='',memberId=''}=useParams(),members=useMembers(id),tasks=useTasks(),navigate=useNavigate(),member=members.data?.find(m=>m.id===memberId),related=(tasks.data??[]).filter(t=>t.assigned_member===memberId).reverse(),[selected,setSelected]=useState('')
  useEffect(()=>{if(!related.some(task=>task.id===selected))setSelected(related[0]?.id??'')},[selected,related])
  if(!member)return <div className="page management-page"><Empty title={members.isPending?translate("copy.139"):members.isError?translate("copy.140"):translate("copy.141")}/></div>
  return <div className="page management-page"><PageHead eyebrow={translate("english.51")} title={member.name} description={`${member.role} · ${member.device_id} · ${member.model??'AX default'}`} actions={<Button variant="secondary" onClick={()=>navigate(`/crews/${id}`)}>{translate("english.52")}</Button>}/><div className="management-member-layout"><aside className="panel"><div className="panel-header">{translate("english.53")}</div>{related.map(t=><button key={t.id} onClick={()=>setSelected(t.id)} className="row" aria-pressed={selected===t.id}><div className="min-w-0 flex-1"><div className="row-title truncate">{t.title}</div><Status value={t.status}/></div></button>)}{!related.length&&<Empty title={translate("english.54")}/>}</aside><section className="panel min-w-0">{selected?<SessionThread taskId={selected}/>:<Empty title={translate("english.55")} description={translate("english.56")}/>}</section></div></div>
}
