import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { MoreHorizontal } from 'lucide-react'
import { useLang } from '../lib/i18n'

/** Measure the form, including side chat, rather than the viewport. */
export function ComposerSecondaryActions({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null), [compact, setCompact] = useState(false)
  const zh = useLang(state => state.lang) === 'zh'
  useLayoutEffect(() => {
    const form = ref.current?.closest('form')
    if (!form) return
    const measure = () => { if (form.clientWidth > 0) setCompact(form.clientWidth < 600) }
    measure()
    const observer = new ResizeObserver(measure); observer.observe(form)
    return () => observer.disconnect()
  }, [])
  return <div ref={ref} className="session-composer-secondary">
    {compact ? <Popover.Root><Popover.Trigger asChild><button type="button" className="session-composer-icon" aria-label={zh ? '更多输入操作' : 'More composer actions'}><MoreHorizontal size={19}/></button></Popover.Trigger>
      <Popover.Portal><Popover.Content className="composer-more-actions" side="top" align="start" sideOffset={8} collisionPadding={12} onEscapeKeyDown={event => event.stopPropagation()}>{children}</Popover.Content></Popover.Portal>
    </Popover.Root> : children}
  </div>
}
