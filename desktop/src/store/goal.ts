import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LoopKind='goal'|'monitor'
export type LoopStatus='running'|'stopped'|'finished'|'failed'
export type LoopForm={
  prompt:string
  intervalSeconds:string
  maxRounds:string
  prUrl:string
  probeSeconds:string
  maxRuntimeSeconds:string
  agentRounds:string
  maxTokens:string
  maxProviderErrors:string
  wakeInstruction:string
}
export type LoopRun={
  kind:LoopKind
  taskId:string|null
  cwd:string
  provider?:string|null
  model?:string|null
  reasoningEffort?:string
  permissionProfile:'ask'|'read'|'trust'|'yolo'
  prompt:string
  stopFile:string
  intervalSeconds:number
  maxRounds:number
  maxRuntimeSeconds:number
  maxTokens:number
  maxProviderErrors:number
  rounds:number
  errors:number
  startedAt:number
  status:LoopStatus
  detail:string
}
export const defaultGoalPrompt='Your north star is in north_star.md, roadmap in roadmap.md, tasks in tasks.md. Pick the single highest-leverage next step toward the goal and execute it. Update tasks.md. Post a blocker ONCE if genuinely stuck. To halt the loop, create {{STOP_FILE}}'
export const defaultWakeInstruction='Check {{PR_URL}} for review work you can act on now. If nothing is actionable, reply with one line and stop. Otherwise make the smallest change that addresses the feedback, run the checks, and update the branch. Create {{STOP_FILE}} to halt the monitor.'
export const defaultLoopForm:LoopForm={prompt:defaultGoalPrompt,intervalSeconds:'60',maxRounds:'0',prUrl:'',probeSeconds:'300',maxRuntimeSeconds:'14400',agentRounds:'8',maxTokens:'250000',maxProviderErrors:'3',wakeInstruction:''}
export const stopFileRelative='.crew-stop'

type GoalStore={
  forms:Record<string,LoopForm>
  runs:Record<string,LoopRun>
  setForm:(key:string,patch:Partial<LoopForm>)=>void
  start:(key:string,run:LoopRun)=>void
  patch:(key:string,patch:Partial<LoopRun>)=>void
  clear:(key:string)=>void
}

export const useGoalLoop=create<GoalStore>()(persist((set,get)=>({
  forms:{},runs:{},
  setForm:(key,patch)=>set(state=>({forms:{...state.forms,[key]:{...(state.forms[key]??defaultLoopForm),...patch}}})),
  start:(key,run)=>set(state=>({runs:{...state.runs,[key]:run}})),
  patch:(key,patch)=>{const run=get().runs[key];if(run)set(state=>({runs:{...state.runs,[key]:{...run,...patch}}}))},
  clear:key=>set(state=>{const runs={...state.runs};delete runs[key];return {runs}}),
}),{
  name:'ax-crew-goal-loops',
  // Loop runs live in memory only: a reload drops the timer, so a persisted "running" run would lie.
  partialize:state=>({forms:state.forms}),
}))
