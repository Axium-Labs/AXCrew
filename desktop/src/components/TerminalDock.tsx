import { useEffect, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, SquareTerminal, X } from 'lucide-react'
import { Menu } from './ui/menu'
import { useTerminalDock, type TerminalPosition, type TerminalTab } from '../store/terminal'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'

type Output = { id: string; data: number[] }
type Exit = { id: string }

function TerminalView({ tab, visible, theme }: { tab: TerminalTab; visible: boolean; theme: 'dark' | 'light' }) {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const [error, setError] = useState('')

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
        unlistenExit = await listen<Exit>('terminal-exit', event => { if (event.payload.id === tab.id) term.write('\r\n[终端进程已退出]\r\n') })
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
  return <div className="terminal-view" hidden={!visible}><div ref={host} className="terminal-screen"/>{error&&<div className="terminal-error" role="alert">{error}</div>}{!isTauri()&&<div className="terminal-error">终端仅在 AX Crew 桌面应用中可用。</div>}</div>
}

export function TerminalDock({ cwd, theme }: { cwd?: string; theme: 'dark' | 'light' }) {
  const { open, position, height, width, tabs, activeId, addTab, closeTab, setOpen, setActive, setPosition, setHeight, setWidth } = useTerminalDock()
  const [dragging, setDragging] = useState(false)
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
  const dimension = position === 'bottom' ? { height: open ? Math.min(height, window.innerHeight * .72) : 0 } : { width: open ? Math.min(width, window.innerWidth * .55) : 0 }
  return <section className={`terminal-dock is-${position} ${open ? 'is-open' : ''} ${dragging ? 'is-dragging' : ''}`} style={dimension} aria-label="终端面板" aria-hidden={!open}>
    <div className="terminal-dock-inner" style={position === 'bottom' ? { height: Math.min(height, window.innerHeight * .72) } : { width: Math.min(width, window.innerWidth * .55) }}>
      <div className="terminal-resize" role="separator" aria-label="调整终端面板大小" aria-orientation={position === 'bottom' ? 'horizontal' : 'vertical'} onPointerDown={startResize}/>
      <div className="terminal-panel-body">
        <div className="terminal-tabs" role="tablist" aria-label="终端标签">
          {tabs.map((tab, index) => <div className={`terminal-tab ${activeId === tab.id ? 'is-active' : ''}`} key={tab.id}><button role="tab" aria-selected={activeId === tab.id} onClick={() => setActive(tab.id)}><SquareTerminal size={14}/><span>{tabs.length === 1 ? '终端' : `终端 ${index + 1}`}</span></button><button aria-label={`关闭终端 ${index + 1}`} title="关闭终端" onClick={() => close(tab.id)}><X size={13}/></button></div>)}
          <button className="terminal-tool" title="新建终端" aria-label="新建终端" disabled={tabs.length >= 8} onClick={() => addTab(cwd)}><Plus size={17}/></button>
          <div className="terminal-tab-spacer"/>
          <Menu trigger={<button className="terminal-tool" title="终端布局" aria-label="终端布局"><MoreHorizontal size={17}/></button>} items={[{ label: position === 'bottom' ? '移到右侧' : '移到底部', action: () => setPosition(position === 'bottom' ? 'right' : 'bottom') }]}/>
          <button className="terminal-tool" title="隐藏终端" aria-label="隐藏终端" onClick={() => setOpen(false)}>{position === 'bottom' ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}</button>
        </div>
        <div className="terminal-views">{tabs.map(tab => <TerminalView key={tab.id} tab={tab} visible={activeId === tab.id} theme={theme}/>)}</div>
      </div>
    </div>
  </section>
}

export function terminalDockClass(position: TerminalPosition) { return position === 'right' ? 'has-terminal-right' : '' }
