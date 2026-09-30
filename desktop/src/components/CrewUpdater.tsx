import { useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { useQuery } from '@tanstack/react-query'
import { Download, RefreshCw } from 'lucide-react'
import { axAvailable } from '../lib/ax'

type Status = { current_version: string; latest_version: string; available: boolean }
export function CrewUpdater() {
  const version = useQuery({ queryKey: ['desktop-version'], queryFn: getVersion, enabled: axAvailable })
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (install: boolean) => {
    if (install && !window.confirm('更新会退出 AX Crew 并打开安装向导。请先等待正在执行的任务结束，继续？')) return
    setBusy(true); setError('')
    try {
      if (install) await invoke('crew_apply_update')
      else setStatus(await invoke<Status>('crew_check_update'))
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  return <section className="settings-card">
    <h2>AX Crew 版本更新</h2>
    <div className="settings-field-row"><span>当前版本</span><strong>{version.data ?? '—'}</strong></div>
    <div className="settings-field-row"><span>最新正式版本</span><strong>{status?.latest_version ?? '尚未检查'}</strong></div>
    <p>从官方 GitHub Release 下载 Windows 安装包，校验 SHA256 后打开安装向导。更新保留现有设置和会话。</p>
    <div className="settings-actions">
      <button className="settings-secondary" disabled={!axAvailable || busy} onClick={() => void run(false)}><RefreshCw size={15}/> {busy ? '正在处理…' : '检查 AX Crew 更新'}</button>
      {status?.available && <button className="settings-primary" disabled={busy} onClick={() => void run(true)}><Download size={16}/> 下载并更新到 {status.latest_version}</button>}
    </div>
    {status && !status.available && <p role="status">已是最新版本。</p>}
    {error && <p className="settings-notice is-error" role="alert">{error}</p>}
  </section>
}
