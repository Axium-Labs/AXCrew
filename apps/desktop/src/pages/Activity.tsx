import { translate, useLang } from '../lib/i18n'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowUpRight } from 'lucide-react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Virtuoso } from 'react-virtuoso'
import { Empty, PageHead } from '../components/shared'
import { Select } from '../components/ui/select'
import { endpoints } from '../lib/api'
import { useLive } from '../lib/live'
import { useAllMembers, useCrews, useDevices, useTasks } from '../lib/query'
import type { CrewEvent } from '../lib/types'
import { readable, short, time } from '../lib/utils'
import { useUi } from '../store/ui'
import './management.css'

export function ActivityPage() {
  useLang(state => state.lang)
  const live = useLive(s => s.events), crews = useCrews(), devices = useDevices(), members = useAllMembers(), tasks = useTasks(), developer = useUi(s => s.developer)
  const [crew, setCrew] = useState(''), [device, setDevice] = useState(''), [member, setMember] = useState(''), [task, setTask] = useState(''), [kind, setKind] = useState('')
  const history = useInfiniteQuery({ queryKey: ['eventHistory'], queryFn: ({ pageParam }) => endpoints.events(pageParam, 100), initialPageParam: 0, getNextPageParam: (last, pages) => last.length === 100 ? pages.length * 100 : undefined })
  const events = useMemo(() => {
    const all = [...live, ...(history.data?.pages.flat() ?? [])], unique = new Set<string>()
    return all.filter(e => {
      if (unique.has(e.event_id)) return false
      unique.add(e.event_id)
      return (!crew || e.crew_id === crew) && (!device || e.device_id === device) && (!member || e.member_id === member) && (!task || e.task_id === task) && (!kind || e.kind === kind)
    }).sort((a, b) => b.timestamp - a.timestamp)
  }, [live, history.data, crew, device, member, task, kind])
  const types = [...new Set([...live, ...(history.data?.pages.flat() ?? [])].map(e => e.kind))].sort()
  return <div className="page management-page">
    <PageHead eyebrow={translate('english.0')} title={translate('english.1')} description={translate('english.2')} />
    <div className="management-filters is-activity">
      <Select label={translate('english.3')} value={crew} onChange={setCrew} options={[{ value: '', label: translate('english.3') }, ...(crews.data ?? []).map(c => ({ value: c.id, label: c.name }))]} />
      <Select label={translate('english.4')} value={device} onChange={setDevice} options={[{ value: '', label: translate('english.4') }, ...(devices.data ?? []).map(d => ({ value: d.id, label: d.name }))]} />
      <Select label={translate('english.5')} value={member} onChange={setMember} options={[{ value: '', label: translate('english.5') }, ...(members.data ?? []).map(m => ({ value: m.id, label: m.name }))]} />
      <Select label={translate('english.6')} value={task} onChange={setTask} options={[{ value: '', label: translate('english.6') }, ...(tasks.data ?? []).map(t => ({ value: t.id, label: t.title }))]} />
      <Select label={translate('english.7')} value={kind} onChange={setKind} options={[{ value: '', label: translate('english.7') }, ...types.map(value => ({ value, label: readable(value) }))]} />
    </div>
    <section className="panel management-activity-panel"><div className="panel-header"><Activity size={15} /><span>{translate('english.8')}{events.length} {translate('english.9')}</span><span className="management-panel-meta">{developer ? translate('detail.10') : translate('detail.11')}</span></div>
      <div className="management-activity-list"><Virtuoso data={events} components={{ EmptyPlaceholder: () => <Empty title={translate('english.100')} /> }} endReached={() => { if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage() }} itemContent={(_, e) => <EventLine event={e} developer={developer} name={tasks.data?.find(t => t.id === e.task_id)?.title ?? devices.data?.find(d => d.id === e.device_id)?.name} />} /></div>
    </section>
  </div>
}

function EventLine({ event: e, developer, name }: { event: CrewEvent; developer: boolean; name?: string }) {
  useLang(state => state.lang)
  return <div className="management-activity-row"><div className="management-event">
    <span className="management-timeline-dot" aria-hidden="true" />
    <div className="management-event-copy"><span>{readable(e.kind)}</span><span className="row-sub truncate" title={name ?? e.task_id ?? e.device_id ?? ''}>{name ?? e.task_id ?? e.device_id ?? translate('detail.6')}</span></div>
    <span className="management-event-time mono">{time(e.timestamp)}</span>
    {e.task_id ? <Link className="management-event-link" to={`/tasks/${e.task_id}`} title={`${translate('english.10')}${short(e.task_id)}`} aria-label={`${translate('english.10')}${short(e.task_id)}`}><ArrowUpRight size={15} /></Link> : e.device_id ? <Link className="management-event-link" to={`/devices/${e.device_id}`} title={translate('english.11')} aria-label={translate('english.11')}><ArrowUpRight size={15} /></Link> : <span />}
  </div>{developer && <pre className="management-event-json">{JSON.stringify(e, null, 2)}</pre>}</div>
}
