import { translate, useLang } from '../lib/i18n'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import {
  ChevronRight, Copy, Globe, Monitor, QrCode, RefreshCw, ShieldAlert, ShieldCheck, Smartphone, Trash2, Wifi,
} from 'lucide-react'
import { endpoints, getConnection, type AuthorizedClient } from '../lib/api'

type Connection = { endpoint: string; token: string; lan_url?: string }
type Pairing = { code: string; short_code: string; expires_at: number }

function fmtCountdown(remainingSeconds: number): string {
  const m = Math.floor(Math.max(0, remainingSeconds) / 60)
  const s = Math.max(0, remainingSeconds) % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
function fmtStamp(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * 手机配对卡片（Pair Device）：
 * 生成一次性配对码 → 二维码 + 短码 + 倒计时；桌面确认新设备请求；已授权设备管理（可撤销）。
 */
export function AndroidConnection() {
  useLang(state=>state.lang);

  const [connection, setConnection] = useState<Connection | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'lan' | 'remote'>('lan')
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [qr, setQr] = useState('')
  const [now, setNow] = useState(Date.now())
  const [issued, setIssued] = useState<{ pending: AuthorizedClient[]; authorized: AuthorizedClient[] }>({ pending: [], authorized: [] })
  const [confirming, setConfirming] = useState<AuthorizedClient | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const url = connection?.lan_url ?? connection?.endpoint ?? ''
  const remaining = pairing ? pairing.expires_at - Math.floor(now / 1000) : 0
  const pairingExpired = !pairing || remaining <= 0

  useEffect(() => {
    let alive = true
    getConnection()
      .then((value) => { if (alive) setConnection(value) })
      .catch(() => { if (alive) setError(translate("copy.409")) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // 已授权设备列表（含待确认）
  const loadAuthorizations = async () => {
    try { setIssued(await endpoints.authorizations()) } catch { /* 静默 */ }
  }
  useEffect(() => { void loadAuthorizations() }, [])

  // 轮询待确认设备：有新请求则弹出授权确认
  useEffect(() => {
    if (!url) return
    let alive = true
    const poll = async () => {
      try {
        const result = await endpoints.authorizations()
        if (!alive) return
        setIssued(result)
        const unseen = result.pending.find(
          (p) => !issued.pending.some((prev) => prev.device_id === p.device_id) && confirming?.device_id !== p.device_id,
        )
        if (unseen) setConfirming(unseen)
      } catch { /* 静默 */ }
    }
    const timer = setInterval(poll, 2500)
    return () => { alive = false; clearInterval(timer) }
  }, [url, confirming, issued.pending])

  // 生成二维码：axcrew://pair?host=<address>&code=<配对码>（只含临时配对码，不含设备凭证）
  useEffect(() => {
    if (!pairing || pairingExpired || !url) { setQr(''); return }
    let alive = true
    const content = `axcrew://pair?host=${encodeURIComponent(url)}&code=${encodeURIComponent(pairing.code)}`
    QRCode.toDataURL(content, {
      width: 236, margin: 1, errorCorrectionLevel: 'M',
      color: { dark: '#2c2935', light: '#ffffff' },
    }).then((data) => { if (alive) setQr(data) }).catch(() => { if (alive) setQr('') })
    return () => { alive = false }
  }, [pairing, pairingExpired, url])

  const issue = async () => {
    setRefreshing(true)
    try {
      const result = await endpoints.issuePairing()
      setPairing({ code: result.code, short_code: result.short_code, expires_at: result.expires_at })
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : translate("copy.410"))
    } finally { setRefreshing(false) }
  }

  const confirm = async (id: string) => {
    try { await endpoints.confirmAuthorization(id); setConfirming(null); void loadAuthorizations() }
    catch (cause) { setError(cause instanceof Error ? cause.message : translate("copy.411")) }
  }
  const deny = async (id: string) => {
    try { await endpoints.denyAuthorization(id); setConfirming(null); void loadAuthorizations() }
    catch (cause) { setError(cause instanceof Error ? cause.message : translate("copy.412")) }
  }
  const revoke = async (id: string) => {
    if (!window.confirm(translate("copy.413"))) return
    try { await endpoints.revokeAuthorization(id); void loadAuthorizations() }
    catch (cause) { setError(cause instanceof Error ? cause.message : translate("copy.414")) }
  }
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text) } catch { /* 忽略 */ } }

  const onlineNow = 60 * 1000
  const authorizedCount = issued.authorized.length
  const pendingCount = issued.pending.length
  const deviceTypeIcon = (platform: string) => /android|ios|phone/i.test(platform) ? <Smartphone size={14} /> : <Monitor size={14} />

  return <section className="settings-card connect-card">
    {/* 连接方式切换 */}
    <div className="connect-mode-tabs" role="tablist" aria-label={translate("copy.415")}>
      <button type="button" role="tab" aria-selected={mode === 'lan'} className={mode === 'lan' ? 'active' : ''} onClick={() => setMode('lan')}><Wifi size={14} /> {translate("copy.416")}</button>
      <button type="button" role="tab" aria-selected={mode === 'remote'} className={mode === 'remote' ? 'active' : ''} onClick={() => setMode('remote')}><Globe size={14} /> {translate("copy.417")}</button>
    </div>

    {mode === 'lan' ? (
      <div className="connect-lan">
        {/* 左：二维码（主连接方式） */}
        <div className="connect-qr">
          <div className={qr ? 'connect-qr-frame' : 'connect-qr-frame placeholder'}>
            {qr
              ? <img src={qr} alt={translate("copy.418")} />
              : <div className="connect-qr-placeholder"><QrCode size={30} /><p>{translate("copy.419")}</p></div>}
          </div>
          {pairing && !pairingExpired
            ? <p className="connect-qr-hint"><ShieldCheck size={13} /> {translate("copy.420")}{fmtCountdown(remaining)} {translate("copy.421")}</p>
            : <p className="connect-qr-sub">{translate("copy.422")}</p>}
        </div>

        {/* 右：配对信息 */}
        <div className="connect-manual">
          <h3>{translate("copy.423")}</h3>
          <p className="connect-desc">{translate("copy.424")}</p>

          <button type="button" className="settings-primary connect-main-btn" onClick={() => void issue()} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} /> {pairing && !pairingExpired ? translate("copy.425") : translate("copy.426")}
          </button>

          {pairing && !pairingExpired && (
            <>
              <div className="connect-pair-code">
                <span>{translate("copy.427")}</span>
                <div className="connect-field-value">
                  <code className="connect-short" title={pairing.code}>{pairing.short_code}</code>
                  <button type="button" aria-label={translate("copy.428")} title={translate("copy.428")} onClick={() => copy(pairing.code)}><Copy size={14} /></button>
                </div>
              </div>
              <div className="connect-pair-actions">
                <button type="button" className="connect-copy-btn" onClick={() => copy(`axcrew://pair?host=${encodeURIComponent(url)}&code=${encodeURIComponent(pairing.code)}`)}><Copy size={14} /> {translate("copy.429")}</button>
              </div>
            </>
          )}

          <div className="connect-field">
            <span>{translate("copy.430")}</span>
            <div className="connect-field-value">
              <code title={url}>{url || '—'}</code>
              <button type="button" aria-label={translate("copy.431")} title={translate("copy.431")} disabled={!url} onClick={() => copy(url)}><Copy size={14} /></button>
            </div>
          </div>

          {pairingExpired && pairing && <p className="connect-note">{translate("copy.432")}</p>}
        </div>
      </div>
    ) : (
      <div className="connect-remote-coming">
        <Globe size={16} /> {translate("copy.433")}</div>
    )}

    {/* 已授权设备：折叠管理 */}
    <details className="connect-issued" open={authorizedCount + pendingCount > 0}>
      <summary>
        {translate("copy.434")}<strong>{authorizedCount}</strong>{pendingCount > 0 && <span className="connect-pending-badge">{pendingCount} {translate("copy.435")}</span>}
        <span className="chev" aria-hidden="true"><ChevronRight size={14} /></span>
      </summary>
      {authorizedCount + pendingCount === 0
        ? <p className="connect-note">{translate("copy.436")}</p>
        : <ul className="connect-device-list">
            {issued.pending.map((device) => (
              <li key={device.device_id} className="connect-device pending">
                <div className="connect-device-icon">{deviceTypeIcon(device.platform)}</div>
                <div className="connect-device-main">
                  <div className="connect-device-title">{device.name || translate("copy.437")}<span className="connect-device-state pending">{translate("copy.435")}</span></div>
                  <div className="connect-device-sub">{device.platform || translate("copy.438")} · {device.device_id.slice(0, 8)}</div>
                </div>
                <div className="connect-device-actions">
                  <button type="button" className="connect-device-confirm" onClick={() => void confirm(device.device_id)}><ShieldCheck size={14} /> {translate("copy.439")}</button>
                  <button type="button" className="connect-device-deny" onClick={() => void deny(device.device_id)}>{translate("copy.440")}</button>
                </div>
              </li>
            ))}
            {issued.authorized.map((device) => {
              const online = Date.now() - device.last_active * 1000 < onlineNow
              return (
                <li key={device.device_id} className="connect-device">
                  <div className="connect-device-icon">{deviceTypeIcon(device.platform)}</div>
                  <div className="connect-device-main">
                    <div className="connect-device-title">{device.name || translate("copy.434")} <span className={`connect-device-state ${online ? 'online' : 'offline'}`}>{online ? translate("copy.441") : translate("copy.442")}</span></div>
                    <div className="connect-device-sub">
                      {device.platform || translate("copy.438")} {translate("copy.443")}{fmtStamp(device.created_at)}
                      {device.last_active > 0 && <span> {translate("copy.444")}{fmtStamp(device.last_active)}</span>}
                    </div>
                  </div>
                  <div className="connect-device-actions">
                    <button type="button" className="connect-device-revoke" title={translate("copy.445")} onClick={() => void revoke(device.device_id)}><Trash2 size={14} /> {translate("copy.446")}</button>
                  </div>
                </li>
              )
            })}
          </ul>}
    </details>

    {error && <p className="connect-error" role="alert">{error}</p>}

    {/* 新设备授权确认弹窗 */}
    {confirming && (
      <div className="connect-confirm-overlay" role="dialog" aria-modal="true" aria-label={translate("copy.447")}>
        <div className="connect-confirm">
          <div className="connect-confirm-icon"><ShieldAlert size={22} /></div>
          <h3>{translate("copy.448")}</h3>
          <p className="connect-confirm-name"><strong>{confirming.name || translate("copy.437")}</strong></p>
          <p className="connect-confirm-sub">{translate("copy.449")}{confirming.platform || translate("copy.450")} · {confirming.device_id.slice(0, 8)}</p>
          <p className="connect-confirm-desc">{translate("copy.451")}</p>
          <div className="connect-confirm-actions">
            <button type="button" className="connect-device-deny connect-confirm-deny" onClick={() => void deny(confirming.device_id)}>{translate("copy.440")}</button>
            <button type="button" className="settings-primary connect-confirm-allow" onClick={() => void confirm(confirming.device_id)}><ShieldCheck size={15} /> {translate("copy.439")}</button>
          </div>
        </div>
      </div>
    )}
  </section>
}
