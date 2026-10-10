import { useQuery } from '@tanstack/react-query'
import { isTauri } from '@tauri-apps/api/core'
import { call } from '../lib/errors'
import { useLang } from '../lib/i18n'
import './system-metrics.css'

type SystemInfo = {
  cpu_usage: number | null
  memory_total_mb: number | null
  memory_used_mb: number | null
  memory_usage: number | null
  uptime_secs: number | null
  disk_total_mb: number | null
  disk_used_mb: number | null
  disk_usage: number | null
  disk_path: string | null
  gpus?: { id: string; name: string; usage: number | null; memory_total_mb: number | null; memory_used_mb: number | null }[] | null
}

function valid(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function percentDisplay(value: number) {
  return value > 0 && value < 0.1 ? '<0.1%' : `${Number(value.toFixed(1))}%`
}
function percentage(value: number | null | undefined): number | undefined {
  return valid(value) && value <= 100 ? value : undefined
}
function capacity(used: number | null | undefined, total: number | null | undefined) {
  return valid(used) && valid(total) && total > 0 && used <= total
    ? `${(used / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} GiB` : undefined
}
function uptime(seconds: number, zh: boolean) {
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60)
  if (days > 0) return zh ? `${days} 天 ${hours} 小时` : `${days}d ${hours}h`
  if (hours > 0) return zh ? `${hours} 小时 ${minutes} 分钟` : `${hours}h ${minutes}m`
  return minutes > 0 ? zh ? `${minutes} 分钟` : `${minutes}m` : zh ? '不足 1 分钟' : 'Less than 1 minute'
}

export function SystemMetrics() {
  const zh = useLang(state => state.lang) === 'zh', desktop = isTauri()
  const info = useQuery({ queryKey: ['system-info'], queryFn: () => call<SystemInfo>('get_system_info'), enabled: desktop, retry: false, refetchInterval: 3000 })
  const data = info.isError ? undefined : info.data, missing = info.isPending ? zh ? '读取中…' : 'Loading…' : zh ? '不可用' : 'Unavailable'
  const rows = [
    { label: 'CPU', percent: percentage(data?.cpu_usage), amount: undefined },
    { label: zh ? '内存' : 'Memory', percent: percentage(data?.memory_usage), amount: capacity(data?.memory_used_mb, data?.memory_total_mb) },
    { label: `${zh ? '系统磁盘' : 'System disk'}${data?.disk_path ? ` (${data.disk_path.replace(/[\\/]+$/, '')})` : ''}`, percent: percentage(data?.disk_usage), amount: capacity(data?.disk_used_mb, data?.disk_total_mb) },
  ]
  return <section className="settings-card system-metrics-card">
    <h2>{zh ? '系统指标' : 'System metrics'}</h2>
    {!desktop ? <p>{zh ? '系统指标仅在桌面版中可用。' : 'System metrics are available in the desktop app.'}</p> : <>
      <p className="system-metrics-caption">{zh ? '本机资源使用情况，每 3 秒刷新。容量为已用 / 总量；磁盘统计 Windows 所在卷。' : 'Local resource usage, refreshed every 3 seconds. Capacity is used / total; disk usage covers the Windows volume.'}</p>
      {info.isError && <div className="settings-notice is-error" role="alert">{zh ? '系统指标读取失败。' : 'Could not read system metrics.'} {String(info.error)} <button disabled={info.isFetching} onClick={() => void info.refetch()}>{zh ? '重试' : 'Retry'}</button></div>}
      <div className="system-metrics">
        {rows.map(row => <div className="system-metric" key={row.label}>
          <div className="system-metric-heading"><span>{row.label}</span><div className="system-metric-reading">
            {row.amount && <span>{row.amount}</span>}
            <strong>{info.isError ? missing : row.percent === undefined ? missing : percentDisplay(row.percent)}</strong>
          </div></div>
          {!info.isError && row.percent !== undefined && <progress aria-label={row.label} max={100} value={row.percent} />}
        </div>)}
        {data?.gpus?.length ? data.gpus.map(gpu => {
          const usage = percentage(gpu.usage), memory = capacity(gpu.memory_used_mb, gpu.memory_total_mb)
          return <div className="system-metric" key={gpu.id}>
            <div className="system-metric-heading"><span>GPU · {gpu.name}</span><div className="system-metric-reading">
              <span>{zh ? '显存' : 'VRAM'} {memory ?? (zh ? '不可用' : 'Unavailable')}</span>
              <strong>{usage === undefined ? (zh ? '使用率不可用' : 'Usage unavailable') : percentDisplay(usage)}</strong>
            </div></div>
            {usage !== undefined && <progress aria-label={`GPU · ${gpu.name}`} max={100} value={usage} />}
          </div>
        }) : <div className="system-metric"><div className="system-metric-heading"><span>GPU</span><strong>{missing}</strong></div><small>{zh ? '需要支持 NVML 的 NVIDIA 驱动。' : 'Requires an NVIDIA driver with NVML support.'}</small></div>}
      </div>
      <div className="settings-field-row"><span>{zh ? '系统运行时间' : 'System uptime'}</span><strong>{!info.isError && valid(data?.uptime_secs) ? uptime(data.uptime_secs, zh) : missing}</strong></div>
    </>}
  </section>
}
