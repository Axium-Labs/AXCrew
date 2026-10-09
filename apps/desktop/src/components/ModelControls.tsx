import { useId, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, ChevronRight, Zap } from 'lucide-react'
import type { AxModel } from '../lib/ax'
import { effortDragPosition, effortLabel, modelEfforts, selectedEffort } from '../lib/modelControls'
import { useLang, useT } from '../lib/i18n'

type Props = {
  models: AxModel[]; model?: AxModel | null; effort: string; onEffort: (value: string) => void
  onModel: (provider: string, model: string) => Promise<void>; modelDisabled?: boolean
  fast: boolean; fastDisabled: boolean; onFast: () => void; emptyHint: string; onConfigure: () => void
}
export function ModelControls(props: Props) {
  const lang = useLang(s => s.lang), t = useT(), zh = lang === 'zh'
  const [open, setOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [dragProgress, setDragProgress] = useState<number | null>(null)
  const dragging = useRef(false)
  const pointerStart = useRef(0)
  const sliderId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const values = modelEfforts(props.model), effort = selectedEffort(props.model, props.effort), label = effortLabel(effort, lang)
  const index = Math.max(0, values.indexOf(effort))
  const progress = values.length > 1 ? index / (values.length - 1) : 0
  const pointerProgress = (event: React.PointerEvent<HTMLInputElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (event.clientX - rect.left - 14) / Math.max(1, rect.width - 28)))
  }
  const moveEffort = (position: number, followPointer = true) => {
    if (followPointer) setDragProgress(effortDragPosition(position, values.length))
    const value = values[Math.round(position * (values.length - 1))]
    if (value !== effort) props.onEffort(value)
  }
  const providers = [...new Set(props.models.map(model => model.provider))]
  const modelName = props.model?.display_name || props.model?.id || (zh ? '选择模型' : 'Select model')
  return <Popover.Root open={open} onOpenChange={value => { setOpen(value); if (!value) { dragging.current = false; setDragProgress(null) } }}>
    <Popover.Trigger asChild><button type="button" className="session-footer-auto session-model-control" aria-label={t('session.chooseModel')} title={zh ? '模型与思考强度' : 'Model and reasoning effort'}><span>{modelName}</span>{label && <small>{label}</small>}<ChevronDown size={13}/></button></Popover.Trigger>
    <Popover.Portal><Popover.Content ref={cardRef} className="session-model-popover" side="top" align="end" sideOffset={8} collisionPadding={12} aria-label={zh ? '模型与思考强度' : 'Model and reasoning effort'} onEscapeKeyDown={event=>event.stopPropagation()} onOpenAutoFocus={event => { event.preventDefault(); cardRef.current?.focus({preventScroll:true}) }}>
        <div className="session-model-top">
          <button type="button" className="session-model-icon session-model-fast" aria-label={t('session.faster')} aria-pressed={props.fast} disabled={props.fastDisabled} title={`${t('session.faster')} · ${t('session.moreUsage')}`} onClick={props.onFast}><Zap size={18}/></button>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild><button type="button" className="session-model-choice" aria-label={zh ? `选择模型：${modelName}` : `Select model: ${modelName}`} disabled={selecting}>
              <strong>{label || (zh ? '模型' : 'Model')}</strong><span>{modelName}<ChevronRight size={13}/></span>
            </button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="session-model-menu-panel" side="top" align="end" sideOffset={8} collisionPadding={12} aria-label={zh ? '选择模型' : 'Select model'} onEscapeKeyDown={event=>event.stopPropagation()}>
              <DropdownMenu.Label className="session-model-menu-title">{zh ? '选择模型' : 'Select model'}</DropdownMenu.Label>
              {providers.map(provider => <DropdownMenu.Group key={provider}>
                <DropdownMenu.Label className="session-model-provider">{provider}</DropdownMenu.Label>
                {props.models.filter(model => model.provider === provider).map(model => {
                  const selected = props.model?.id === model.id && props.model?.provider === model.provider
                  return <DropdownMenu.Item key={model.id} className={`session-model-option${selected ? ' is-selected' : ''}`} disabled={props.modelDisabled || selecting} onSelect={async () => {
                    setSelecting(true)
                    try { await props.onModel(model.provider, model.id) } finally { setSelecting(false) }
                  }}><span>{model.display_name || model.id}</span>{selected && <Check size={15}/>}</DropdownMenu.Item>
                })}
              </DropdownMenu.Group>)}
              {!props.models.length && <DropdownMenu.Item className="session-model-option" onSelect={props.onConfigure}>{props.emptyHint}</DropdownMenu.Item>}
              {props.modelDisabled && <p className="session-model-hint">{zh ? '此会话沿用创建时的模型' : 'This conversation keeps its original model'}</p>}
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        {values.length ? <div className={`session-effort-slider${props.fast ? ' is-fast' : ''}${dragProgress !== null ? ' is-dragging' : ''}`} style={{'--effort-progress': `calc(14px + (100% - 28px) * ${dragProgress ?? progress})`} as React.CSSProperties}>
          <div className="session-effort-rail" aria-hidden="true">
            <div className="session-effort-fill" aria-hidden="true"/>
            <div className="session-effort-flow" aria-hidden="true">{Array.from({length:7},(_,i)=><i key={i} style={{'--particle-delay':`${-i * .13}s`,'--particle-y':`${5+(i*7)%17}px`} as React.CSSProperties}/>)}</div>
            <div className="session-effort-ticks" aria-hidden="true">{values.map(value => <i key={value}/>)}</div>
          </div>
            <div className="session-effort-thumb" aria-hidden="true"/>
            <input id={sliderId} type="range" min={0} max={values.length - 1} step={1} value={index} aria-label={zh ? '思考强度' : 'Reasoning effort'} aria-valuetext={label} title={`${zh ? '思考强度' : 'Reasoning effort'} · ${label}`} disabled={values.length === 1} onChange={event => props.onEffort(values[Number(event.target.value)])}
              onPointerDown={event => {
                if (event.button !== 0 || values.length < 2) return
                event.preventDefault()
                event.currentTarget.focus({preventScroll:true})
                event.currentTarget.setPointerCapture(event.pointerId)
                dragging.current = true
                pointerStart.current = event.clientX
                moveEffort(pointerProgress(event), false)
              }}
              onPointerMove={event => { if (dragging.current && (dragProgress !== null || Math.abs(event.clientX - pointerStart.current) > 3)) moveEffort(pointerProgress(event)) }}
              onPointerUp={event => {
                if (!dragging.current) return
                moveEffort(pointerProgress(event), false)
                dragging.current = false
                setDragProgress(null)
                event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onLostPointerCapture={() => { dragging.current = false; setDragProgress(null) }}/>
          </div> : <p className="session-model-hint">{zh ? '此模型未提供可设置的思考强度' : 'This model does not provide configurable reasoning effort'}</p>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
