import { useRef, useState } from 'react'
import { CHAT_MIN, DEFAULT_SPLIT, clampSplit, type WorkspaceLayout } from '../lib/workspaceLayout'
import { useLang } from '../lib/i18n'

export function WorkspaceSplitter({ layout, onRatio }: { layout: WorkspaceLayout; onRatio: (ratio: number) => void }) {
  const zh = useLang(state => state.lang) === 'zh', [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, width: 0, scale: 1 })
  const apply = (width: number) => onRatio(clampSplit(width / layout.splitWidth, layout.splitWidth, layout.rightMin) / layout.splitWidth)
  return <div role="separator" tabIndex={0} className={`workspace-splitter ${dragging ? 'is-dragging' : ''}`} aria-label={zh ? '调整聊天与文件面板宽度' : 'Resize chat and preview panels'} aria-orientation="vertical" aria-valuemin={layout.rightMin} aria-valuemax={Math.min(980, layout.splitWidth - CHAT_MIN)} aria-valuenow={Math.round(layout.rightWidth)} title={zh ? '拖动调整宽度，双击恢复默认' : 'Drag to resize; double-click to restore defaults'}
    onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
      const host = event.currentTarget.parentElement!
      start.current = { x: event.clientX, width: layout.rightWidth, scale: host.getBoundingClientRect().width / host.offsetWidth || 1 }
      setDragging(true)
    }}
    onPointerMove={event => { if (dragging) apply(start.current.width + (start.current.x - event.clientX) / start.current.scale) }}
    onPointerUp={event => { if (dragging) { setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId) } }}
    onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)}
    onDoubleClick={() => onRatio(DEFAULT_SPLIT)}
    onKeyDown={event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) {
        event.preventDefault()
        if (event.key === 'Enter') onRatio(DEFAULT_SPLIT)
        else apply(event.key === 'Home' ? layout.rightMin : event.key === 'End' ? layout.splitWidth - CHAT_MIN : layout.rightWidth + (event.key === 'ArrowLeft' ? 20 : -20))
      }
    }}/>
}
