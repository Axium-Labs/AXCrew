import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../../lib/utils'
import './select.css'

export type SelectOption = { value: string; label: string; group?: string; disabled?: boolean; swatch?: { background: string; foreground: string } }
export type SelectProps = {
  label: string
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  disabled?: boolean
  className?: string
  id?: string
  name?: string
  placeholder?: string
}

function Swatch({ option }: { option?: SelectOption }) {
  return option?.swatch ? <span aria-hidden="true" className="ax-select-swatch" style={{background:option.swatch.background,color:option.swatch.foreground}}>Aa</span> : null
}

/** App-styled single selection. Empty strings remain valid public values. */
export function Select({ label, value, onChange, options, disabled = false, className, id, name, placeholder = '—' }: SelectProps) {
  const groups = [...new Set(options.map(option => option.group ?? ''))]
  const selected = options.find(option => option.value === value)
  // Encode every value, so the empty option cannot collide with a real ID.
  const encode = (raw: string) => `value:${raw}`
  return <RadixSelect.Root name={name} value={encode(value)} onValueChange={next => onChange(next.slice(6))} disabled={disabled || !options.length}>
    <RadixSelect.Trigger id={id} className={cn('ax-select settings-select-menu', className)} aria-label={label}>
      <RadixSelect.Value><Swatch option={selected}/>{selected?.label ?? (value || placeholder)}</RadixSelect.Value>
      <RadixSelect.Icon><ChevronDown size={15} /></RadixSelect.Icon>
    </RadixSelect.Trigger>
    <RadixSelect.Portal><RadixSelect.Content className="ax-select-panel settings-choice-panel" position="popper" sideOffset={6} collisionPadding={12} onEscapeKeyDown={event => event.stopPropagation()}>
      <RadixSelect.ScrollUpButton className="ax-select-scroll"><ChevronUp size={14} /></RadixSelect.ScrollUpButton>
      <RadixSelect.Viewport className="ax-select-viewport">
        {groups.map(group => <RadixSelect.Group key={group}>
          {group && <RadixSelect.Label className="ax-select-heading">{group}</RadixSelect.Label>}
          {options.filter(option => (option.group ?? '') === group).map(option => <RadixSelect.Item className="ax-select-item settings-choice-item" key={option.value} value={encode(option.value)} disabled={option.disabled}>
            <RadixSelect.ItemText><Swatch option={option}/>{option.label}</RadixSelect.ItemText>
            <RadixSelect.ItemIndicator className="ax-select-indicator"><Check size={15} /></RadixSelect.ItemIndicator>
          </RadixSelect.Item>)}
        </RadixSelect.Group>)}
      </RadixSelect.Viewport>
      <RadixSelect.ScrollDownButton className="ax-select-scroll"><ChevronDown size={14} /></RadixSelect.ScrollDownButton>
    </RadixSelect.Content></RadixSelect.Portal>
  </RadixSelect.Root>
}
