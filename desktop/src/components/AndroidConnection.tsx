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
      .catch(() => { if (alive) setError('无法读取桌面 Gateway 连接') })
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
      color: { dark: '#151a24', light: '#ffffff' },
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
      setError(cause instanceof Error ? cause.message : '生成配对码失败')
    } finally { setRefreshing(false) }
  }

  const confirm = async (id: string) => {
    try { await endpoints.confirmAuthorization(id); setConfirming(null); void loadAuthorizations() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '确认失败') }
  }
  const deny = async (id: string) => {
    try { await endpoints.denyAuthorization(id); setConfirming(null); void loadAuthorizations() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '拒绝失败') }
  }
  const revoke = async (id: string) => {
    if (!window.confirm('撤销这台设备的访问？撤销后它将无法再连接 Gateway。')) return
    try { await endpoints.revokeAuthorization(id); void loadAuthorizations() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '撤销失败') }
  }
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text) } catch { /* 忽略 */ } }

  const onlineNow = 60 * 1000
  const authorizedCount = issued.authorized.length
  const pendingCount = issued.pending.length
  const deviceTypeIcon = (platform: string) => /android|ios|phone/i.test(platform) ? <Smartphone size={14} /> : <Monitor size={14} />

  return <section className="settings-card connect-card">
    {/* 连接方式切换 */}
    <div className="connect-mode-tabs" role="tablist" aria-label="连接方式">
      <button type="button" role="tab" aria-selected={mode === 'lan'} className={mode === 'lan' ? 'active' : ''} onClick={() => setMode('lan')}><Wifi size={14} /> 局域网连接</button>
      <button type="button" role="tab" aria-selected={mode === 'remote'} className={mode === 'remote' ? 'active' : ''} onClick={() => setMode('remote')}><Globe size={14} /> HTTPS / 远程连接</button>
    </div>

    {mode === 'lan' ? (
      <div className="connect-lan">
        {/* 左：二维码（主连接方式） */}
        <div className="connect-qr">
          <div className={qr ? 'connect-qr-frame' : 'connect-qr-frame placeholder'}>
            {qr
              ? <img src={qr} alt="手机扫码配对二维码" />
              : <div className="connect-qr-placeholder"><QrCode size={30} /><p>生成配对码后，可用手机扫码配对</p></div>}
          </div>
          {pairing && !pairingExpired
            ? <p className="connect-qr-hint"><ShieldCheck size={13} /> 配对码将在 {fmtCountdown(remaining)} 后失效</p>
            : <p className="connect-qr-sub">配对码 5 分钟有效、一次性使用</p>}
        </div>

        {/* 右：配对信息 */}
        <div className="connect-manual">
          <h3>连接新设备</h3>
          <p className="connect-desc">生成一次性配对码，手机扫码后请在下方授权确认。</p>

          <button type="button" className="settings-primary connect-main-btn" onClick={() => void issue()} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} /> {pairing && !pairingExpired ? '刷新配对码' : '生成配对码'}
          </button>

          {pairing && !pairingExpired && (
            <>
              <div className="connect-pair-code">
                <span>短配对码</span>
                <div className="connect-field-value">
                  <code className="connect-short" title={pairing.code}>{pairing.short_code}</code>
                  <button type="button" aria-label="复制配对码" title="复制配对码" onClick={() => copy(pairing.code)}><Copy size={14} /></button>
                </div>
              </div>
              <div className="connect-pair-actions">
                <button type="button" className="connect-copy-btn" onClick={() => copy(`axcrew://pair?host=${encodeURIComponent(url)}&code=${encodeURIComponent(pairing.code)}`)}><Copy size={14} /> 复制连接信息</button>
              </div>
            </>
          )}

          <div className="connect-field">
            <span>Gateway 地址</span>
            <div className="connect-field-value">
              <code title={url}>{url || '—'}</code>
              <button type="button" aria-label="复制地址" title="复制地址" disabled={!url} onClick={() => copy(url)}><Copy size={14} /></button>
            </div>
          </div>

          {pairingExpired && pairing && <p className="connect-note">上一个配对码已失效，请刷新重新生成。</p>}
        </div>
      </div>
    ) : (
      <div className="connect-remote-coming">
        <Globe size={16} /> HTTPS / 远程连接功能尚未开放。局域网连接已就绪，无需额外配置即可使用。
      </div>
    )}

    {/* 已授权设备：折叠管理 */}
    <details className="connect-issued" open={authorizedCount + pendingCount > 0}>
      <summary>
        已授权设备 <strong>{authorizedCount}</strong>{pendingCount > 0 && <span className="connect-pending-badge">{pendingCount} 待确认</span>}
        <span className="chev" aria-hidden="true"><ChevronRight size={14} /></span>
      </summary>
      {authorizedCount + pendingCount === 0
        ? <p className="connect-note">还没有已授权设备。生成配对码后让手机扫码，再在此确认授权。</p>
        : <ul className="connect-device-list">
            {issued.pending.map((device) => (
              <li key={device.device_id} className="connect-device pending">
                <div className="connect-device-icon">{deviceTypeIcon(device.platform)}</div>
                <div className="connect-device-main">
                  <div className="connect-device-title">{device.name || '新设备'}<span className="connect-device-state pending">待确认</span></div>
                  <div className="connect-device-sub">{device.platform || '未知平台'} · {device.device_id.slice(0, 8)}</div>
                </div>
                <div className="connect-device-actions">
                  <button type="button" className="connect-device-confirm" onClick={() => void confirm(device.device_id)}><ShieldCheck size={14} /> 允许</button>
                  <button type="button" className="connect-device-deny" onClick={() => void deny(device.device_id)}>拒绝</button>
                </div>
              </li>
            ))}
            {issued.authorized.map((device) => {
              const online = Date.now() - device.last_active * 1000 < onlineNow
              return (
                <li key={device.device_id} className="connect-device">
                  <div className="connect-device-icon">{deviceTypeIcon(device.platform)}</div>
                  <div className="connect-device-main">
                    <div className="connect-device-title">{device.name || '已授权设备'} <span className={`connect-device-state ${online ? 'online' : 'offline'}`}>{online ? '在线' : '离线'}</span></div>
                    <div className="connect-device-sub">
                      {device.platform || '未知平台'} · 首次授权 {fmtStamp(device.created_at)}
                      {device.last_active > 0 && <span> · 最后活动 {fmtStamp(device.last_active)}</span>}
                    </div>
                  </div>
                  <div className="connect-device-actions">
                    <button type="button" className="connect-device-revoke" title="撤销访问" onClick={() => void revoke(device.device_id)}><Trash2 size={14} /> 撤销</button>
                  </div>
                </li>
              )
            })}
          </ul>}
    </details>

    {error && <p className="connect-error" role="alert">{error}</p>}

    {/* 新设备授权确认弹窗 */}
    {confirming && (
      <div className="connect-confirm-overlay" role="dialog" aria-modal="true" aria-label="设备授权确认">
        <div className="connect-confirm">
          <div className="connect-confirm-icon"><ShieldAlert size={22} /></div>
          <h3>一台新设备请求连接</h3>
          <p className="connect-confirm-name"><strong>{confirming.name || '新设备'}</strong></p>
          <p className="connect-confirm-sub">平台：{confirming.platform || '未知'} · {confirming.device_id.slice(0, 8)}</p>
          <p className="connect-confirm-desc">允许后，这台设备将获得 Gateway 访问权限，可随时撤销。</p>
          <div className="connect-confirm-actions">
            <button type="button" className="connect-device-deny connect-confirm-deny" onClick={() => void deny(confirming.device_id)}>拒绝</button>
            <button type="button" className="settings-primary connect-confirm-allow" onClick={() => void confirm(confirming.device_id)}><ShieldCheck size={15} /> 允许</button>
          </div>
        </div>
      </div>
    )}
  </section>
}
