import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'
// Shape and focus motion live in `.ax-field` so the arbitrary values stay in CSS.
const field='ax-field'
export const Input=forwardRef<HTMLInputElement,InputHTMLAttributes<HTMLInputElement>>(({className,...props},ref)=><input ref={ref} className={cn('h-8 w-full border border-border bg-surface px-2.5 text-[13px] text-foreground placeholder:text-muted',field,className)} {...props}/>)
Input.displayName='Input'
export const Textarea=forwardRef<HTMLTextAreaElement,TextareaHTMLAttributes<HTMLTextAreaElement>>(({className,...props},ref)=><textarea ref={ref} className={cn('min-h-24 w-full resize-y border border-border bg-surface px-2.5 py-2 text-[13px] text-foreground placeholder:text-muted',field,className)} {...props}/>)
Textarea.displayName='Textarea'
