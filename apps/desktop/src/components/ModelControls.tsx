import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Zap } from 'lucide-react'
import type { AxModel } from '../lib/ax'
import { effortLabel, modelEfforts } from '../lib/modelControls'
import { useLang, useT } from '../lib/i18n'

type Props = {
  models: AxModel[]; model?: AxModel | null; effort: string; onEffort: (value: string) => void
  onModel: (provider: string, model: string) => Promise<void>; modelDisabled?: boolean
  fast: boolean; fastDisabled: boolean; onFast: () => void; emptyHint: string; onConfigure: () => void
}
export function ModelControls(props: Props) {
  const lang = useLang(s => s.lang), t = useT(), zh = lang === 'zh'
  const [open, setOpen] = useState(false), [view, setView] = useState<'effort' | 'models'>('effort')
  const [selecting, setSelecting] = useState(false)
  const values = modelEfforts(props.model), label = effortLabel(props.effort, lang)
  const modelName = props.model?.display_name || props.model?.id || (zh ? '选择模型' : 'Select model')
  return <Popover.Root open={open} onOpenChange={value => { setOpen(value); if (value) setView('effort') }}>
    <Popover.Trigger asChild><button type="button" className="session-footer-auto session-model-control" aria-label={t('session.chooseModel')} title={zh ? '模型与思考强度' : 'Model and reasoning effort'}><span>{modelName}</span>{label && <small>{label}</small>}<ChevronDown size={13}/></button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="session-model-popover" side="top" align="end" sideOffset={10} collisionPadding={12} aria-label={zh ? '模型与思考强度' : 'Model and reasoning effort'}>
      {view === 'effort' ? <>
        <div className="session-model-top"><button type="button" className="session-model-fast" aria-label={t('session.faster')} aria-pressed={props.fast} disabled={props.fastDisabled} title={`${t('session.faster')} · ${t('session.moreUsage')}`} onClick={props.onFast}><Zap size={20}/></button><strong>{label || (zh ? '思考强度' : 'Reasoning effort')}</strong><span/></div>
        <button type="button" className="session-model-choice" onClick={() => setView('models')}>{modelName}<ChevronRight size={15}/></button>
        <label className="session-effort-label" htmlFor="session-effort-slider">{zh ? '思考强度' : 'Reasoning effort'}</label>
        {values.length ? <>
          <div className="session-effort-slider" style={{'--effort-progress': `${values.length > 1 ? Math.max(0, values.indexOf(props.effort)) / (values.length - 1) * 100 : 0}%`} as React.CSSProperties}>
            <div className="session-effort-ticks" aria-hidden="true">{values.map(value => <i key={value}/>)}</div>
            <input id="session-effort-slider" type="range" min={0} max={values.length - 1} step={1} value={Math.max(0, values.indexOf(props.effort))} aria-valuetext={label} disabled={values.length === 1} onChange={event => props.onEffort(values[Number(event.target.value)])}/>
          </div><div className="session-effort-options">{values.map(value => <button type="button" key={value} aria-pressed={props.effort === value} onClick={() => props.onEffort(value)}>{effortLabel(value, lang)}</button>)}</div>
        </> : <p className="session-model-hint">{zh ? '此模型未提供可设置的思考强度' : 'This model does not provide configurable reasoning effort'}</p>}
      </> : <>
        <header><button type="button" aria-label={zh ? '返回思考强度' : 'Back to reasoning effort'} onClick={() => setView('effort')}><ChevronLeft size={17}/></button><span>{zh ? '选择模型' : 'Select model'}</span></header>
        <div className="session-model-list">{props.models.length ? props.models.map(model => <button type="button" key={`${model.provider}/${model.id}`} disabled={props.modelDisabled || selecting} aria-pressed={props.model?.id === model.id && props.model?.provider === model.provider} onClick={async () => { setSelecting(true); try { await props.onModel(model.provider, model.id); setView('effort') } finally { setSelecting(false) } }}><span>{model.display_name || model.id}<small>{model.provider}</small></span>{props.model?.id === model.id && props.model?.provider === model.provider && <Check size={17}/>}</button>) : <button type="button" onClick={props.onConfigure}>{props.emptyHint}</button>}</div>
        {props.modelDisabled && <p className="session-model-hint">{zh ? '此远程会话沿用创建时的模型' : 'This remote conversation keeps its original model'}</p>}
      </>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
