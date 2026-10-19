import { useState } from 'react'
import { Globe, RotateCw, ArrowRight } from 'lucide-react'
import { useLang } from '../lib/i18n'
import type { SessionLine } from '../lib/sessionTranscript'
import './web-preview-panel.css'

export function previewUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || ['tauri.localhost', 'asset.localhost'].includes(url.hostname)
      || url.origin === window.location.origin) return null
    return url.href
  } catch { return null }
}

export function WebPreviewPanel({ sessionKey, lines, remote, onInspect }: {
  sessionKey: string; lines: SessionLine[]; remote: boolean; onInspect: (url: string) => void
}) {
  const zh = useLang(state => state.lang) === 'zh'
  const [address, setAddress] = useState('')
  const [url, setUrl] = useState('')
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState(false)
  const suggestions = [...new Set(lines.flatMap(line =>
    `${line.text}\n${line.output ?? ''}`.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s<>"'`]*)?/g) ?? []
  ).map(value => previewUrl(value.replace(/[),.;]+$/, ''))).filter((value): value is string => !!value))].slice(-5)
  function navigate(value: string) {
    const next = previewUrl(value)
    setError(!next)
    if (next) { setAddress(next); setUrl(next); setRevision(value => value + 1) }
  }
  return <section className="web-preview-panel" aria-label={zh ? '网页预览' : 'Web preview'}>
    <form className="web-preview-toolbar" onSubmit={event => { event.preventDefault(); navigate(address) }}>
      <Globe size={16}/><input aria-label={zh ? '预览地址' : 'Preview URL'} placeholder="http://localhost:5173" value={address} onChange={event => setAddress(event.target.value)}/>
      <button type="submit" title={zh ? '打开预览' : 'Open preview'} aria-label={zh ? '打开预览' : 'Open preview'}><ArrowRight size={16}/></button>
      <button type="button" disabled={!url} title={zh ? '刷新' : 'Reload'} aria-label={zh ? '刷新' : 'Reload'} onClick={() => setRevision(value => value + 1)}><RotateCw size={16}/></button>
    </form>
    {error && <p role="alert">{zh ? '请输入有效的 HTTP 或 HTTPS 网页地址。' : 'Enter a valid HTTP or HTTPS page URL.'}</p>}
    {!!suggestions.length && <div className="web-preview-suggestions">{suggestions.map(value => <button key={value} onClick={() => navigate(value)} title={value}>{value}</button>)}</div>}
    {url ? <>
      <div className="web-preview-actions"><span>{zh ? '页面可交互 · 支持开发服务器热更新' : 'Interactive page · dev-server live updates'}</span><button onClick={() => onInspect(url)}>{zh ? '让 AX 检查' : 'Ask AX to inspect'}</button></div>
      <iframe key={`${sessionKey}:${revision}`} src={url} title={zh ? '网页预览内容' : 'Web preview content'} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer"/>
      <p className="web-preview-note">{zh ? '若页面拒绝嵌入或无法连接，请检查开发服务及页面的嵌入策略。AX 检查会打开独立浏览器，不共享此处的登录与点击状态。' : 'If the page cannot load, check the dev server and embedding policy. AX inspects in a separate browser, without this view’s login or interaction state.'}</p>
    </> : <div className="web-preview-empty"><Globe size={30}/><h3>{zh ? '边修改，边查看' : 'See changes as you work'}</h3><p>{zh ? '启动项目的开发服务，然后输入地址或选择会话中发现的本地网址。' : 'Start your project’s dev server, then enter its URL or choose a local URL found in the conversation.'}</p></div>}
    {remote && <p className="web-preview-note">{zh ? '远程项目请使用本机可访问的地址或已转发的端口；localhost 指这台电脑。' : 'Use a reachable address or forwarded port for remote projects; localhost refers to this computer.'}</p>}
  </section>
}
