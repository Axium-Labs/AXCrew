import { translate, useLang } from '../lib/i18n'
import { useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { useQuery } from '@tanstack/react-query'
import { Download, RefreshCw } from 'lucide-react'
import { axAvailable } from '../lib/ax'

type Status = { current_version: string; latest_version: string; available: boolean }
export function CrewUpdater() {
  useLang(state=>state.lang);

  const version = useQuery({ queryKey: ['desktop-version'], queryFn: getVersion, enabled: axAvailable })
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (install: boolean) => {
    if (install && !window.confirm(translate("copy.401"))) return
    setBusy(true); setError('')
    try {
      if (install) await invoke('crew_apply_update')
      else setStatus(await invoke<Status>('crew_check_update'))
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  return <section className="settings-card">
    <h2>{translate("copy.402")}</h2>
    <div className="settings-field-row"><span>{translate("copy.403")}</span><strong>{version.data ?? '—'}</strong></div>
    <div className="settings-field-row"><span>{translate("copy.404")}</span><strong>{status?.latest_version ?? translate("copy.389")}</strong></div>
    <p>{translate("copy.405")}</p>
    <div className="settings-actions">
      <button className="settings-secondary" disabled={!axAvailable || busy} onClick={() => void run(false)}><RefreshCw size={15}/> {busy ? translate("copy.406") : translate("copy.407")}</button>
      {status?.available && <button className="settings-primary" disabled={busy} onClick={() => void run(true)}><Download size={16}/> {translate("copy.408")}{status.latest_version}</button>}
    </div>
    {status && !status.available && <p role="status">{translate("copy.395")}</p>}
    {error && <p className="settings-notice is-error" role="alert">{error}</p>}
  </section>
}
