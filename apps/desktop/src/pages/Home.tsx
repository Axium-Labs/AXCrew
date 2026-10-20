import { translate, useLang } from '../lib/i18n'
import { Link, useSearchParams } from 'react-router-dom'
import { Activity, ArrowUpRight, CheckCheck, ListTodo, Monitor, ShieldAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Action, Empty, PageHead, Status } from '../components/shared'
import { api, endpoints } from '../lib/api'
import { useAllMembers, useDevices, usePermissions, useTasks } from '../lib/query'
import { useLive } from '../lib/live'
import type { CrewEvent } from '../lib/types'
import { readable, time } from '../lib/utils'
import './management.css'

function EventRow({ event }: { event: CrewEvent }) {
  useLang(state => state.lang)
  return <div className="management-event">
    <span className="management-timeline-dot" aria-hidden="true" />
    <div className="management-event-copy"><span>{readable(event.kind)}</span><span className="row-sub">{event.task_id ? <Link className="link" to={`/tasks/${event.task_id}`}>{event.task_id.slice(0, 8)}</Link> : event.device_id ? <Link className="link" to={`/devices/${event.device_id}`}>{event.device_id}</Link> : translate('detail.6')}</span></div>
    <span className="management-event-time mono">{time(event.timestamp)}</span>
  </div>
}

export function Home() {
  useLang(state => state.lang)
  const tasks = useTasks(), devices = useDevices(), members = useAllMembers(), permissions = usePermissions()
  const recent = useQuery({ queryKey: ['events', 0], queryFn: () => endpoints.events(0, 30) })
  const live = useLive(s => s.events), [params] = useSearchParams()
  const active = (tasks.data ?? []).filter(t => ['running', 'waiting_permission', 'ready'].includes(t.status))
  const online = (devices.data ?? []).filter(d => ['online', 'busy'].includes(d.status))
  const events = [...live, ...(recent.data ?? [])].filter((e, i, a) => a.findIndex(x => x.event_id === e.event_id) === i).slice(0, 30)
  return <div className="page management-page">
    <PageHead eyebrow={translate('english.90')} title={translate('english.91')} description={translate('english.92')} actions={<Link to="/activity" className="management-text-action">{translate('english.1')}<ArrowUpRight size={14} /></Link>} />
    <div className="management-metrics">
      <Link className="management-metric" to="/tasks"><span className="management-icon"><ListTodo size={18} /></span><span><span className="management-metric-label">{translate('english.95')}</span><strong>{tasks.data ? active.length : '—'}</strong></span><ArrowUpRight size={14} className="management-metric-arrow" /></Link>
      <Link className="management-metric" to="/devices"><span className="management-icon"><Monitor size={18} /></span><span><span className="management-metric-label">{translate('english.101')}</span><strong>{devices.data ? online.length : '—'}</strong></span><ArrowUpRight size={14} className="management-metric-arrow" /></Link>
      <a className="management-metric" href="#permissions" onClick={event=>{event.preventDefault();document.getElementById('permissions')?.scrollIntoView({block:'nearest'})}}><span className="management-icon"><ShieldAlert size={18} /></span><span><span className="management-metric-label">{translate('english.103')}</span><strong>{permissions.data ? permissions.data.length : '—'}</strong></span><ArrowUpRight size={14} className="management-metric-arrow" /></a>
    </div>
    {!!permissions.data?.length && <section id="permissions" className="panel management-permissions">
      <div className="panel-header"><ShieldAlert size={15} />{translate('english.93')}<span className="management-count">{permissions.data.length}</span></div>
      {permissions.data.map(p => <div key={p.request_id} className="row management-permission-row"><div className="management-row-copy"><div className="row-title">{p.request.toolCall.title}</div><div className="row-sub mono truncate" title={JSON.stringify(p.request.toolCall.rawInput)}>{JSON.stringify(p.request.toolCall.rawInput)}</div></div><div className="management-row-actions"><Action run={() => api(`/api/permissions/${p.request_id}/resolve`, 'POST', { option_id: 'reject_once' })} variant="danger">{translate('english.41')}</Action><Action run={() => api(`/api/permissions/${p.request_id}/resolve`, 'POST', { option_id: 'allow_once' })}>{translate('english.94')}</Action></div></div>)}
    </section>}
    <div className="management-overview-grid">
      <div className="management-column">
        <section className="panel"><div className="panel-header"><ListTodo size={15} />{translate('english.95')}<span className="management-count">{active.length}</span></div>
          {active.length ? active.map(t => <Link to={`/tasks/${t.id}`} className="row no-underline text-foreground" key={t.id}><div className="management-row-copy"><div className="row-title truncate" title={t.title}>{t.title}</div><div className="row-sub">{members.data?.find(m => m.id === t.assigned_member)?.name ?? t.assigned_member.slice(0, 8)} · {devices.data?.find(d => d.id === t.assigned_device)?.name ?? t.assigned_device}</div></div><Status value={t.status} /><ArrowUpRight size={14} className="text-muted" /></Link>) : <Empty title={translate('english.96')} description={translate('english.97')} action={<Link className="management-text-action" to="/tasks?create=1">{translate('english.98')}<ArrowUpRight size={13} /></Link>} />}
        </section>
        <section className="panel"><div className="panel-header"><Activity size={15} />{translate('english.99')}<Link to="/activity" className="management-header-action" aria-label={translate('english.1')}><ArrowUpRight size={15} /></Link></div>{events.length ? events.slice(0, 12).map(e => <EventRow key={e.event_id} event={e} />) : <Empty title={translate('english.100')} />}</section>
      </div>
      <div className="management-column">
        <section className="panel"><div className="panel-header"><Monitor size={15} />{translate('english.101')}<span className="management-count">{online.length}</span></div>{online.map(d => <Link to={`/devices/${d.id}`} className="row no-underline text-foreground" key={d.id}><span className="management-icon is-small"><Monitor size={16} /></span><div className="management-row-copy"><div className="row-title">{d.name}</div><div className="row-sub">{d.hostname} · {d.platform}</div></div><Status value={d.status} /></Link>)}{!online.length && <Empty title={translate('english.102')} />}</section>
        {!permissions.data?.length && <section id="permissions" className="panel management-quiet-card"><span className="management-icon"><CheckCheck size={18} /></span><div><h2>{translate('english.103')}</h2><p>{translate('english.105')}</p></div></section>}
        {params.get('permissions') && <p className="management-note">{translate('english.106')}</p>}
      </div>
    </div>
  </div>
}
