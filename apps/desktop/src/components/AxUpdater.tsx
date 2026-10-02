import { translate, useLang } from '../lib/i18n'
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
  useLang(state=>state.lang);

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
    if (status.action === 'update' && status.binary && !window.confirm(translate("copy.381", {v0:status.binary,v1:status.latest_version}))) return
    setApplying(true); setError('')
    try {
      setStatus(await axApplyUpdate())
      setRestartNeeded(true)
      await query.invalidateQueries({ queryKey: ['ax-local'] })
    } catch (cause) { setError(String(cause)) }
    finally { setApplying(false) }
  }

  const action = status?.action ?? 'none'
  const label = !status ? translate("copy.389") : action === 'install' ? translate("copy.382") : action === 'update' ? translate("copy.383", {v0:status?.latest_version}) : translate("copy.384")

  return <section className="settings-card">
    <h2>{translate("copy.385")}</h2>
    <p>{translate("copy.386")}<code>ax --update</code> {translate("copy.387")}</p>
    <div className="settings-field-row"><span>{translate("copy.388")}</span><strong>{status?.latest_version ?? translate("copy.389")}</strong></div>
    <div className="settings-field-row"><span>{translate("copy.390")}</span><strong>{status ? status.binary ?? translate("copy.391") : translate("copy.389")}</strong></div>
    <div className="settings-field-row"><span>{translate("copy.392")}</span><strong>{status?.local_version ?? '—'}</strong></div>
    <div className="settings-actions">
      <button className="settings-secondary" disabled={!axAvailable || checking || applying} onClick={() => void check()}><RefreshCw size={15}/> {translate("copy.393")}</button>
      <button className="settings-primary" disabled={!axAvailable || checking || applying || !status || action === 'none'} onClick={() => void apply()}>{action === 'install' ? <Download size={16}/> : <RefreshCw size={16}/>} {label}</button>
      {action === 'install' && <span>{translate("copy.394")}{status?.install_dir}</span>}
    </div>
    {status?.up_to_date && <div className="settings-provider-status"><ShieldCheck size={16}/> {translate("copy.395")}</div>}
    {status && !status.up_to_date && action === 'update' && <div className="settings-provider-status is-warning"><ShieldAlert size={16}/> {translate("copy.396")}{status.local_version} → {status.latest_version}</div>}
    {status?.report && <pre className="settings-report">{status.report}</pre>}
    {error && <div className="settings-provider-status is-warning" role="alert"><ShieldAlert size={16}/> {error}</div>}
    {!axAvailable && <div className="settings-provider-status"><ShieldAlert size={16}/> {translate("copy.397")}</div>}
    <p>{translate("copy.398")}</p>
    {restartNeeded && <button className="settings-primary" onClick={() => {
      if (window.confirm(translate("copy.399"))) void invoke('desktop_restart').catch(cause => setError(String(cause)))
    }}>{translate("copy.400")}</button>}
  </section>
}
