import { translate, useLang } from '../lib/i18n'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays, ChevronDown, ChevronRight, Clock, Clock3, FolderPlus, List,
  Moon, MoreHorizontal, Play, Plus, Repeat, Rocket, Search, Sunrise, Timer, TriangleAlert, Trash2,
} from 'lucide-react'
import { Action, Field, PageHead, Select } from '../components/shared'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import { Input, Textarea } from '../components/ui/input'
import { Menu } from '../components/ui/menu'
import { api } from '../lib/api'
import { useAllMembers, useAutomationRuns, useAutomations } from '../lib/query'
import type { Automation, AutomationRun } from '../lib/types'
import './schedule.css'

const WEEKDAYS = () => [translate("copy.145"), translate("copy.146"), translate("copy.147"), translate("copy.148"), translate("copy.149"), translate("copy.150"), translate("copy.151")]
const FOLDER_KEY = 'ax-crew.schedule.folders'
type View = 'list' | 'calendar' | 'runs'
type Draft = {
  name: string; message: string; schedule_kind: Automation['schedule_kind']
  interval_value: number; interval_unit: 'minutes' | 'hours' | 'days'
  daily_time: string; weekdays: number[]
  member_id: string; model: string; approval: Automation['approval']
  silent: boolean; strict_schedule: boolean; hide_from_chat: boolean; lean_context: boolean
  folder: string
}
type Template = { name: string; description: string; schedule: string; draft: Partial<Draft> }
const TEMPLATES = (): Template[] => [
  { name: translate("copy.152"), description: translate("copy.153"), schedule: translate("copy.154"), draft: { name: translate("copy.152"), message: translate("copy.155"), schedule_kind: 'daily', daily_time: '02:00' } },
  { name: translate("copy.156"), description: translate("copy.157"), schedule: translate("copy.158"), draft: { name: translate("copy.156"), message: translate("copy.159"), schedule_kind: 'interval', interval_value: 6, interval_unit: 'hours' } },
  { name: translate("copy.160"), description: translate("copy.161"), schedule: translate("copy.162"), draft: { name: translate("copy.160"), message: translate("copy.163"), schedule_kind: 'weekly', daily_time: '08:45', weekdays: [1, 2, 3, 4, 5] } },
  { name: translate("copy.164"), description: translate("copy.165"), schedule: translate("copy.166"), draft: { name: translate("copy.164"), message: translate("copy.167"), schedule_kind: 'interval', interval_value: 30, interval_unit: 'minutes' } },
  { name: translate("copy.168"), description: translate("copy.169"), schedule: translate("copy.170"), draft: { name: translate("copy.168"), message: translate("copy.171"), schedule_kind: 'daily', daily_time: '09:00' } },
  { name: translate("copy.172"), description: translate("copy.173"), schedule: translate("copy.174"), draft: { name: translate("copy.172"), message: translate("copy.175"), schedule_kind: 'weekly', daily_time: '23:00', weekdays: [7], hide_from_chat: true, silent: true } },
  { name: translate("copy.176"), description: translate("copy.177"), schedule: translate("copy.178"), draft: { name: translate("copy.176"), message: translate("copy.179"), schedule_kind: 'interval', interval_value: 1, interval_unit: 'hours' } },
  { name: translate("copy.180"), description: translate("copy.181"), schedule: translate("copy.182"), draft: { name: translate("copy.180"), message: translate("copy.183"), schedule_kind: 'weekly', daily_time: '18:30', weekdays: [1, 2, 3, 4, 5] } },
]
const TEMPLATE_ICONS = [Moon, TriangleAlert, Sunrise, Rocket]

