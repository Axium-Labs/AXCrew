import { useEffect, useState, type MouseEvent } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ArrowLeft, ArrowRight, Copy, Minus, ScanLine, Square, X } from 'lucide-react'
import { useLang, useT , translate} from '../lib/i18n'

type Props = {
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
}

const desktopWindow = isTauri() ? getCurrentWindow() : null

export function Titlebar({canGoBack,canGoForward,focus,hidden,onFocus,onBack,onForward,onCommand}: Props) {
  useLang(state=>state.lang);

  const [maximized, setMaximized] = useState(false)
  const t = useT()

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

  return <header className="shell-titlebar" onMouseDown={handleTitlebarMouseDown} inert={hidden||undefined} aria-label={translate("english.151")}>
    <div className="shell-titlebar-left">
      <button className="shell-icon-button" aria-label={t('titlebar.back')} title={t('titlebar.back')} disabled={!canGoBack} onClick={onBack}><ArrowLeft size={18}/></button>
      <button className="shell-icon-button" aria-label={t('titlebar.forward')} title={t('titlebar.forward')} disabled={!canGoForward} onClick={onForward}><ArrowRight size={18}/></button>

    </div>
    <div className="shell-titlebar-center">
      <button className="shell-command-input" aria-label={t('titlebar.runCommand')} onClick={onCommand}>{t('titlebar.runCommand')}</button>
      <button className="shell-icon-button shell-scan-button" aria-label={focus?t('titlebar.exitFocus'):t('titlebar.enterFocus')} aria-pressed={focus} title={focus?t('titlebar.exitFocus'):t('titlebar.enterFocus')} onClick={onFocus}><ScanLine size={18}/></button>
    </div>
    <div className="shell-titlebar-right">
      <div className="shell-window-controls" aria-label={t('titlebar.windowControls')}>
        <button className="shell-window-button" aria-label={t('titlebar.minimize')} title={t('titlebar.minimize')} onClick={() => { void desktopWindow?.minimize().catch(console.error) }}><Minus size={16}/></button>
        <button className="shell-window-button" aria-label={maximized ? t('titlebar.restore') : t('titlebar.maximize')} title={maximized ? t('titlebar.restore') : t('titlebar.maximize')} onClick={toggleMaximized}>{maximized ? <Copy size={14}/> : <Square size={14}/>}</button>
        <button className="shell-window-button shell-close-button" aria-label={t('titlebar.close')} title={t('titlebar.close')} onClick={() => { void desktopWindow?.close().catch(console.error) }}><X size={18}/></button>
      </div>
    </div>
  </header>
}
