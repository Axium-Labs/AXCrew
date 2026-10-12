import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from './button'
import { cn } from '../../lib/utils'
import './disclosure.css'

/** Shared disclosure: keyboard-accessible trigger; collapsing retains form values. */
export function Disclosure({ title, children, defaultOpen = false, className }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return <div className={cn('ax-disclosure', className)}>
    <Button variant="ghost" className="ax-disclosure-trigger" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <ChevronRight size={14} className={open ? 'is-open' : undefined} aria-hidden="true" />
      <span>{title}</span>
    </Button>
    <div id={id} className="ax-disclosure-content" hidden={!open}>{children}</div>
  </div>
}
