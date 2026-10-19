import { useEffect, useRef, useState } from 'react'
import { Globe, RotateCw, ArrowRight, ArrowLeft, Search, Home, ArrowUpRight, Plus, X } from 'lucide-react'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { NativeWebPreview } from './NativeWebPreview'
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

export function resolvePreviewAddress(value: string): string | null {
  const input = value.trim()
  if (!input) return null
  const host = /^(?:localhost|(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+|\[[\da-f:]+\])(?::\d+)?(?:[/?#][^\s]*)?$/iu
  if (host.test(input)) {
    const local = /^(?:localhost|127\.|\[::1\])(?=[:/?#]|$)/i.test(input) || input.startsWith('127.')
    return previewUrl(`${local ? 'http' : 'https'}://${input}`)
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(input) || input.startsWith('//')) return previewUrl(input)
  return `https://www.bing.com/search?q=${encodeURIComponent(input)}`
}

type BrowserTab = {
  id: string; url: string; currentUrl: string; address: string; title: string
  revision: number; error: boolean; action: { kind: string; sequence: number }
}

function newTab(url = ''): BrowserTab {
  return { id: `preview-${crypto.randomUUID()}`, url, currentUrl: url, address: url, title: '', revision: 0, error: false, action: { kind: 'reload', sequence: 0 } }
}

export function WebPreviewPanel({ sessionKey, lines, remote, onInspect }: {
  sessionKey: string; lines: SessionLine[]; remote: boolean; onInspect: (url: string) => void
}) {
  const zh = useLang(state => state.lang) === 'zh'
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [newTab()])
  const [activeId, setActiveId] = useState('')
  const [focused, setFocused] = useState(false)
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0]
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const native = isTauri()
  const inputRef = useRef<HTMLInputElement>(null)
  const placeholder = zh ? '搜索或输入网址' : 'Search or enter a URL'
  useEffect(() => {
    document.getElementById(`${active.id}-tab`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active.id])
  function updateTab(id: string, update: Partial<BrowserTab> | ((tab: BrowserTab) => Partial<BrowserTab>)) {
    setTabs(tabs => {
      let changed = false
      const next = tabs.map(tab => {
        if (tab.id !== id) return tab
        const patch = typeof update === 'function' ? update(tab) : update
        if (Object.entries(patch).every(([key, value]) => tab[key as keyof BrowserTab] === value)) return tab
        changed = true
        return { ...tab, ...patch }
      })
      return changed ? next : tabs
    })
  }
  function addTab(url = '') {
    const tab = newTab(url)
    setTabs(tabs => [...tabs, tab])
    setActiveId(tab.id)
    if (!url) inputRef.current?.focus()
  }
  function closeTab(id: string) {
    const index = tabs.findIndex(tab => tab.id === id)
    if (tabs.length === 1) {
      const tab = newTab()
      setTabs([tab]); setActiveId(tab.id)
    } else {
      setTabs(tabs => tabs.filter(tab => tab.id !== id))
      if (active.id === id) setActiveId(tabs[index + 1]?.id ?? tabs[index - 1].id)
    }
  }
  useEffect(() => {
    if (!native) return
    let disposed = false
    const registrations = [
      listen<{ source: string; url: string }>('preview-browser-new-tab', ({ payload }) => {
        if (disposed || !tabsRef.current.some(tab => tab.id === payload.source)) return
        const url = previewUrl(payload.url)
        if (url) addTab(url)
      }),
      listen<{ id: string; title: string }>('preview-browser-title', ({ payload }) => {
        if (!disposed) updateTab(payload.id, { title: payload.title })
      }),
    ]
    const removers: (() => void)[] = []
    for (const registration of registrations) void registration.then(remove => { if (disposed) remove(); else removers.push(remove) }).catch(console.error)
    return () => { disposed = true; removers.forEach(remove => remove()) }
  }, [native])
  const suggestions = [...new Set(lines.flatMap(line =>
    `${line.text}\n${line.output ?? ''}`.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s<>"'`]*)?/g) ?? []
  ).map(value => previewUrl(value.replace(/[),.;]+$/, ''))).filter((value): value is string => !!value))].slice(-5)
  function navigate(value: string) {
    if (!value.trim()) return
    const next = resolvePreviewAddress(value)
    if (!next) { updateTab(active.id, { error: true }); return }
    updateTab(active.id, tab => ({ address: next, currentUrl: next, url: next, title: '', error: false, revision: tab.revision + 1,
      action: next === tab.url ? { kind: 'reload', sequence: tab.action.sequence + 1 } : tab.action }))
    inputRef.current?.blur()
  }
  function browserAction(kind: string) {
    updateTab(active.id, tab => ({ revision: kind === 'reload' ? tab.revision + 1 : tab.revision, action: { kind, sequence: tab.action.sequence + 1 } }))
  }
  function tabTitle(tab: BrowserTab) {
    if (tab.title) return tab.title
    return tab.currentUrl ? new URL(tab.currentUrl).hostname : (zh ? '新标签页' : 'New tab')
  }
  return <section className="web-preview-panel" aria-label={zh ? '网页预览' : 'Web preview'}>
    <div className="web-preview-tabbar">
      <div className="web-preview-tabs" role="tablist" aria-label={zh ? '网页标签' : 'Browser tabs'} onKeyDown={event => {
        if (!(event.target as HTMLElement).closest('[role="tab"]')) return
        const index = tabs.findIndex(tab => tab.id === active.id)
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
        if (next < 0) return
        event.preventDefault(); setActiveId(tabs[next].id)
        document.getElementById(`${tabs[next].id}-tab`)?.focus()
      }}>
        {tabs.map(tab => <div className={`web-preview-tab${tab.id === active.id ? ' is-active' : ''}`} key={tab.id}>
          <button type="button" role="tab" id={`${tab.id}-tab`} tabIndex={tab.id === active.id ? 0 : -1} aria-controls={`${tab.id}-page`} aria-selected={tab.id === active.id} title={tab.currentUrl || tabTitle(tab)} onClick={() => setActiveId(tab.id)}><Globe size={13}/><span>{tabTitle(tab)}</span></button>
          <button type="button" className="web-preview-tab-close" aria-label={`${zh ? '关闭标签页' : 'Close tab'} ${tabTitle(tab)}`} onClick={() => closeTab(tab.id)}><X size={12}/></button>
        </div>)}
      </div>
      <button type="button" className="web-preview-new-tab" aria-label={zh ? '新建标签页' : 'New tab'} title={zh ? '新建标签页' : 'New tab'} onClick={() => addTab()}><Plus size={16}/></button>
    </div>
    <form className="web-preview-toolbar" onSubmit={event => { event.preventDefault(); navigate(active.address) }}>
      <div className="web-preview-navigation">
        <button type="button" disabled={!active.url || !native} aria-label={zh ? '后退' : 'Back'} title={zh ? '后退' : 'Back'} onClick={() => browserAction('back')}><ArrowLeft size={16}/></button>
        <button type="button" disabled={!active.url || !native} aria-label={zh ? '前进' : 'Forward'} title={zh ? '前进' : 'Forward'} onClick={() => browserAction('forward')}><ArrowRight size={16}/></button>
        <button type="button" disabled={!active.url} title={zh ? '刷新' : 'Reload'} aria-label={zh ? '刷新' : 'Reload'} onClick={() => browserAction('reload')}><RotateCw size={16}/></button>
      </div>
      <button type="button" title={zh ? '起始页' : 'Start page'} aria-label={zh ? '起始页' : 'Start page'} disabled={!active.url} onClick={() => { updateTab(active.id, { url: '', currentUrl: '', address: '', title: '', action: { kind: 'reload', sequence: 0 }, error: false }); inputRef.current?.focus() }}><Home size={16}/></button>
      <div className="web-preview-address"><Search size={15}/><input ref={inputRef} aria-label={placeholder} placeholder={focused ? '' : placeholder} value={active.address} autoComplete="off" spellCheck={false} onFocus={event => { setFocused(true); event.target.select() }} onBlur={() => setFocused(false)} onChange={event => updateTab(active.id, { address: event.target.value, error: false })}/>
        <button type="submit" disabled={!active.address.trim()} title={zh ? '前往' : 'Go'} aria-label={zh ? '前往' : 'Go'}><ArrowRight size={15}/></button>
      </div>
    </form>
    {active.error && <p role="alert">{zh ? '无法打开该地址，请使用不含登录凭据的 HTTP 或 HTTPS 网址。' : 'Use an HTTP or HTTPS URL without embedded credentials.'}</p>}
    {active.url && <div className="web-preview-actions"><span>{zh ? '网页浏览' : 'Browser'}</span><button onClick={() => onInspect(active.currentUrl || active.url)}>{zh ? '让 AX 检查' : 'Ask AX to inspect'}<ArrowUpRight size={13}/></button></div>}
    {tabs.map(tab => <div key={tab.id} id={`${tab.id}-page`} role="tabpanel" aria-labelledby={`${tab.id}-tab`} hidden={tab.id !== active.id} className="web-preview-page">
      {tab.url ? <>
        {native ? <NativeWebPreview id={tab.id} url={tab.url} active={tab.id === active.id} action={tab.action} onUrl={value => {
          if (!previewUrl(value)) return
          updateTab(tab.id, old => value === old.currentUrl ? {} : { currentUrl: value, ...(document.activeElement === inputRef.current && tab.id === active.id ? {} : { address: value }) })
        }}/>
          : <iframe key={`${sessionKey}:${tab.revision}`} src={tab.url} title={zh ? '网页预览内容' : 'Web preview content'} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer"/>}
        {!native && <p className="web-preview-note">{zh ? '浏览器调试版受网站嵌入限制。请在 AX Crew 桌面端浏览，或' : 'Web development mode is limited by embedding policies. Use AX Crew desktop, or '}<a href={tab.currentUrl || tab.url} target="_blank" rel="noopener noreferrer">{zh ? '在新标签页打开' : 'open in a new tab'}</a></p>}
      </> : <div className="web-preview-start">
      <div className="web-preview-empty"><div className="web-preview-emblem"><Globe size={25} strokeWidth={1.5}/></div><h3>{zh ? '从这里开始浏览' : 'A place to start browsing'}</h3><p>{zh ? '查找资料，打开网页，或预览正在构建的作品。' : 'Find something, open a page, or preview what you’re building.'}</p>
      </div>
      {!!suggestions.length && <div className="web-preview-suggestions"><h4>{zh ? '会话中的本地服务' : 'Local servers in this conversation'}</h4>{suggestions.map(value => <button key={value} onClick={() => navigate(value)} title={value}><Globe size={15}/><span>{value}</span><ArrowUpRight size={14}/></button>)}</div>}
      </div>}
    </div>)}
    {remote && <p className="web-preview-note">{zh ? '远程项目请使用本机可访问的地址或已转发的端口；localhost 指这台电脑。' : 'Use a reachable address or forwarded port for remote projects; localhost refers to this computer.'}</p>}
  </section>
}
