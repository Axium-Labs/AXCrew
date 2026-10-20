import { useT } from '../../lib/i18n'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Button } from './button'
import './primitives.css'

type DialogProps = {
  open: boolean
  onOpenChange: (value: boolean) => void
  title: string
  children: ReactNode
  wide?: boolean
  closeLabel?: string
  className?: string
  /** Custom layouts own their scrolling body and footer, e.g. multi-step wizards. */
  layout?: 'default' | 'custom'
  onCloseAutoFocus?: (event: Event) => void
}

export function Dialog({ open, onOpenChange, title, children, wide = false, closeLabel, className, layout = 'default', onCloseAutoFocus }: DialogProps) {
  const t = useT()
  const id = useId()
  const content = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => {
    if (open) return
    const rememberFocus = () => {
      const active = document.activeElement
      // React's autoFocus runs before the closed-dialog listener is removed.
      if (active instanceof HTMLElement && active.closest('[data-ax-modal]')?.getAttribute('data-ax-modal') !== id) previousFocus.current = active
    }
    rememberFocus()
    document.addEventListener('focusin', rememberFocus)
    return () => document.removeEventListener('focusin', rememberFocus)
  }, [open, id])
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ax-overlay ax-modal-overlay" />
      <DialogPrimitive.Content ref={content} data-ax-modal={id} aria-describedby={undefined}
        onOpenAutoFocus={event => {
          const field = Array.from(content.current?.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not(:disabled),textarea:not(:disabled),select:not(:disabled),[role="combobox"]:not([aria-disabled="true"])') ?? [])
            .find(element => element.tabIndex >= 0 && !element.closest('[hidden],[aria-hidden="true"]'))
          if (field) { event.preventDefault(); field.focus({ preventScroll: true }) }
        }}
        onCloseAutoFocus={event => {
          onCloseAutoFocus?.(event)
          if (!event.defaultPrevented && previousFocus.current?.isConnected) {
            event.preventDefault()
            previousFocus.current.focus({ preventScroll: true })
          }
        }}
        className={cn('ax-dialog ax-modal', wide && 'ax-modal-wide', layout === 'custom' && 'ax-modal-custom', className)}>
        <div className="ax-modal-header">
          <DialogPrimitive.Title className="ax-modal-title">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" className="ax-modal-close" aria-label={closeLabel ?? t('common.close')}><X size={16} /></Button>
          </DialogPrimitive.Close>
        </div>
        {layout === 'custom' ? children : <div className="ax-modal-body">{children}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}
