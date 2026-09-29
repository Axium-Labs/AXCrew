import { useEffect, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, SquareTerminal, X } from 'lucide-react'
import { Menu } from './ui/menu'
import { useTerminalDock, type TerminalPosition, type TerminalTab } from '../store/terminal'
import { useT, translate } from '../lib/i18n'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'

type Output = { id: string; data: number[] }
type Exit = { id: string }

function TerminalView({ tab, visible, theme }: { tab: TerminalTab; visible: boolean; theme: 'dark' | 'light' }) {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const [error, setError] = useState('')
  const t = useT()

  useEffect(() => {
    if (!host.current || !isTauri()) return
    const term = new Terminal({ cursorBlink: true, convertEol: false, fontFamily: 'Cascadia Mono, Consolas, monospace', fontSize: 13, scrollback: 4000, theme: theme === 'dark' ? { background: '#191d26', foreground: '#e7e9ef', cursor: '#b283ff' } : { background: '#ffffff', foreground: '#383643', cursor: '#8f3dff' } })
    const addon = new FitAddon()
    term.loadAddon(addon)
    term.open(host.current)
    terminal.current = term
    fit.current = addon
    let disposed = false
    let ready = false
    let unlistenOutput: (() => void) | undefined
    let unlistenExit: (() => void) | undefined
    const fitToHost = () => {
      if (!host.current || host.current.clientWidth < 20 || host.current.clientHeight < 20) return
      try { addon.fit() } catch { return }
      if (ready) void invoke('terminal_resize', { id: tab.id, cols: term.cols, rows: term.rows }).catch(() => {})
    }
    const observer = new ResizeObserver(fitToHost)
    observer.observe(host.current)
    const input = term.onData(data => { if (ready) void invoke('terminal_write', { id: tab.id, data }).catch(setError) })
    void (async () => {
      try {
        unlistenOutput = await listen<Output>('terminal-output', event => { if (event.payload.id === tab.id) term.write(new Uint8Array(event.payload.data)) })
        if (disposed) { unlistenOutput(); return }
        unlistenExit = await listen<Exit>('terminal-exit', event => { if (event.payload.id === tab.id) term.write(`\r\n${translate('terminal.exited')}\r\n`) })
        if (disposed) { unlistenOutput(); unlistenExit(); return }
        fitToHost()
        await invoke('terminal_create', { id: tab.id, cwd: tab.cwd, cols: term.cols, rows: term.rows })
        ready = true
        fitToHost()
        if (tab.initialCommand) await invoke('terminal_write', { id: tab.id, data: `${tab.initialCommand}\r` })
      } catch (cause) { if (!disposed) setError(String(cause)) }
    })()
    return () => {
      disposed = true
      observer.disconnect()
      input.dispose()
      unlistenOutput?.()
      unlistenExit?.()
      terminal.current = null
      fit.current = null
      term.dispose()
    }
  }, [tab.id, tab.cwd, tab.initialCommand])

  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = theme === 'dark' ? { background: '#191d26', foreground: '#e7e9ef', cursor: '#b283ff' } : { background: '#ffffff', foreground: '#383643', cursor: '#8f3dff' }
  }, [theme])
  useEffect(() => { if (visible) { const frame = requestAnimationFrame(() => { fit.current?.fit(); terminal.current?.focus() }); return () => cancelAnimationFrame(frame) } }, [visible])
  return <div className="terminal-view" hidden={!visible}><div ref={host} className="terminal-screen"/>{error&&<div className="terminal-error" role="alert">{error}</div>}{!isTauri()&&<div className="terminal-error">{t('terminal.desktopOnly')}</div>}</div>
}

