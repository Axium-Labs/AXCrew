import { useT } from '../../lib/i18n'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './button'
export function Dialog({open,onOpenChange,title,children,wide=false}:{open:boolean;onOpenChange:(value:boolean)=>void;title:string;children:ReactNode;wide?:boolean}){
  const t=useT()
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="ax-overlay fixed inset-0 z-50 bg-black/70"/><DialogPrimitive.Content className={`ax-dialog fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100vw-40px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-border bg-surface-raised p-5 shadow-2xl ${wide?'max-w-3xl':'max-w-xl'}`}><div className="mb-5 flex items-center justify-between gap-3"><DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title><DialogPrimitive.Close asChild><Button variant="ghost" size="icon" aria-label={t('login.close')}><X size={16}/></Button></DialogPrimitive.Close></div>{children}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
}
