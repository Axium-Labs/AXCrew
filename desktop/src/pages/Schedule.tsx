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

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
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
const TEMPLATES: Template[] = [
  { name: '每晚构建监控', description: '每晚构建并测试 main；报告失败和可能的修复。', schedule: '每日 · 02:00', draft: { name: '每晚构建监控', message: '构建并测试 main 分支，报告失败项以及可能的修复方案。', schedule_kind: 'daily', daily_time: '02:00' } },
  { name: '错误摘要', description: '把新的生产错误聚类，并给出每一类的可疑原因。', schedule: '每 6 小时', draft: { name: '错误摘要', message: '汇总上次运行以来新增的生产错误，按类型聚类，并为每一类给出简短摘要和可疑原因。', schedule_kind: 'interval', interval_value: 6, interval_unit: 'hours' } },
  { name: '站会简报', description: '站会前汇总你的提交、PR、CI 状态和阻塞项。', schedule: '工作日 · 08:45', draft: { name: '站会简报', message: '汇总昨天的提交、待审 PR、CI 状态和阻塞项，写成站会可用的简报。', schedule_kind: 'weekly', daily_time: '08:45', weekdays: [1, 2, 3, 4, 5] } },
  { name: '部署验证', description: '运行部署后冒烟检查，并给出放行 / 不放行结论。', schedule: '每 30 分钟', draft: { name: '部署验证', message: '运行部署后的冒烟检查，并给出放行或不放行的结论。', schedule_kind: 'interval', interval_value: 30, interval_unit: 'minutes' } },
  { name: '依赖巡检', description: '检查依赖是否有新版本和安全公告。', schedule: '每日 · 09:00', draft: { name: '依赖巡检', message: '检查项目依赖的新版本与安全公告，列出需要升级的条目。', schedule_kind: 'daily', daily_time: '09:00' } },
  { name: '日志清理', description: '归档并清理过期日志，保持工作区干净。', schedule: '每周 · 周日 23:00', draft: { name: '日志清理', message: '归档并清理过期日志，报告释放的空间。', schedule_kind: 'weekly', daily_time: '23:00', weekdays: [7], hide_from_chat: true, silent: true } },
  { name: '指标快照', description: '记录关键指标快照，便于对比趋势。', schedule: '每小时', draft: { name: '指标快照', message: '记录当前的关键指标快照，并和上一次快照对比差异。', schedule_kind: 'interval', interval_value: 1, interval_unit: 'hours' } },
  { name: '收尾检查', description: '一天结束时整理未完成的改动并给出下一步。', schedule: '工作日 · 18:30', draft: { name: '收尾检查', message: '整理今天未完成的改动、未通过的测试和未回复的评审，给出明天的下一步。', schedule_kind: 'weekly', daily_time: '18:30', weekdays: [1, 2, 3, 4, 5] } },
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
    if (minutes % 1440 === 0) return `每 ${minutes / 1440} 天`
    if (minutes % 60 === 0) return `每 ${minutes / 60} 小时`
    return `每 ${minutes} 分钟`
  }
  const days = item.weekdays.split(',').filter(Boolean).map(Number)
  const weekday = days.length === 5 && days.every(day => day <= 5) ? '工作日' : days.length ? `周${days.map(day => WEEKDAYS[day - 1] ?? '').join('、')}` : '每周'
  return `${item.schedule_kind === 'daily' ? '每日' : weekday} · ${item.daily_time}`
}
function relative(epoch?: number | null) {
  if (!epoch) return '—'
  const diff = epoch - Date.now() / 1000
  const minutes = Math.round(Math.abs(diff) / 60)
  const text = minutes < 1 ? '不到 1 分钟' : minutes < 60 ? `${minutes} 分钟` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${Math.round(minutes / 1440)} 天`
  return diff > 0 ? `${text}后` : `${text}前`
}
function stamp(epoch?: number | null) {
  return epoch ? new Date(epoch * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
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
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`schedule-switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}><span/></button>
}
function ScheduleField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="schedule-field"><span className="schedule-field-title">{label}</span>{hint && <span className="schedule-field-hint">{hint}</span>}{children}</div>
}
function ScheduleEditor({ automation, initial, folders, onFolders, close }: { automation?: Automation; initial?: Draft; folders: string[]; onFolders: (folders: string[]) => void; close: () => void }) {
  const members = useAllMembers()
  const [draft, setDraft] = useState<Draft>(() => automation ? toDraft(automation) : initial ?? emptyDraft())
  const [error, setError] = useState('')
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }))
  const save = async () => {
    if (!draft.name.trim() || !draft.message.trim()) { setError('名称和消息都不能为空'); return }
    if (draft.schedule_kind === 'weekly' && !draft.weekdays.length) { setError('每周计划至少要选择一天'); return }
    const body = toBody(draft)
    await api(automation ? `/api/automations/${automation.id}` : '/api/automations', automation ? 'PUT' : 'POST', body)
    if (draft.folder && !folders.includes(draft.folder)) onFolders([...folders, draft.folder])
    close()
  }
  return <div className="stack schedule-form">
    <ScheduleField label="名称" hint="此任务的简短标签"><Input value={draft.name} onChange={event => set('name', event.target.value)} placeholder="例如：每晚构建监控"/></ScheduleField>
    <ScheduleField label="消息" hint="此任务触发时发送给代理的提示词或任务"><Textarea rows={4} value={draft.message} onChange={event => set('message', event.target.value)} placeholder="描述代理每次运行时要完成的事情"/></ScheduleField>
    <div className="schedule-field">
      <span className="schedule-field-title">计划</span>
      <span className="schedule-field-hint">此任务的运行频率</span>
      <div className="schedule-plan">
        <Select value={draft.schedule_kind} onChange={value => set('schedule_kind', value as Draft['schedule_kind'])}>
          <option value="interval">固定间隔</option><option value="daily">每天</option><option value="weekly">每周</option>
        </Select>
        {draft.schedule_kind === 'interval' ? <>
          <Input type="number" min={1} aria-label="间隔数值" value={draft.interval_value} onChange={event => set('interval_value', Math.max(1, Number(event.target.value) || 1))}/>
          <Select value={draft.interval_unit} onChange={value => set('interval_unit', value as Draft['interval_unit'])}>
            <option value="minutes">分钟</option><option value="hours">小时</option><option value="days">天</option>
          </Select>
        </> : <>
          <Input type="time" aria-label="运行时间" value={draft.daily_time} onChange={event => set('daily_time', event.target.value || '09:00')}/>
          {draft.schedule_kind === 'weekly' && <div className="schedule-weekdays" role="group" aria-label="运行日期">{WEEKDAYS.map((label, index) => <button key={label} type="button" aria-pressed={draft.weekdays.includes(index + 1)} className={draft.weekdays.includes(index + 1) ? 'is-on' : ''} onClick={() => set('weekdays', draft.weekdays.includes(index + 1) ? draft.weekdays.filter(day => day !== index + 1) : [...draft.weekdays, index + 1])}>{label}</button>)}</div>}
        </>}
      </div>
    </div>
    <ScheduleField label="代理" hint="由哪个代理处理此任务。保持默认则使用主代理。">
      <Select value={draft.member_id} onChange={value => set('member_id', value)}>
        <option value="">default（主代理）</option>
        {(members.data ?? []).map(member => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}
      </Select>
    </ScheduleField>
    <ScheduleField label="模型" hint="为此任务覆盖模型。保持“继承”则使用代理或全局默认值。">
      <Select value={draft.model} onChange={value => set('model', value)}><option value="">继承代理设置</option>{draft.model && <option value={draft.model}>{draft.model}</option>}</Select>
    </ScheduleField>
    <ScheduleField label="审批" hint="执行期间工具调用的审批方式">
      <Select value={draft.approval} onChange={value => set('approval', value as Draft['approval'])}>
        <option value="default">默认</option><option value="auto">自动批准</option><option value="ask">每次都询问</option>
      </Select>
    </ScheduleField>
    <div className="schedule-toggles">
      <div><strong>静默模式</strong><span>禁止自动发送消息。由代理决定何时通知。</span></div><Switch label="静默模式" checked={draft.silent} onChange={value => set('silent', value)}/>
      <div><strong>严格计划</strong><span>严格按计划触发，不加抖动。默认情况下任务会随机分散，以减少流量峰值。</span></div><Switch label="严格计划" checked={draft.strict_schedule} onChange={value => set('strict_schedule', value)}/>
      <div><strong>在聊天中隐藏</strong><span>不在活动会话列表中显示此任务的运行。适用于无需关注的任务（摘要、清理）— 结果仍会送达通知和历史标签页。</span></div><Switch label="在聊天中隐藏" checked={draft.hide_from_chat} onChange={value => set('hide_from_chat', value)}/>
    </div>
    <ScheduleField label="聊天文件夹" hint="把此任务聊天标签页放进聊天侧边栏某个文件夹，方便集中查找它的运行记录。归档不会隐藏任何内容：通知和投递均不受影响。">
      <Select value={draft.folder} onChange={value => set('folder', value)}><option value="">不归档运行记录</option>{folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</Select>
    </ScheduleField>
    <p className="schedule-field-hint">{folders.length ? '文件夹已就绪，创建后即可在侧边栏中集中查找运行记录。' : '还没有文件夹。请先保存此任务；在聊天侧边栏中创建一个文件夹，然后重新打开此任务再选择它。'}</p>
    <div className="schedule-toggles">
      <div><strong>精简上下文</strong><span>每次运行都跳过记忆、经验、引导规则、技能和过往会话历史，让例行任务不再为从不读取的上下文付费。如果任务需要你保存的上下文，或者要调用技能，请保持关闭。</span></div><Switch label="精简上下文" checked={draft.lean_context} onChange={value => set('lean_context', value)}/>
    </div>
    {error && <p className="goal-problem" role="alert">{error}</p>}
    <div className="schedule-form-actions"><Button variant="secondary" onClick={close}>取消</Button><Action variant="default" run={save}><Plus size={14}/> {automation ? '保存' : '创建'}</Action></div>
  </div>
}
function CalendarView({ automations }: { automations: Automation[] }) {
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
        <header><strong>周{WEEKDAYS[index]}</strong><span>{String(date.getMonth() + 1).padStart(2, '0')}/{String(date.getDate()).padStart(2, '0')}</span></header>
        <div className="schedule-calendar-track">{Array.from({ length: 24 }, (_, hour) => <div key={hour} className="schedule-calendar-cell"/>)}{dots.filter(dot => dot.day === index).map((dot, position) => <span key={position} className="schedule-calendar-dot" style={{ top: `${(dot.hour + dot.minute / 60) * 26}px` }} title={`${String(dot.hour).padStart(2, '0')}:${String(dot.minute).padStart(2, '0')}`}/>)}</div>
      </div>)}</div>
    </div>
  </div>
}
function RunHistory({ runs, automations }: { runs: AutomationRun[]; automations: Automation[] }) {
  const [cursor, setCursor] = useState(20)
  if (!runs.length) return <div className="panel schedule-runs-empty">还没有执行记录。定时任务每次运行时都会在这里留下一条记录。</div>
  return <div className="panel schedule-runs">{runs.slice(0, cursor).map(run => {
    const automation = automations.find(item => item.id === run.automation_id)
    const seconds = run.finished_at ? run.finished_at - run.started_at : null
    return <div key={run.id} className="schedule-run">
      <Clock size={15}/>
      <div className="schedule-run-body">
        <strong>{automation?.name ?? run.name ?? '已删除的计划'}</strong>
        <span>{stamp(run.started_at)}{seconds !== null ? ` · 用时 ${seconds < 60 ? `${seconds} 秒` : `${Math.round(seconds / 60)} 分钟`}` : ' · 进行中'}</span>
      </div>
      <span className={`schedule-pill is-${run.status}`}>{run.status === 'completed' ? '已完成' : run.status === 'running' ? '运行中' : run.status === 'failed' ? '失败' : run.status === 'cancelled' ? '已取消' : run.status}</span>
      {run.task_id && <Link className="link" to={`/tasks/${run.task_id}`}>查看运行 <ChevronRight size={13}/></Link>}
    </div>
  })}{runs.length > cursor && <div className="schedule-more"><Button variant="secondary" onClick={() => setCursor(value => value + 20)}>加载更多</Button></div>}</div>
}