export function TerminalDock({ cwd, theme }: { cwd?: string; theme: 'dark' | 'light' }) {
  const { open, position, height, width, tabs, activeId, addTab, closeTab, reorderTab, setOpen, setActive, setPosition, setHeight, setWidth } = useTerminalDock()
  const [dragging, setDragging] = useState(false)
  const [draggedTab, setDraggedTab] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const t = useT()
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const starting = { x: event.clientX, y: event.clientY, height, width }
    setDragging(true)
    const move = (next: PointerEvent) => {
      if (position === 'bottom') setHeight(Math.min(window.innerHeight * .72, starting.height + starting.y - next.clientY))
      else setWidth(Math.min(window.innerWidth * .55, starting.width + starting.x - next.clientX))
    }
    const stop = () => { setDragging(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); window.removeEventListener('blur', stop); document.body.style.cursor = ''; document.body.style.userSelect = '' }
    document.body.style.cursor = position === 'bottom' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
    window.addEventListener('blur', stop, { once: true })
  }
  const close = (id: string) => { if (isTauri()) void invoke('terminal_close', { id }).catch(console.error); closeTab(id) }
  const endTabDrag = () => { setDraggedTab(null); setDropTarget(null) }
  const dropTab = (target: string) => {
    if (draggedTab) reorderTab(draggedTab, target)
    endTabDrag()
  }
  const dimension = position === 'bottom' ? { height: open ? Math.min(height, window.innerHeight * .72) : 0 } : { width: open ? Math.min(width, window.innerWidth * .55) : 0 }
  return <section className={`terminal-dock is-${position} ${open ? 'is-open' : ''} ${dragging ? 'is-dragging' : ''}`} style={dimension} aria-label={t('terminal.panel')} aria-hidden={!open}>
    <div className="terminal-dock-inner" style={position === 'bottom' ? { height: Math.min(height, window.innerHeight * .72) } : { width: Math.min(width, window.innerWidth * .55) }}>
      <div className="terminal-resize" role="separator" aria-label={t('terminal.resize')} aria-orientation={position === 'bottom' ? 'horizontal' : 'vertical'} onPointerDown={startResize}/>
      <div className="terminal-panel-body">
        <div className="terminal-tabs" role="tablist" aria-label={t('terminal.tabs')}>
          {tabs.map(tab => <div
            className={`terminal-tab ${activeId === tab.id ? 'is-active' : ''} ${draggedTab === tab.id ? 'is-dragging' : ''} ${dropTarget === tab.id ? 'is-drop-target' : ''}`}
            key={tab.id}
            title={t('terminal.reorder')}
            draggable
            onDragStart={event => { setDraggedTab(tab.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', tab.id) }}
            onDragOver={event => { if (!draggedTab || draggedTab === tab.id) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(tab.id) }}
            onDragLeave={() => setDropTarget(current => current === tab.id ? null : current)}
            onDrop={event => { event.preventDefault(); dropTab(tab.id) }}
            onDragEnd={endTabDrag}
          >
            <button role="tab" aria-selected={activeId === tab.id} onClick={() => setActive(tab.id)}><SquareTerminal size={14}/><span>{t('terminal.title')}</span></button>
            <button aria-label={t('terminal.closeTab', { name: t('terminal.title') })} title={t('terminal.close')} onClick={() => close(tab.id)}><X size={13}/></button>
          </div>)}
          <button className="terminal-tool" title={t('terminal.new')} aria-label={t('terminal.new')} disabled={tabs.length >= 8} onClick={() => addTab(cwd)}><Plus size={17}/></button>
          <div className="terminal-tab-spacer"/>
          <Menu trigger={<button className="terminal-tool" title={t('terminal.layout')} aria-label={t('terminal.layout')}><MoreHorizontal size={17}/></button>} items={[{ label: position === 'bottom' ? t('terminal.moveRight') : t('terminal.moveBottom'), action: () => setPosition(position === 'bottom' ? 'right' : 'bottom') }]}/>
          <button className="terminal-tool" title={t('terminal.hide')} aria-label={t('terminal.hide')} onClick={() => setOpen(false)}>{position === 'bottom' ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}</button>
        </div>
        <div className="terminal-views">{tabs.map(tab => <TerminalView key={tab.id} tab={tab} visible={activeId === tab.id} theme={theme}/>)}</div>
      </div>
    </div>
  </section>
}

export function terminalDockClass(position: TerminalPosition) { return position === 'right' ? 'has-terminal-right' : '' }