function timezoneLabel() {
  const offset = -new Date().getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  const hours = Math.floor(Math.abs(offset) / 60), minutes = Math.abs(offset) % 60
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local'
  return `${zone} (UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''})`
}
function scheduleLabel(item: Automation) {
  if (item.schedule_kind === 'interval') {
    const minutes = Math.max(1, item.interval_minutes)
    if (minutes % 1440 === 0) return translate("copy.184", {v0:minutes / 1440})
    if (minutes % 60 === 0) return translate("copy.185", {v0:minutes / 60})
    return translate("copy.186", {v0:minutes})
  }
  const days = item.weekdays.split(',').filter(Boolean).map(Number)
  const weekday = days.length === 5 && days.every(day => day <= 5) ? translate("copy.187") : days.length ? translate("copy.188", {v0:days.map(day => WEEKDAYS()[day - 1] ?? '').join('、')}) : translate("copy.189")
  return translate("copy.190", {v0:item.schedule_kind === 'daily' ? '每日' : weekday,v1:item.daily_time})
}
function relative(epoch?: number | null) {
  if (!epoch) return '—'
  const diff = epoch - Date.now() / 1000
  const minutes = Math.round(Math.abs(diff) / 60)
  const text = minutes < 1 ? translate("copy.191") : minutes < 60 ? translate("copy.192", {v0:minutes}) : minutes < 1440 ? translate("copy.193", {v0:Math.floor(minutes / 60),v1:minutes % 60}) : translate("copy.194", {v0:Math.round(minutes / 1440)})
  return diff > 0 ? translate("copy.195", {v0:text}) : translate("copy.196", {v0:text})
}
function stamp(epoch?: number | null) {
  return epoch ? new Date(epoch * 1000).toLocaleString(useLang.getState().lang==='en'?'en-US':'zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
}
function emptyDraft(): Draft {
  return { name: '', message: '', schedule_kind: 'interval', interval_value: 1, interval_unit: 'hours', daily_time: '09:00', weekdays: [1, 2, 3, 4, 5], member_id: '', model: '', approval: 'default', silent: false, strict_schedule: false, hide_from_chat: false, lean_context: false, folder: '' }
}
function toDraft(item: Automation): Draft {
  const minutes = item.interval_minutes
  const unit: Draft['interval_unit'] = minutes % 1440 === 0 ? 'days' : minutes % 60 === 0 ? 'hours' : 'minutes'
  const value = unit === 'days' ? minutes / 1440 : unit === 'hours' ? minutes / 60 : minutes
  return { name: item.name, message: item.message, schedule_kind: item.schedule_kind, interval_value: value, interval_unit: unit, daily_time: item.daily_time, weekdays: item.weekdays.split(',').filter(Boolean).map(Number), member_id: item.member_id ?? '', model: item.model ?? '', approval: item.approval, silent: item.silent, strict_schedule: item.strict_schedule, hide_from_chat: item.hide_from_chat, lean_context: item.lean_context, folder: item.folder ?? '' }
}
function toBody(draft: Draft) {
  const interval = draft.interval_unit === 'minutes' ? draft.interval_value : draft.interval_unit === 'hours' ? draft.interval_value * 60 : draft.interval_value * 1440
  return {
    name: draft.name.trim(), message: draft.message.trim(), schedule_kind: draft.schedule_kind,
    interval_minutes: Math.max(1, Math.round(interval)), daily_time: draft.daily_time,
    weekdays: draft.schedule_kind === 'weekly' ? [...draft.weekdays].sort((a, b) => a - b).join(',') : '',
    utc_offset_minutes: -new Date().getTimezoneOffset(),
    member_id: draft.member_id || null, model: draft.model || null, approval: draft.approval,
    silent: draft.silent, strict_schedule: draft.strict_schedule, hide_from_chat: draft.hide_from_chat, lean_context: draft.lean_context,
    folder: draft.folder || null, enabled: true,
  }
}
function loadFolders() {
  try { const value = JSON.parse(localStorage.getItem(FOLDER_KEY) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] } catch { return [] }
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  useLang(state=>state.lang);

  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`schedule-switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}><span/></button>
}
function ScheduleField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  useLang(state=>state.lang);

  return <div className="schedule-field"><span className="schedule-field-title">{label}</span>{hint && <span className="schedule-field-hint">{hint}</span>}{children}</div>
}
function ScheduleEditor({ automation, initial, folders, onFolders, close }: { automation?: Automation; initial?: Draft; folders: string[]; onFolders: (folders: string[]) => void; close: () => void }) {
  useLang(state=>state.lang);

  const members = useAllMembers()
  const [draft, setDraft] = useState<Draft>(() => automation ? toDraft(automation) : initial ?? emptyDraft())
  const [error, setError] = useState('')
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }))
  const save = async () => {
    if (!draft.name.trim() || !draft.message.trim()) { setError(translate("copy.197")); return }
    if (draft.schedule_kind === 'weekly' && !draft.weekdays.length) { setError(translate("copy.198")); return }
    const body = toBody(draft)
    await api(automation ? `/api/automations/${automation.id}` : '/api/automations', automation ? 'PUT' : 'POST', body)
    if (draft.folder && !folders.includes(draft.folder)) onFolders([...folders, draft.folder])
    close()
  }
  return <div className="stack schedule-form">
    <ScheduleField label={translate("copy.199")} hint={translate("copy.200")}><Input value={draft.name} onChange={event => set('name', event.target.value)} placeholder={translate("copy.201")}/></ScheduleField>
    <ScheduleField label={translate("copy.202")} hint={translate("copy.203")}><Textarea rows={4} value={draft.message} onChange={event => set('message', event.target.value)} placeholder={translate("copy.204")}/></ScheduleField>
    <div className="schedule-field">
      <span className="schedule-field-title">{translate("copy.205")}</span>
      <span className="schedule-field-hint">{translate("copy.206")}</span>
      <div className="schedule-plan">
        <Select value={draft.schedule_kind} onChange={value => set('schedule_kind', value as Draft['schedule_kind'])}>
          <option value="interval">{translate("copy.207")}</option><option value="daily">{translate("copy.208")}</option><option value="weekly">{translate("copy.189")}</option>
        </Select>
        {draft.schedule_kind === 'interval' ? <>
          <Input type="number" min={1} aria-label={translate("copy.209")} value={draft.interval_value} onChange={event => set('interval_value', Math.max(1, Number(event.target.value) || 1))}/>
          <Select value={draft.interval_unit} onChange={value => set('interval_unit', value as Draft['interval_unit'])}>
            <option value="minutes">{translate("copy.210")}</option><option value="hours">{translate("copy.211")}</option><option value="days">{translate("copy.212")}</option>
          </Select>
        </> : <>
          <Input type="time" aria-label={translate("copy.213")} value={draft.daily_time} onChange={event => set('daily_time', event.target.value || '09:00')}/>
          {draft.schedule_kind === 'weekly' && <div className="schedule-weekdays" role="group" aria-label={translate("copy.214")}>{WEEKDAYS().map((label, index) => <button key={label} type="button" aria-pressed={draft.weekdays.includes(index + 1)} className={draft.weekdays.includes(index + 1) ? 'is-on' : ''} onClick={() => set('weekdays', draft.weekdays.includes(index + 1) ? draft.weekdays.filter(day => day !== index + 1) : [...draft.weekdays, index + 1])}>{label}</button>)}</div>}
        </>}
      </div>
    </div>
    <ScheduleField label={translate("copy.215")} hint={translate("copy.216")}>
      <Select value={draft.member_id} onChange={value => set('member_id', value)}>
        <option value="">{translate("copy.217")}</option>
        {(members.data ?? []).map(member => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}
      </Select>
    </ScheduleField>
    <ScheduleField label={translate("copy.218")} hint={translate("copy.219")}>
      <Select value={draft.model} onChange={value => set('model', value)}><option value="">{translate("copy.220")}</option>{draft.model && <option value={draft.model}>{draft.model}</option>}</Select>
    </ScheduleField>
    <ScheduleField label={translate("copy.221")} hint={translate("copy.222")}>
      <Select value={draft.approval} onChange={value => set('approval', value as Draft['approval'])}>
        <option value="default">{translate("copy.223")}</option><option value="auto">{translate("copy.224")}</option><option value="ask">{translate("copy.225")}</option>
      </Select>
    </ScheduleField>
    <div className="schedule-toggles">
      <div><strong>{translate("copy.226")}</strong><span>{translate("copy.227")}</span></div><Switch label={translate("copy.226")} checked={draft.silent} onChange={value => set('silent', value)}/>
      <div><strong>{translate("copy.228")}</strong><span>{translate("copy.229")}</span></div><Switch label={translate("copy.228")} checked={draft.strict_schedule} onChange={value => set('strict_schedule', value)}/>
      <div><strong>{translate("copy.230")}</strong><span>{translate("copy.231")}</span></div><Switch label={translate("copy.230")} checked={draft.hide_from_chat} onChange={value => set('hide_from_chat', value)}/>
    </div>
    <ScheduleField label={translate("copy.232")} hint={translate("copy.233")}>
      <Select value={draft.folder} onChange={value => set('folder', value)}><option value="">{translate("copy.234")}</option>{folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</Select>
    </ScheduleField>
    <p className="schedule-field-hint">{folders.length ? translate("copy.235") : translate("copy.236")}</p>
    <div className="schedule-toggles">
      <div><strong>{translate("copy.237")}</strong><span>{translate("copy.238")}</span></div><Switch label={translate("copy.237")} checked={draft.lean_context} onChange={value => set('lean_context', value)}/>
    </div>
    {error && <p className="goal-problem" role="alert">{error}</p>}
    <div className="schedule-form-actions"><Button variant="secondary" onClick={close}>{translate("copy.239")}</Button><Action variant="default" run={save}><Plus size={14}/> {automation ? translate("copy.240") : translate("copy.241")}</Action></div>
  </div>
}
function CalendarView({ automations }: { automations: Automation[] }) {
  useLang(state=>state.lang);

  const days = useMemo(() => {
    const now = new Date()
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
    return Array.from({ length: 7 }, (_, index) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index))
  }, [])
  const dots = useMemo(() => {
    const grid: { day: number; hour: number; minute: number }[] = []
    for (const item of automations) {
      if (!item.enabled) continue
      if (item.schedule_kind === 'interval') {
        const step = Math.max(1, item.interval_minutes)
        const effective = step < 60 ? Math.ceil(1440 / 12) : step
        const anchor = (item.next_run_at ?? item.created_at) + item.utc_offset_minutes * 60
        const phase = ((anchor % 86400) % (effective * 60) + effective * 60) % (effective * 60)
        for (let day = 0; day < 7; day++) for (let second = phase; second < 86400; second += effective * 60) grid.push({ day, hour: Math.floor(second / 3600), minute: Math.floor((second % 3600) / 60) })
      } else {
        const [hour, minute] = item.daily_time.split(':').map(Number)
        const allowed = item.schedule_kind === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : item.weekdays.split(',').filter(Boolean).map(Number)
        for (let day = 0; day < 7; day++) if (allowed.includes(((days[day].getDay() + 6) % 7) + 1)) grid.push({ day, hour: hour || 0, minute: minute || 0 })
      }
    }
    return grid
  }, [automations, days])
  const todayIndex = useMemo(() => { const now = new Date(); return (now.getDay() + 6) % 7 }, [])
  return <div className="schedule-calendar">
    <div className="schedule-calendar-zone"><Clock3 size={15}/><Select value="local" onChange={() => {}}><option value="local">{timezoneLabel()}</option></Select></div>
    <div className="schedule-calendar-grid">
      <div className="schedule-calendar-hours">{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{`${String(hour).padStart(2, '0')}:00`}</span>)}</div>
      <div className="schedule-calendar-columns">{days.map((date, index) => <div key={index} className={`schedule-calendar-day ${index === todayIndex ? 'is-today' : ''}`}>
        <header><strong>{translate("copy.242")}{WEEKDAYS()[index]}</strong><span>{String(date.getMonth() + 1).padStart(2, '0')}/{String(date.getDate()).padStart(2, '0')}</span></header>
        <div className="schedule-calendar-track">{Array.from({ length: 24 }, (_, hour) => <div key={hour} className="schedule-calendar-cell"/>)}{dots.filter(dot => dot.day === index).map((dot, position) => <span key={position} className="schedule-calendar-dot" style={{ top: `${(dot.hour + dot.minute / 60) * 26}px` }} title={`${String(dot.hour).padStart(2, '0')}:${String(dot.minute).padStart(2, '0')}`}/>)}</div>
      </div>)}</div>
    </div>
  </div>
}
function RunHistory({ runs, automations }: { runs: AutomationRun[]; automations: Automation[] }) {
  useLang(state=>state.lang);

  const [cursor, setCursor] = useState(20)
  if (!runs.length) return <div className="panel schedule-runs-empty">{translate("copy.243")}</div>
  return <div className="panel schedule-runs">{runs.slice(0, cursor).map(run => {
    const automation = automations.find(item => item.id === run.automation_id)
    const seconds = run.finished_at ? run.finished_at - run.started_at : null
    return <div key={run.id} className="schedule-run">
      <Clock size={15}/>
      <div className="schedule-run-body">
        <strong>{automation?.name ?? run.name ?? translate("copy.244")}</strong>
        <span>{stamp(run.started_at)}{seconds !== null ? translate("copy.245", {v0:seconds < 60 ? `${seconds} 秒` : `${Math.round(seconds / 60)} 分钟`}) : translate("copy.246")}</span>
      </div>
      <span className={`schedule-pill is-${run.status}`}>{run.status === 'completed' ? translate("copy.247") : run.status === 'running' ? translate("copy.248") : run.status === 'failed' ? translate("copy.249") : run.status === 'cancelled' ? translate("copy.250") : run.status}</span>
      {run.task_id && <Link className="link" to={`/tasks/${run.task_id}`}>{translate("copy.251")}<ChevronRight size={13}/></Link>}
    </div>
  })}{runs.length > cursor && <div className="schedule-more"><Button variant="secondary" onClick={() => setCursor(value => value + 20)}>{translate("copy.252")}</Button></div>}</div>
}

export function Schedule() {
  useLang(state=>state.lang);

  const automations = useAutomations(), runs = useAutomationRuns(), members = useAllMembers()
  const [view, setView] = useState<View>('list')
  const [search, setSearch] = useState('')
  const [folders, setFolders] = useState<string[]>(loadFolders)
  const [editing, setEditing] = useState<Automation | 'new' | null>(null)
  const [templates, setTemplates] = useState(false)
  const [template, setTemplate] = useState<Draft | null>(null)
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const persist = useCallback((next: string[]) => { setFolders(next); try { localStorage.setItem(FOLDER_KEY, JSON.stringify(next)) } catch { /* folders are a local convenience only */ } }, [])
  const list = automations.data ?? []
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle ? list.filter(item => `${item.name} ${item.message}`.toLowerCase().includes(needle)) : list
  }, [list, search])
  const memberName = (id: string | null) => id ? members.data?.find(member => member.id === id)?.name ?? translate("copy.253") : 'default'
  const createFrom = (draft: Draft) => { setTemplate(draft); setEditing('new') }
  return <div className="page schedule-page">
    <PageHead eyebrow={translate("english.107")} title={translate("copy.205")} description={translate("copy.254")} actions={<div className="ax-segmented schedule-views" role="tablist">
      {([['list', translate("copy.255"), List], ['calendar', translate("copy.256"), CalendarDays], ['runs', translate("copy.257"), Clock]] as const).map(([value, label, Icon]) => <button key={value} role="tab" aria-selected={view === value} className={view === value ? 'is-active' : ''} onClick={() => setView(value)}><Icon size={14}/> {label}</button>)}
    </div>}/>
    {automations.isError ? <div role="alert" className="panel schedule-error is-error">{translate("copy.258")}{String(automations.error)} <Button variant="secondary" onClick={() => void automations.refetch()}>{translate("copy.259")}</Button></div> : automations.isLoading ? <div className="panel schedule-error">{translate("copy.260")}</div>
      : view === 'calendar' ? <CalendarView automations={filtered}/>
      : view === 'runs' ? <RunHistory runs={runs.data ?? []} automations={list}/>
      : !list.length ? <div className="schedule-empty">
        <h2>{translate("copy.261")}</h2>
        <p>{translate("copy.262")}</p>
        <Button onClick={() => { setTemplate(null); setEditing('new') }}><Plus size={15}/> {translate("copy.263")}</Button>
        <span className="schedule-empty-hint">{translate("copy.264")}</span>
        <div className="schedule-templates-head"><h3>{translate("copy.265")}</h3><Button variant="secondary" onClick={() => setTemplates(true)}>{translate("copy.266")}</Button></div>
        <div className="schedule-templates">{TEMPLATES().slice(0, 4).map((item, index) => {
          const Icon = TEMPLATE_ICONS[index] ?? Repeat
          return <button key={item.name} className="schedule-template" onClick={() => createFrom({ ...emptyDraft(), ...item.draft, name: item.draft.name ?? item.name, message: item.draft.message ?? item.description })}>
            <Icon size={19}/><strong>{item.name}</strong><p>{item.description}</p><span>{item.schedule}</span>
          </button>
        })}</div>
      </div> : <>
        <div className="schedule-toolbar">
          <div className="schedule-search"><Search size={16}/><input aria-label={translate("copy.267")} placeholder={translate("copy.268")} value={search} onChange={event => setSearch(event.target.value)}/></div>
          <Button variant="secondary" onClick={() => { setFolderName(''); setFolderOpen(true) }}><FolderPlus size={14}/> {translate("copy.269")}</Button>
          <Button onClick={() => { setTemplate(null); setEditing('new') }}><Plus size={15}/> {translate("copy.270")}<ChevronDown size={14}/></Button>
        </div>
        <div className="panel schedule-table" role="table" aria-label={translate("copy.271")}>
          <div className="schedule-table-head" role="row">{[translate("copy.199"), translate("copy.272"), translate("copy.205"), translate("copy.202"), translate("copy.273"), translate("copy.274"), translate("copy.275"), translate("copy.276")].map(label => <span key={label} role="columnheader">{label}</span>)}</div>
          {folders.length > 0 && folders.map(folder => <div key={folder} className="schedule-folder">
            <div className="schedule-folder-head" role="row"><span>{folder}</span><small>{filtered.filter(item => item.folder === folder).length} {translate("copy.277")}</small></div>
            {filtered.filter(item => item.folder === folder).map(row => <Row key={row.id} item={row} member={memberName(row.member_id)} expanded={expanded === row.id} onExpand={() => setExpanded(current => current === row.id ? null : row.id)} onEdit={() => setEditing(row)}/>)}
          </div>)}
          {filtered.filter(item => !folders.length || !item.folder || !folders.includes(item.folder)).map(item => <Row key={item.id} item={item} member={memberName(item.member_id)} expanded={expanded === item.id} onExpand={() => setExpanded(current => current === item.id ? null : item.id)} onEdit={() => setEditing(item)}/>)}
          {!filtered.length && <div className="schedule-no-match">{translate("copy.278")}</div>}
        </div>
      </>}
    <Dialog open={editing !== null} onOpenChange={value => { if (!value) { setEditing(null); setTemplate(null) } }} title={editing === 'new' || template ? translate("copy.279") : translate("copy.280")} wide>
      {editing !== null && <ScheduleEditor key={template ? `template-${template.name}` : (editing === 'new' ? 'new' : editing.id)} automation={editing === 'new' || template ? undefined : editing} initial={template ?? undefined} folders={folders} onFolders={persist} close={() => { setEditing(null); setTemplate(null) }}/>}
    </Dialog>
    <Dialog open={templates} onOpenChange={setTemplates} title={translate("copy.281")} wide>
      <div className="schedule-template-grid">{TEMPLATES().map((item, index) => {
        const Icon = TEMPLATE_ICONS[index] ?? Repeat
        return <button key={item.name} className="schedule-template" onClick={() => { setTemplates(false); createFrom({ ...emptyDraft(), ...item.draft, name: item.draft.name ?? item.name, message: item.draft.message ?? item.description }) }}>
          <Icon size={19}/><strong>{item.name}</strong><p>{item.description}</p><span>{item.schedule}</span>
        </button>
      })}</div>
    </Dialog>
    <Dialog open={folderOpen} onOpenChange={setFolderOpen} title={translate("copy.269")}>
      <div className="stack"><Field label={translate("copy.282")} hint={translate("copy.283")}><Input autoFocus value={folderName} onChange={event => setFolderName(event.target.value)}/></Field>
        <div className="schedule-form-actions"><Button variant="secondary" onClick={() => setFolderOpen(false)}>{translate("copy.239")}</Button><Button disabled={!folderName.trim()} onClick={() => { persist([...new Set([...folders, folderName.trim()])]); setFolderOpen(false) }}><Plus size={14}/> {translate("copy.241")}</Button></div></div>
    </Dialog>
  </div>

  function Row({ item, member, expanded, onExpand, onEdit }: { item: Automation; member: string; expanded: boolean; onExpand: () => void; onEdit: () => void }) {
  useLang(state=>state.lang);

    return <div className="schedule-row" role="row">
      <div className="schedule-cell schedule-name"><strong>{item.name}</strong><small>{item.folder || translate("copy.284")}</small></div>
      <div className="schedule-cell schedule-type"><span className="schedule-agent">{item.member_id ? translate("copy.215") : translate("copy.215")}</span><small>{member}{item.model ? ` · ${item.model}` : ''}</small></div>
      <div className="schedule-cell schedule-plan"><Timer size={14}/><span>{scheduleLabel(item)}</span></div>
      <div className="schedule-cell schedule-message">
        <button type="button" className="schedule-expand" aria-expanded={expanded} onClick={onExpand}><ChevronDown size={13} className={expanded ? 'rotate-180' : ''}/> {expanded ? translate("copy.285") : translate("copy.286")}</button>
        {expanded && <p>{item.message}</p>}
      </div>
      <div className="schedule-cell"><span className={`schedule-pill ${item.enabled ? 'is-ready' : 'is-paused'}`}>{item.enabled ? translate("copy.287") : translate("copy.288")}</span></div>
      <div className="schedule-cell schedule-when">{relative(item.last_run_at)}</div>
      <div className="schedule-cell schedule-when">{item.enabled ? relative(item.next_run_at) : '—'}</div>
      <div className="schedule-cell schedule-actions">
        <Action run={async () => { await api(`/api/automations/${item.id}/run`, 'POST', {}) }}><Play size={13}/> {translate("copy.289")}</Action>
        <Action variant="danger" run={async () => { await api(`/api/automations/${item.id}`, 'DELETE') }}><Trash2 size={13}/> {translate("copy.290")}</Action>
        <Menu trigger={<button type="button" className="session-composer-icon" aria-label={translate("copy.291", {v0:item.name})}><MoreHorizontal size={16}/></button>} items={[
          { label: item.enabled ? translate("copy.292") : translate("copy.293"), action: () => { void api(`/api/automations/${item.id}/toggle`, 'POST', { enabled: !item.enabled }) } },
          { label: translate("copy.294"), action: onEdit },
          { label: item.silent ? translate("copy.295") : translate("copy.296"), action: () => { void api(`/api/automations/${item.id}`, 'PUT', { ...toBody(toDraft(item)), silent: !item.silent }) } },
        ]}/>
      </div>
    </div>
  }
}
