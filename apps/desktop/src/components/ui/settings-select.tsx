import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

export function SettingsSelect({label,value,onChange,options,disabled=false}:{label:string;value:string;onChange:(value:string)=>void;options:{value:string;label:string;group?:string;disabled?:boolean}[];disabled?:boolean}) {
  const groups=[...new Set(options.map(option=>option.group??''))]
  return <Select.Root value={value||'__empty'} onValueChange={next=>onChange(next==='__empty'?'':next)} disabled={disabled}>
    <Select.Trigger className="settings-select-menu" aria-label={label}><Select.Value/><Select.Icon><ChevronDown size={15}/></Select.Icon></Select.Trigger>
    <Select.Portal><Select.Content className="settings-choice-panel" position="popper" sideOffset={6} collisionPadding={12}><Select.Viewport>
      {groups.map(group=><Select.Group key={group}>{group&&<Select.Label className="settings-choice-heading">{group}</Select.Label>}{options.filter(option=>(option.group??'')===group).map(option=><Select.Item className="settings-choice-item" key={option.value} value={option.value||'__empty'} disabled={option.disabled}><Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><Check size={15}/></Select.ItemIndicator></Select.Item>)}</Select.Group>)}
    </Select.Viewport></Select.Content></Select.Portal>
  </Select.Root>
}
