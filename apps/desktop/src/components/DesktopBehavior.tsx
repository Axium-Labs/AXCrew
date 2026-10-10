import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isTauri } from '@tauri-apps/api/core'
import { SettingsToggle } from './ui/settings-toggle'
import { call } from '../lib/errors'
import { translate, useLang } from '../lib/i18n'

const preferenceKey = ['desktop-close-preference']

export function DesktopBehavior() {
  const lang = useLang(s => s.lang), client = useQueryClient(), desktop = isTauri()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const preference = useQuery({ queryKey: preferenceKey, queryFn: () => call<boolean>('get_minimize_on_close'), enabled: desktop, retry: false })
  const save = async (enabled: boolean) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const saved = await call<boolean>('set_minimize_on_close', { enabled })
      client.setQueryData(preferenceKey, saved)
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  return <section className="settings-card">
    <h2>{translate('copy.124')}</h2>
    <SettingsToggle label={lang === 'zh' ? '关闭窗口时隐藏到系统托盘' : 'Hide to the system tray when closing the window'} description={translate('copy.125')} checked={preference.data === true} disabled={!desktop || preference.data === undefined || busy} onChange={event => void save(event.target.checked)}/>
    {!desktop && <p>{lang === 'zh' ? '此设置仅在桌面版中可用。' : 'This setting is available in the desktop app.'}</p>}
    {desktop && preference.isPending && <p role="status">{lang === 'zh' ? '读取设置中…' : 'Loading preference…'}</p>}
    {busy && <p role="status">{lang === 'zh' ? '处理中…' : 'Working…'}</p>}
    {preference.error && <div className="settings-notice is-error" role="alert">{String(preference.error)} <button disabled={busy} onClick={() => void preference.refetch()}>{lang === 'zh' ? '重试' : 'Retry'}</button></div>}
    {error && <p className="settings-notice is-error" role="alert">{error}</p>}
  </section>
}