export function Schedule() {
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
  const memberName = (id: string | null) => id ? members.data?.find(member => member.id === id)?.name ?? '已删除的代理' : 'default'
  const createFrom = (draft: Draft) => { setTemplate(draft); setEditing('new') }
  return <div className="page schedule-page">
    <PageHead eyebrow="Automations" title="计划" description="管理周期性定时任务和计划任务" actions={<div className="schedule-views" role="tablist">
      {([['list', '列表', List], ['calendar', '日历', CalendarDays], ['runs', '执行记录', Clock]] as const).map(([value, label, Icon]) => <button key={value} role="tab" aria-selected={view === value} className={view === value ? 'is-active' : ''} onClick={() => setView(value)}><Icon size={14}/> {label}</button>)}
    </div>}/>
    {automations.isError ? <div className="panel schedule-error">无法加载计划：{String(automations.error)} <Button variant="secondary" onClick={() => void automations.refetch()}>重试</Button></div> : automations.isLoading ? <div className="panel schedule-error">正在加载计划…</div>
      : view === 'calendar' ? <CalendarView automations={filtered}/>
      : view === 'runs' ? <RunHistory runs={runs.data ?? []} automations={list}/>
      : !list.length ? <div className="schedule-empty">
        <h2>尚无定时任务</h2>
        <p>安排周期性任务自动运行 — 检查流水线、生成报告、监控服务，或任何代理能做的事。</p>
        <Button onClick={() => { setTemplate(null); setEditing('new') }}><Plus size={15}/> 创建你的第一个任务</Button>
        <span className="schedule-empty-hint">或：在聊天中询问 — 试试“提醒我每天早上检查流水线”</span>
        <div className="schedule-templates-head"><h3>从预设计划开始</h3><Button variant="secondary" onClick={() => setTemplates(true)}>浏览全部模板</Button></div>
        <div className="schedule-templates">{TEMPLATES.slice(0, 4).map((item, index) => {
          const Icon = TEMPLATE_ICONS[index] ?? Repeat
          return <button key={item.name} className="schedule-template" onClick={() => createFrom({ ...emptyDraft(), ...item.draft, name: item.draft.name ?? item.name, message: item.draft.message ?? item.description })}>
            <Icon size={19}/><strong>{item.name}</strong><p>{item.description}</p><span>{item.schedule}</span>
          </button>
        })}</div>
      </div> : <>
        <div className="schedule-toolbar">
          <div className="schedule-search"><Search size={16}/><input aria-label="筛选任务" placeholder="筛选任务…" value={search} onChange={event => setSearch(event.target.value)}/></div>
          <Button variant="secondary" onClick={() => { setFolderName(''); setFolderOpen(true) }}><FolderPlus size={14}/> 新建文件夹</Button>
          <Button onClick={() => { setTemplate(null); setEditing('new') }}><Plus size={15}/> 添加任务 <ChevronDown size={14}/></Button>
        </div>
        <div className="panel schedule-table" role="table" aria-label="定时任务">
          <div className="schedule-table-head" role="row">{['名称', '类型', '计划', '消息', '状态', '上次运行', '下次运行', '操作'].map(label => <span key={label} role="columnheader">{label}</span>)}</div>
          {folders.length > 0 && folders.map(folder => <div key={folder} className="schedule-folder">
            <div className="schedule-folder-head" role="row"><span>{folder}</span><small>{filtered.filter(item => item.folder === folder).length} 个任务</small></div>
            {filtered.filter(item => item.folder === folder).map(row => <Row key={row.id} item={row} member={memberName(row.member_id)} expanded={expanded === row.id} onExpand={() => setExpanded(current => current === row.id ? null : row.id)} onEdit={() => setEditing(row)}/>)}
          </div>)}
          {filtered.filter(item => !folders.length || !item.folder || !folders.includes(item.folder)).map(item => <Row key={item.id} item={item} member={memberName(item.member_id)} expanded={expanded === item.id} onExpand={() => setExpanded(current => current === item.id ? null : item.id)} onEdit={() => setEditing(item)}/>)}
          {!filtered.length && <div className="schedule-no-match">没有匹配的任务</div>}
        </div>
      </>}
    <Dialog open={editing !== null} onOpenChange={value => { if (!value) { setEditing(null); setTemplate(null) } }} title={editing === 'new' || template ? '新建定时任务' : '编辑定时任务'} wide>
      {editing !== null && <ScheduleEditor key={template ? `template-${template.name}` : (editing === 'new' ? 'new' : editing.id)} automation={editing === 'new' || template ? undefined : editing} initial={template ?? undefined} folders={folders} onFolders={persist} close={() => { setEditing(null); setTemplate(null) }}/>}
    </Dialog>
    <Dialog open={templates} onOpenChange={setTemplates} title="全部预设计划" wide>
      <div className="schedule-template-grid">{TEMPLATES.map((item, index) => {
        const Icon = TEMPLATE_ICONS[index] ?? Repeat
        return <button key={item.name} className="schedule-template" onClick={() => { setTemplates(false); createFrom({ ...emptyDraft(), ...item.draft, name: item.draft.name ?? item.name, message: item.draft.message ?? item.description }) }}>
          <Icon size={19}/><strong>{item.name}</strong><p>{item.description}</p><span>{item.schedule}</span>
        </button>
      })}</div>
    </Dialog>
    <Dialog open={folderOpen} onOpenChange={setFolderOpen} title="新建文件夹">
      <div className="stack"><Field label="文件夹名称" hint="用于在聊天侧边栏里集中查找某个计划的运行记录"><Input autoFocus value={folderName} onChange={event => setFolderName(event.target.value)}/></Field>
        <div className="schedule-form-actions"><Button variant="secondary" onClick={() => setFolderOpen(false)}>取消</Button><Button disabled={!folderName.trim()} onClick={() => { persist([...new Set([...folders, folderName.trim()])]); setFolderOpen(false) }}><Plus size={14}/> 创建</Button></div></div>
    </Dialog>
  </div>

  function Row({ item, member, expanded, onExpand, onEdit }: { item: Automation; member: string; expanded: boolean; onExpand: () => void; onEdit: () => void }) {
    return <div className="schedule-row" role="row">
      <div className="schedule-cell schedule-name"><strong>{item.name}</strong><small>{item.folder || '未归档'}</small></div>
      <div className="schedule-cell schedule-type"><span className="schedule-agent">{item.member_id ? '代理' : '代理'}</span><small>{member}{item.model ? ` · ${item.model}` : ''}</small></div>
      <div className="schedule-cell schedule-plan"><Timer size={14}/><span>{scheduleLabel(item)}</span></div>
      <div className="schedule-cell schedule-message">
        <button type="button" className="schedule-expand" aria-expanded={expanded} onClick={onExpand}><ChevronDown size={13} className={expanded ? 'rotate-180' : ''}/> {expanded ? '隐藏消息' : '显示消息'}</button>
        {expanded && <p>{item.message}</p>}
      </div>
      <div className="schedule-cell"><span className={`schedule-pill ${item.enabled ? 'is-ready' : 'is-paused'}`}>{item.enabled ? '就绪' : '已暂停'}</span></div>
      <div className="schedule-cell schedule-when">{relative(item.last_run_at)}</div>
      <div className="schedule-cell schedule-when">{item.enabled ? relative(item.next_run_at) : '—'}</div>
      <div className="schedule-cell schedule-actions">
        <Action run={async () => { await api(`/api/automations/${item.id}/run`, 'POST', {}) }}><Play size={13}/> 运行</Action>
        <Action variant="danger" run={async () => { await api(`/api/automations/${item.id}`, 'DELETE') }}><Trash2 size={13}/> 删除</Action>
        <Menu trigger={<button type="button" className="session-composer-icon" aria-label={`${item.name} 的更多操作`}><MoreHorizontal size={16}/></button>} items={[
          { label: item.enabled ? '暂停计划' : '恢复计划', action: () => { void api(`/api/automations/${item.id}/toggle`, 'POST', { enabled: !item.enabled }) } },
          { label: '编辑任务', action: onEdit },
          { label: item.silent ? '关闭静默模式' : '开启静默模式', action: () => { void api(`/api/automations/${item.id}`, 'PUT', { ...toBody(toDraft(item)), silent: !item.silent }) } },
        ]}/>
      </div>
    </div>
  }
}
