import * as Dropdown from '@radix-ui/react-dropdown-menu'
import type { ReactElement, ReactNode } from 'react'

export function Menu({trigger,items,className=''}:{className?:string;trigger:ReactElement;items:{label:ReactNode;action:()=>void;disabled?:boolean}[]}){
  return <Dropdown.Root><Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger><Dropdown.Portal><Dropdown.Content className={`ax-menu ${className}`} align="start" sideOffset={6} onEscapeKeyDown={event=>event.stopPropagation()}>{items.map((item,index)=><Dropdown.Item key={index} className="ax-menu-item" disabled={item.disabled} onSelect={item.action}>{item.label}</Dropdown.Item>)}</Dropdown.Content></Dropdown.Portal></Dropdown.Root>
}
