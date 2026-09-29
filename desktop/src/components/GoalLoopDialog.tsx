import { useState } from 'react'
import { CircleDot, GitPullRequest, Target } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Input, Textarea } from './ui/input'
import { defaultLoopForm, defaultWakeInstruction, stopFileRelative, useGoalLoop, type LoopKind, type LoopRun } from '../store/goal'
import { stopFileAbsolute } from '../lib/goalLoop'

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
  const stored=useGoalLoop(state=>state.forms[storeKey])
  const form=stored??defaultLoopForm
  const [pane,setPane]=useState<LoopKind>('goal')
  const [problem,setProblem]=useState('')
  const patch=(value:Partial<typeof form>)=>useGoalLoop.getState().setForm(storeKey,value)
  const running=run?.status==='running'
  const stopPath=stopFileAbsolute(workspace??'.',stopFileRelative)
  const start=(kind:LoopKind)=>{
    if(disabled){setProblem('需要先连接本地 AX 并选择工作目录。');return}
    const prompt=kind==='goal'?form.prompt.trim():form.wakeInstruction.trim()||defaultWakeInstruction
    if(!prompt){setProblem('请填写目标描述。');return}
    if(kind==='monitor'&&!form.prUrl.trim()){setProblem('请填写拉取请求 URL。');return}
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
  const title=pane==='goal'?'设定目标':'有界拉取请求监控'
  return <Dialog open={open} onOpenChange={onOpenChange} title={title} wide>
    {pane==='goal'?<div className="goal-pane">
      <button className="goal-switch" type="button" onClick={()=>setPane('monitor')}><GitPullRequest size={15}/> 改为监控拉取请求</button>
      <div className="goal-banner">此目标循环会在每个周期调用代理，并且可能无限期运行。</div>
      <p className="goal-help">为代理设定目标。AX Crew 会按下面的间隔向代理发送一条包含该目标的推动消息，直到目标完成或达到轮次上限。</p>
      <label className="goal-field"><span>目标描述</span><Textarea className="goal-textarea" value={form.prompt} onChange={event=>patch({prompt:event.target.value})}/></label>
      <div className="goal-grid">
        <label className="goal-field"><span>推动间隔秒数</span><Input type="number" min={5} value={form.intervalSeconds} onChange={event=>patch({intervalSeconds:event.target.value})}/></label>
        <label className="goal-field"><span>最大轮次（0 = ∞）</span><Input type="number" min={0} value={form.maxRounds} onChange={event=>patch({maxRounds:event.target.value})}/></label>
      </div>
      <p className="goal-help">每次发送推动消息时会填入 <code>{'{{STOP_FILE}}'}</code>：它会变成会话停止文件的路径（<code>{stopPath}</code>）。创建该文件即可终止循环，或点击“停止循环”——循环运行期间它会取代“启动循环”。</p>
      {problem&&<p className="goal-problem" role="alert">{problem}</p>}
      <div className="goal-actions">{running?<Button variant="danger" onClick={onStop}><CircleDot size={15}/> 停止循环</Button>:<Button onClick={()=>start('goal')} disabled={disabled}><Target size={15}/> 启动循环</Button>}</div>
      <LoopStatus run={run}/>
    </div>:<div className="goal-pane">
      <button className="goal-switch" type="button" onClick={()=>setPane('goal')}><Target size={15}/> 返回目标循环</button>
      <p className="goal-help">低成本探测，仅在评审工作可处理时唤醒代理。</p>
      <label className="goal-field"><span>拉取请求 URL</span><Input value={form.prUrl} placeholder="例如 https://github.com/owner/repo/pull/123" onChange={event=>patch({prUrl:event.target.value})}/></label>
      <p className="goal-help">支持 GitHub.com、GitLab、Azure DevOps Services 和 Bitbucket Cloud。</p>
      <div className="goal-grid">
        <label className="goal-field"><span>探测间隔（秒）</span><Input type="number" min={5} value={form.probeSeconds} onChange={event=>patch({probeSeconds:event.target.value})}/></label>
        <label className="goal-field"><span>最大运行时间（秒）</span><Input type="number" min={0} value={form.maxRuntimeSeconds} onChange={event=>patch({maxRuntimeSeconds:event.target.value})}/></label>
        <label className="goal-field"><span>最大代理轮次</span><Input type="number" min={0} value={form.agentRounds} onChange={event=>patch({agentRounds:event.target.value})}/></label>
        <label className="goal-field"><span>最大令牌数</span><Input type="number" min={0} value={form.maxTokens} onChange={event=>patch({maxTokens:event.target.value})}/></label>
        <label className="goal-field"><span>最大提供商错误数</span><Input type="number" min={0} value={form.maxProviderErrors} onChange={event=>patch({maxProviderErrors:event.target.value})}/></label>
      </div>
      <label className="goal-field"><span>代理唤醒时的指令</span><Textarea className="goal-textarea" value={form.wakeInstruction} placeholder={defaultWakeInstruction} onChange={event=>patch({wakeInstruction:event.target.value})}/></label>
      <p className="goal-help">本轮令牌预算 {form.maxTokens||'0'}：AX Crew 会把该预算写进唤醒指令，实际用量由 AX 侧统计。</p>
      {problem&&<p className="goal-problem" role="alert">{problem}</p>}
      <div className="goal-actions"><Button variant="secondary" onClick={()=>setPane('goal')}>返回目标循环</Button>{running?<Button variant="danger" onClick={onStop}><CircleDot size={15}/> 停止监控</Button>:<Button onClick={()=>start('monitor')} disabled={disabled}><GitPullRequest size={15}/> 启动监控</Button>}</div>
      <LoopStatus run={run}/>
    </div>}
  </Dialog>
}

function LoopStatus({run}:{run:LoopRun|undefined}){
  if(!run||run.status==='running')return null
  return <p className="goal-help">{run.detail}</p>
}
