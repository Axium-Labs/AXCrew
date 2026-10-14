import { translate, useLang } from '../lib/i18n'
import { useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { call as invoke } from '../lib/errors'
import { useQuery } from '@tanstack/react-query'
import { Download, RefreshCw } from 'lucide-react'
import { axAvailable } from '../lib/ax'

type Status = { current_version: string; latest_version: string; available: boolean; manual_install?: boolean }
export function CrewUpdater() {
  const zh = useLang(state=>state.lang) === 'zh'

  const version = useQuery({ queryKey: ['desktop-version'], queryFn: getVersion, enabled: axAvailable })
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [opened, setOpened] = useState(false)
  const run = async (install: boolean) => {
    if (install && !status?.manual_install && !window.confirm(translate("copy.401"))) return
    setBusy(true); setError('')
    try {
      if (install) { await invoke('crew_apply_update'); setOpened(true) }
      else setStatus(await invoke<Status>('crew_check_update'))
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  return <section className="settings-card">
    <h2>{translate("copy.402")}</h2>
    <div className="settings-field-row"><span>{translate("copy.403")}</span><strong>{version.data ?? '—'}</strong></div>
    <div className="settings-field-row"><span>{translate("copy.404")}</span><strong>{status?.latest_version ?? translate("copy.389")}</strong></div>
    <p>{status?.manual_install ? (zh ? '下载并校验对应系统的安装包；完成安装后请重启 AX Crew。' : 'Download and verify the installer for this system, then complete installation and restart AX Crew.') : translate("copy.405")}</p>
    <div className="settings-actions">
      <button className="settings-secondary" disabled={!axAvailable || busy} onClick={() => void run(false)}><RefreshCw size={15}/> {busy ? translate("copy.406") : translate("copy.407")}</button>
      {status?.available && <button className="settings-primary" disabled={busy} onClick={() => void run(true)}><Download size={16}/> {translate("copy.408")}{status.latest_version}</button>}
    </div>
    {status && !status.available && <p role="status">{translate("copy.395")}</p>}
    {opened && status?.manual_install && <p role="status">{zh ? '安装包已打开，请完成安装后重启 AX Crew。' : 'Installer opened. Complete installation, then restart AX Crew.'}</p>}
    {error && <p className="settings-notice is-error" role="alert">{error}</p>}
  </section>
}
