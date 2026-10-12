import type { ReactNode } from 'react'
import { Activity, AlertCircle, Clock3, Cpu } from 'lucide-react'
import type { Cluster } from '../lib/distributed'
import type { Label } from './distributed-forms'

export const isOnline = (seen: number, enabled: boolean, time: number) => enabled && seen > 0 && seen > time - 30

export function ClusterStatus({ value, label }: { value: string; label: Label }) {
  const names: Record<string, [string, string]> = {
    removed: ['已删除', 'Deleted'], online: ['在线', 'Online'], offline: ['离线', 'Offline'], disabled: ['已禁用', 'Disabled'],
    active: ['进行中', 'Active'], running: ['执行中', 'Running'], pending: ['待调度', 'Queued'],
    paused: ['已暂停', 'Paused'], blocked: ['受阻', 'Blocked'], failed: ['失败', 'Failed'],
    completed: ['已完成', 'Completed'], cancelled: ['已取消', 'Cancelled'],
  }
  const tone = ['online', 'completed'].includes(value) ? 'success' : ['active', 'running'].includes(value) ? 'active' : ['blocked', 'failed', 'offline'].includes(value) ? 'danger' : ['pending', 'paused'].includes(value) ? 'warning' : 'muted'
  return <span className={`cluster-status is-${tone}`}><i aria-hidden="true" />{names[value] ? label(...names[value]) : value}</span>
}

export function QuietEmpty({ title, description, icon, action }: { title: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
  return <div className="cluster-empty">{icon && <span className="cluster-empty-icon">{icon}</span>}<div><strong>{title}</strong>{description && <p>{description}</p>}{action && <div className="cluster-empty-action">{action}</div>}</div></div>
}

export function ClusterOverview({ state, label, loading }: { state?: Cluster; label: Label; loading: boolean }) {
  const instances = Object.values(state?.instances ?? {}), tasks = Object.values(state?.tasks ?? {}), workflows = Object.values(state?.workflows ?? {})
  const online = instances.filter(i => isOnline(i.last_seen, i.enabled, state?.server_time ?? 0)).length
  const running = tasks.filter(t => t.status === 'running').length
  const active = workflows.filter(w => w.status === 'active').length
  const failed = tasks.filter(t => t.status === 'failed').length
  const offline = instances.filter(i => i.enabled && !isOnline(i.last_seen, i.enabled, state?.server_time ?? 0)).length
  const pending = tasks.filter(t => t.status === 'pending').length
  const items = [
    { icon: Cpu, title: label('在线 AX', 'Online AX'), value: online, detail: `${instances.length} ${label('个实例 ·', 'instances ·')} ${Object.keys(state?.hosts ?? {}).length} Host`, tone: online ? 'success' : '' },
    { icon: Activity, title: label('运行任务', 'Running tasks'), value: running, detail: `${active} ${label('个进行中的协作', 'active collaborations')}`, tone: running ? 'active' : '' },
    { icon: AlertCircle, title: label('异常', 'Issues'), value: failed + offline, detail: `${failed} ${label('失败任务 ·', 'failed tasks ·')} ${offline} ${label('离线 AX', 'offline AX')}`, tone: failed + offline ? 'danger' : '' },
    { icon: Clock3, title: label('待调度', 'Queued tasks'), value: pending, detail: label('等待依赖、能力或可用资源', 'Awaiting dependencies, capabilities or capacity'), tone: pending ? 'warning' : '' },
  ]
  return <section className="cluster-overview" aria-label={label('协作概览', 'Cluster overview')} aria-busy={loading}>{items.map(({ icon: Icon, title, value, detail, tone }) => <div className={`cluster-metric ${tone ? `is-${tone}` : ''}`} key={title}><div className="cluster-metric-label"><Icon size={14} />{title}</div><strong>{state ? value : '—'}</strong><small>{state ? detail : label('正在读取状态', 'Reading state')}</small></div>)}</section>
}

export function SectionTitle({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return <div className="cluster-section-head"><h3>{title}</h3>{meta && <small>{meta}</small>}{actions}</div>
}
