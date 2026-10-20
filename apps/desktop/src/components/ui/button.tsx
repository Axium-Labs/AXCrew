import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'
import './primitives.css'

const variants = cva('ax-button', {
  variants: {
    variant: { default: 'ax-button-primary', secondary: 'ax-button-secondary', ghost: 'ax-button-ghost', danger: 'ax-button-danger' },
    size: { default: 'ax-button-default', sm: 'ax-button-small', icon: 'ax-button-icon' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})
type Props=ButtonHTMLAttributes<HTMLButtonElement>&VariantProps<typeof variants>
export const Button=forwardRef<HTMLButtonElement,Props>(({className,variant,size,type='button',...props},ref)=><button ref={ref} type={type} className={cn(variants({variant,size}),className)} {...props}/>)
Button.displayName='Button'
