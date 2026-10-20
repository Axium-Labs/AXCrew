import * as Dialog from '@radix-ui/react-dialog'
import { ArrowDown, ArrowRight, ArrowUp, CornerDownLeft, Search, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import './command-palette.css'

type Command = { path: string; label: string; icon: LucideIcon; description?: string }
export type CommandGroup = { id: string; label: string; kind: string; items: Command[]; limit?: number }

export function CommandPalette({ open, onOpenChange, groups, onSelect }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: CommandGroup[]
  onSelect: (path: string) => void
}) {
  const t = useT(), id = useId(), listRef = useRef<HTMLDivElement>(null), previousFocus = useRef<HTMLElement | null>(null)
  const [search, setSearch] = useState(''), [index, setIndex] = useState(0)
  useEffect(() => { if (!open) { setSearch(''); setIndex(0) } }, [open])
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    let offset = 0
    return groups.flatMap(group => {
      const matches = group.items.filter(item => `${item.label} ${group.kind} ${item.description ?? ''}`.toLocaleLowerCase().includes(query))
      const items = (query ? matches : matches.slice(0, group.limit)).slice(0, Math.max(0, 35 - offset))
      const start = offset
      offset += items.length
      return items.length ? [{ ...group, items, start }] : []
    })
  }, [groups, search])
  const commands = filtered.flatMap(group => group.items)
  const selected = Math.max(0, Math.min(index, commands.length - 1))
  useEffect(() => {
    if (open) listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, selected, filtered])
  const run = (position: number) => {
    const command = commands[position]
    if (command) { onSelect(command.path); onOpenChange(false) }
  }

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="ax-overlay command-palette-overlay" />
      <Dialog.Content className="ax-dialog command-palette" aria-describedby={undefined}
        onOpenAutoFocus={() => { previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={event => { event.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus() }}>
        <Dialog.Title className="sr-only">{t('titlebar.runCommand')}</Dialog.Title>
        <div className="command-palette-search">
          <Search size={19} strokeWidth={1.7} aria-hidden="true" />
          <input role="combobox" aria-expanded={open} aria-autocomplete="list" aria-controls={`${id}-list`}
            aria-activedescendant={commands.length ? `${id}-option-${selected}` : undefined}
            aria-label={t('shell.searchCommands')} placeholder={t('shell.searchPlaceholder')} value={search}
            onChange={event => { setSearch(event.target.value); setIndex(0) }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setIndex(Math.max(0, Math.min(commands.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1))))
              } else if (event.key === 'Enter') { event.preventDefault(); run(selected) }
            }} />
          <Dialog.Close className="command-palette-close" aria-label={t('common.close')}><kbd>Esc</kbd></Dialog.Close>
        </div>
        <div ref={listRef} id={`${id}-list`} className="command-palette-list" role="listbox" aria-label={t('shell.commandList')}>
          {filtered.map(group => <div key={group.id} role="group" aria-labelledby={`${id}-${group.id}`} className="command-palette-group">
            <div id={`${id}-${group.id}`} className="command-palette-heading">{group.label}</div>
            {group.items.map(({ path, label, icon: Icon, description }, itemIndex) => {
              const position = group.start + itemIndex
              return <button key={path} id={`${id}-option-${position}`} type="button" role="option" tabIndex={-1}
                aria-selected={position === selected} className="command-palette-option"
                onMouseDown={event => event.preventDefault()} onMouseMove={() => setIndex(position)} onClick={() => run(position)}>
                <Icon size={17} strokeWidth={1.7} className="command-palette-icon" aria-hidden="true" />
                <span className="command-palette-copy"><span className="command-palette-label" title={label}>{label}</span>
                  {description && <span className="command-palette-description" title={description}>{description}</span>}
                </span>
                <span className="command-palette-kind" aria-hidden="true">{group.kind}</span>
                <ArrowRight size={14} className="command-palette-arrow" aria-hidden="true" />
              </button>
            })}
          </div>)}
          {!commands.length && <div className="command-palette-empty" role="status"><Search size={25} strokeWidth={1.5} aria-hidden="true" />
            <span>{t('shell.noCommands')}</span><span>{t('shell.tryAnotherSearch')}</span>
          </div>}
        </div>
        <div className="command-palette-footer">
          <span className="command-palette-navigation"><kbd><ArrowUp size={11} /></kbd><kbd><ArrowDown size={11} /></kbd><span>{t('shell.navigateCommands')}</span></span>
          <span>{t('shell.openCommand')}<kbd><CornerDownLeft size={12} /></kbd></span>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
