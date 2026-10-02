import { useState } from 'react'
import { CircleDot, GitPullRequest, Target } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Input, Textarea } from './ui/input'
import { defaultLoopForm, defaultWakeInstruction, stopFileRelative, useGoalLoop, type LoopKind, type LoopRun } from '../store/goal'
import { stopFileAbsolute } from '../lib/goalLoop'
import { useT } from '../lib/i18n'

export type LoopStart={
  kind:LoopKind
  prompt:string
  intervalSeconds:number
  maxRounds:number
  maxRuntimeSeconds:number
  maxTokens:number
  maxProviderErrors:number
}

type Props={
  open:boolean
  onOpenChange:(open:boolean)=>void
  storeKey:string
  run:LoopRun|undefined
  workspace:string|undefined
  disabled:boolean
  onStart:(config:LoopStart)=>void
  onStop:()=>void
}

const whole=(value:string,fallback:number)=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?Math.floor(parsed):fallback}

export function GoalLoopDialog({open,onOpenChange,storeKey,run,workspace,disabled,onStart,onStop}:Props){
  const t=useT()
  const stored=useGoalLoop(state=>state.forms[storeKey])
  const form=stored??defaultLoopForm
  const [pane,setPane]=useState<LoopKind>('goal')
  const [problem,setProblem]=useState('')
  const patch=(value:Partial<typeof form>)=>useGoalLoop.getState().setForm(storeKey,value)
  const running=run?.status==='running'
  const stopPath=stopFileAbsolute(workspace??'.',stopFileRelative)
  const start=(kind:LoopKind)=>{
    if(disabled){setProblem(t('loop.needSetup'));return}
    const prompt=kind==='goal'?form.prompt.trim():form.wakeInstruction.trim()||defaultWakeInstruction
    if(!prompt){setProblem(t('loop.needGoal'));return}
    if(kind==='monitor'&&!form.prUrl.trim()){setProblem(t('loop.needPrUrl'));return}
    setProblem('')
    onStart({
      kind,
      prompt:prompt.replaceAll('{{PR_URL}}',form.prUrl.trim()),
      intervalSeconds:whole(kind==='goal'?form.intervalSeconds:form.probeSeconds,kind==='goal'?60:300),
      maxRounds:whole(kind==='goal'?form.maxRounds:form.agentRounds,kind==='goal'?0:8),
      maxRuntimeSeconds:kind==='goal'?0:whole(form.maxRuntimeSeconds,14400),
      maxTokens:kind==='goal'?0:whole(form.maxTokens,250000),
      maxProviderErrors:kind==='goal'?3:whole(form.maxProviderErrors,3),
    })
  }
  const title=pane==='goal'?t('loop.titleGoal'):t('loop.titleMonitor')
  return <Dialog open={open} onOpenChange={onOpenChange} title={title} wide>
    {pane==='goal'?<div className="goal-pane">
      <button className="goal-switch" type="button" onClick={()=>setPane('monitor')}><GitPullRequest size={15}/> {t('loop.toMonitor')}</button>
      <div className="goal-banner">{t('loop.agentBanner')}</div>
      <p className="goal-help">{t('loop.goalHelp')}</p>
      <label className="goal-field"><span>{t('loop.goalLabel')}</span><Textarea className="goal-textarea" value={form.prompt} onChange={event=>patch({prompt:event.target.value})}/></label>
      <div className="goal-grid">
        <label className="goal-field"><span>{t('loop.intervalSeconds')}</span><Input type="number" min={5} value={form.intervalSeconds} onChange={event=>patch({intervalSeconds:event.target.value})}/></label>
        <label className="goal-field"><span>{t('loop.maxRounds')}</span><Input type="number" min={0} value={form.maxRounds} onChange={event=>patch({maxRounds:event.target.value})}/></label>
      </div>
      <p className="goal-help">{t('loop.stopFileHelp').split(/(\{marker\}|\{path\})/).map((part,index)=>part==='{marker}'?<code key={index}>{'{{STOP_FILE}}'}</code>:part==='{path}'?<code key={index}>{stopPath}</code>:part)}</p>
      {problem&&<p className="goal-problem" role="alert">{problem}</p>}
      <div className="goal-actions">{running?<Button variant="danger" onClick={onStop}><CircleDot size={15}/> {t('loop.stopLoop')}</Button>:<Button onClick={()=>start('goal')} disabled={disabled}><Target size={15}/> {t('loop.startLoop')}</Button>}</div>
      <LoopStatus run={run}/>
    </div>:<div className="goal-pane">
      <button className="goal-switch" type="button" onClick={()=>setPane('goal')}><Target size={15}/> {t('loop.toGoal')}</button>
      <p className="goal-help">{t('loop.probeHelp')}</p>
      <label className="goal-field"><span>{t('loop.prUrl')}</span><Input value={form.prUrl} placeholder={t('loop.prUrlPlaceholder')} onChange={event=>patch({prUrl:event.target.value})}/></label>
      <p className="goal-help">{t('loop.prHosts')}</p>
      <div className="goal-grid">
        <label className="goal-field"><span>{t('loop.probeSeconds')}</span><Input type="number" min={5} value={form.probeSeconds} onChange={event=>patch({probeSeconds:event.target.value})}/></label>
        <label className="goal-field"><span>{t('loop.maxRuntime')}</span><Input type="number" min={0} value={form.maxRuntimeSeconds} onChange={event=>patch({maxRuntimeSeconds:event.target.value})}/></label>
        <label className="goal-field"><span>{t('loop.maxAgentRounds')}</span><Input type="number" min={0} value={form.agentRounds} onChange={event=>patch({agentRounds:event.target.value})}/></label>
        <label className="goal-field"><span>{t('loop.maxTokens')}</span><Input type="number" min={0} value={form.maxTokens} onChange={event=>patch({maxTokens:event.target.value})}/></label>
        <label className="goal-field"><span>{t('loop.maxProviderErrors')}</span><Input type="number" min={0} value={form.maxProviderErrors} onChange={event=>patch({maxProviderErrors:event.target.value})}/></label>
      </div>
      <label className="goal-field"><span>{t('loop.wakeInstruction')}</span><Textarea className="goal-textarea" value={form.wakeInstruction} placeholder={defaultWakeInstruction} onChange={event=>patch({wakeInstruction:event.target.value})}/></label>
      <p className="goal-help">{t('loop.tokenBudget',{tokens:form.maxTokens||'0'})}</p>
      {problem&&<p className="goal-problem" role="alert">{problem}</p>}
      <div className="goal-actions"><Button variant="secondary" onClick={()=>setPane('goal')}>{t('loop.toGoal')}</Button>{running?<Button variant="danger" onClick={onStop}><CircleDot size={15}/> {t('loop.stopMonitor')}</Button>:<Button onClick={()=>start('monitor')} disabled={disabled}><GitPullRequest size={15}/> {t('loop.startMonitor')}</Button>}</div>
      <LoopStatus run={run}/>
    </div>}
  </Dialog>
}

function LoopStatus({run}:{run:LoopRun|undefined}){
  if(!run||run.status==='running')return null
  return <p className="goal-help">{run.detail}</p>
}
