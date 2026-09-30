import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { axApplyUpdate, axAvailable, axCheckUpdate, type AxUpdateStatus } from '../lib/ax'
import { invoke } from '@tauri-apps/api/core'

/**
 * 设置 → 本地 AX → AX 更新。
 *
 * 「检查更新」拿 GitHub Releases 上的最新 tag 和本机的 `ax --version` 比一比；
 * 「下载 / 更新」按情况跑 AX 官方安装脚本或 `ax --update`，两者都会按 release 的
 * SHA256SUMS 校验，所以这里只负责触发，并把原始输出贴出来。
 *
 * 管理系统 AX，更新后重启 Crew，使网关和模型目录使用同一版本。
 */
export function AxUpdater() {
  const query = useQueryClient()
  const [status, setStatus] = useState<AxUpdateStatus | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [restartNeeded, setRestartNeeded] = useState(false)

  const check = async () => {
    setChecking(true); setError('')
    try { setStatus(await axCheckUpdate()) }
    catch (cause) { setStatus(null); setError(String(cause)) }
    finally { setChecking(false) }
  }

  const apply = async () => {
    if (!status) return
    // 更新是就地替换可执行文件，先说清楚替换的是哪一个。
    if (status.action === 'update' && status.binary && !window.confirm(`更新会把 ${status.binary} 替换为 ${status.latest_version}，继续？`)) return
    setApplying(true); setError('')
    try {
      setStatus(await axApplyUpdate())
      setRestartNeeded(true)
      await query.invalidateQueries({ queryKey: ['ax-local'] })
    } catch (cause) { setError(String(cause)) }
    finally { setApplying(false) }
  }

  const action = status?.action ?? 'none'
  const label = action === 'install' ? '下载并安装 AX' : action === 'update' ? `更新到 ${status?.latest_version}` : '已是最新版本'

  return <section className="settings-card">
    <h2>AX 更新</h2>
    <p>从 GitHub Releases 检查最新版本，并下载或更新系统中安装的 AX。下载由 AX 官方安装脚本或 <code>ax --update</code> 完成，两者都会按 release 的 SHA256SUMS 校验。</p>
    <div className="settings-field-row"><span>线上最新版本</span><strong>{status?.latest_version ?? '尚未检查'}</strong></div>
    <div className="settings-field-row"><span>本机 AX</span><strong>{status ? status.binary ?? '未安装' : '尚未检查'}</strong></div>
    <div className="settings-field-row"><span>本机版本</span><strong>{status?.local_version ?? '—'}</strong></div>
    <div className="settings-actions">
      <button className="settings-secondary" disabled={!axAvailable || checking || applying} onClick={() => void check()}><RefreshCw size={15}/> 检查更新</button>
      <button className="settings-primary" disabled={!axAvailable || checking || applying || !status || action === 'none'} onClick={() => void apply()}>{action === 'install' ? <Download size={16}/> : <RefreshCw size={16}/>} {label}</button>
      {action === 'install' && <span>将安装到 {status?.install_dir}</span>}
    </div>
    {status?.up_to_date && <div className="settings-provider-status"><ShieldCheck size={16}/> 已是最新版本。</div>}
    {status && !status.up_to_date && action === 'update' && <div className="settings-provider-status is-warning"><ShieldAlert size={16}/> 有新版本：{status.local_version} → {status.latest_version}</div>}
    {status?.report && <pre className="settings-report">{status.report}</pre>}
    {error && <div className="settings-provider-status is-warning" role="alert"><ShieldAlert size={16}/> {error}</div>}
    {!axAvailable && <div className="settings-provider-status"><ShieldAlert size={16}/> 仅桌面应用可以检查或更新 AX。</div>}
    <p>AX Crew 使用系统安装的 AX。安装或更新后，请等待任务结束，再重启 AX Crew 以启用新版本。</p>
    {restartNeeded && <button className="settings-primary" onClick={() => {
      if (window.confirm('重启会中断正在执行的本地任务。确定现在重启 AX Crew？')) void invoke('desktop_restart').catch(cause => setError(String(cause)))
    }}>重启 AX Crew，使用系统 AX</button>}
  </section>
}
