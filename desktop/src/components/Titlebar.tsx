import { useEffect, useState, type MouseEvent } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Activity, ArrowLeft, ArrowRight, Bell, Copy, Lightbulb, Link2, Menu, Minus, ScanLine, Square, X } from 'lucide-react'
import type { ConnectionStatus } from '../lib/live'

type Props = {
  connection: ConnectionStatus
  backendUnavailable: boolean
  permissionCount: number
  sidebarExpanded: boolean
  canGoBack: boolean
  canGoForward: boolean
  focus: boolean
  hidden: boolean
  onFocus: () => void
  onMenu: () => void
  onBack: () => void
  onForward: () => void
  onCommand: () => void
  onRunningTasks: () => void
  onDevices: () => void
  onPermissions: () => void
  onNotifications: () => void
}

const desktopWindow = isTauri() ? getCurrentWindow() : null

export function Titlebar({connection,backendUnavailable,permissionCount,sidebarExpanded,canGoBack,canGoForward,focus,hidden,onFocus,onMenu,onBack,onForward,onCommand,onRunningTasks,onDevices,onPermissions,onNotifications}: Props) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!desktopWindow) return
    let disposed = false
    let removeListeners: (() => void)[] = []
    const syncMaximized = () => {
      void desktopWindow.isMaximized().then(value => {
        if (!disposed) setMaximized(value)
      }).catch(console.error)
    }
    syncMaximized()
    void Promise.all([desktopWindow.onResized(syncMaximized), desktopWindow.onScaleChanged(syncMaximized)])
      .then(listeners => {
        if (disposed) listeners.forEach(remove => remove())
        else removeListeners = listeners
      }).catch(console.error)
    return () => {
      disposed = true
      removeListeners.forEach(remove => remove())
    }
  }, [])

  const toggleMaximized = () => {
    if (!desktopWindow) return
    void desktopWindow.toggleMaximize().then(() => desktopWindow.isMaximized()).then(setMaximized).catch(console.error)
  }
  const handleTitlebarMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (!desktopWindow || event.button !== 0 || (event.target as HTMLElement).closest('button, input, [data-no-drag]')) return
    if (event.detail === 2) toggleMaximized()
    else void desktopWindow.startDragging().catch(console.error)
  }
  const connected = connection === 'Connected' && !backendUnavailable

  return <header className="shell-titlebar" onMouseDown={handleTitlebarMouseDown} inert={hidden||undefined} aria-label="AX Crew window titlebar">
    <div className="shell-titlebar-left">
      <button className="shell-icon-button" aria-label={sidebarExpanded?'收起主导航':'展开主导航'} aria-expanded={sidebarExpanded} title={sidebarExpanded?'收起主导航':'展开主导航'} onClick={onMenu}><Menu size={18}/></button>
      <button className="shell-icon-button" aria-label="返回" title="返回" disabled={!canGoBack} onClick={onBack}><ArrowLeft size={18}/></button>
      <button className="shell-icon-button" aria-label="前进" title="前进" disabled={!canGoForward} onClick={onForward}><ArrowRight size={18}/></button>
    </div>
    <div className="shell-titlebar-center">
      <button className="shell-command-input" aria-label="运行命令" onClick={onCommand}>运行命令</button>
      <button className="shell-icon-button shell-scan-button" aria-label={focus?'退出专注模式':'进入专注模式'} aria-pressed={focus} title={focus?'退出专注模式':'进入专注模式'} onClick={onFocus}><ScanLine size={18}/></button>
    </div>
    <div className="shell-titlebar-right">
      <div className="shell-connection" title={backendUnavailable ? 'Backend unavailable' : connection}>
        <span className={`shell-connection-dot ${connected ? 'is-connected' : ''}`}/>
        <button className="shell-connection-action" aria-label="Running tasks" title="Running tasks" onClick={onRunningTasks}><Activity size={16}/></button>
        <button className="shell-connection-action" aria-label="Devices" title="Devices" onClick={onDevices}><Link2 size={16}/></button>
      </div>
      <button className="shell-feature-button" aria-label={`Permissions${permissionCount ? `, ${permissionCount} pending` : ''}`} title="Permissions" onClick={onPermissions}><Lightbulb size={17}/><span className="shell-permissions-label">操作授权</span>{permissionCount > 0 && <span className="shell-count">{permissionCount}</span>}</button>
      <button className="shell-icon-button shell-notification-button" aria-label="Notifications" title="Notifications" onClick={onNotifications}><Bell size={18}/></button>
      <div className="shell-window-controls" aria-label="Window controls">
        <button className="shell-window-button" aria-label="Minimize" title="Minimize" onClick={() => { void desktopWindow?.minimize().catch(console.error) }}><Minus size={16}/></button>
        <button className="shell-window-button" aria-label={maximized ? 'Restore' : 'Maximize'} title={maximized ? 'Restore' : 'Maximize'} onClick={toggleMaximized}>{maximized ? <Copy size={14}/> : <Square size={14}/>}</button>
        <button className="shell-window-button shell-close-button" aria-label="Close" title="Close" onClick={() => { void desktopWindow?.close().catch(console.error) }}><X size={18}/></button>
      </div>
    </div>
  </header>
}
