import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useLang } from '../lib/i18n'

export function NativeWebPreview({ id: suppliedId, url, active = true, action, onUrl }: {
  id?: string; url: string; active?: boolean
  action: { kind: string; sequence: number }; onUrl: (url: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const id = useRef(suppliedId ?? `preview-${crypto.randomUUID()}`)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const onUrlRef = useRef(onUrl)
  onUrlRef.current = onUrl
  const [error, setError] = useState(false)
  const zh = useLang(s => s.lang) === 'zh'
  const command = useCallback((action: string, extra: object = {}) => {
    const next = queue.current.then(() => invoke<string | null>('preview_browser', { id: id.current, action, ...extra }))
    queue.current = next.catch(() => {})
    return next
  }, [])

  useEffect(() => {
    let alive = true
    setError(false)
    void command('open', { url }).catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [url, command])

  useEffect(() => {
    if (!active) { void command('hide').catch(() => {}); return }
    let alive = true
    let frame = 0
    let previous = ''
    let lastPoll = 0
    async function sync() {
      if (!alive || !host.current) return
      try {
        const rect = host.current.getBoundingClientRect()
        let left = Math.max(0, rect.left), top = Math.max(0, rect.top)
        let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom)
        // Clip to the actual panel during drawer/split animations as well as the window.
        for (let parent = host.current.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent)
          const clip = parent.getBoundingClientRect()
          if (style.overflowX && style.overflowX !== 'visible') { left = Math.max(left, clip.left); right = Math.min(right, clip.right) }
          if (style.overflowY && style.overflowY !== 'visible') { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom) }
        }
        const covered = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]')].some(el => el.getClientRects().length > 0)
        const bounds = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top),
          viewportWidth: innerWidth, viewportHeight: innerHeight,
          visible: !document.hidden && !covered && !host.current.closest('[hidden], [inert]') && right > left && bottom > top }
        const key = JSON.stringify(bounds)
        if (key !== previous) { await command('bounds', { bounds }); previous = key }
        if (bounds.visible && Date.now() - lastPoll > 500) {
          lastPoll = Date.now()
          const current = await command('state')
          if (alive && current) onUrlRef.current(current)
        }
      } catch { if (alive) setError(true) }
      if (alive) frame = requestAnimationFrame(() => { void sync() })
    }
    void sync()
    return () => { alive = false; cancelAnimationFrame(frame); void command('hide').catch(() => {}) }
  }, [active, command])

  useEffect(() => () => { void command('close').catch(() => {}) }, [command])

  useEffect(() => {
    if (!action.sequence) return
    void command(action.kind).catch(() => setError(true))
  }, [action, command])
  return <div ref={host} className="web-preview-native">
    {error && <p role="alert">{zh ? '浏览器视图未能启动，请返回起始页后重试。' : 'The browser view could not start. Return to the start page and retry.'}</p>}
  </div>
}
