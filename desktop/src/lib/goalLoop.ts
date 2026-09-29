import { api } from './api'
import { queryClient } from './runtime'
import { isActiveTask } from './conversations'
import { axAvailable, workspaceFileExists } from './ax'
import { stopFileRelative, useGoalLoop, type LoopRun, type LoopStatus } from '../store/goal'
import type { Task } from './types'

const controllers=new Map<string,{stopped:boolean}>()
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,Math.max(0,ms)))
const snapshot=(key:string)=>useGoalLoop.getState().runs[key]
const patch=(key:string,value:Partial<LoopRun>)=>useGoalLoop.getState().patch(key,value)

async function pause(ms:number,controller:{stopped:boolean}){
  const until=Date.now()+ms
  while(!controller.stopped&&Date.now()<until)await sleep(Math.min(500,until-Date.now()))
}

async function stopFilePresent(run:LoopRun){
  if(!axAvailable||!run.cwd)return false
  try{return await workspaceFileExists(run.cwd,run.stopFile||stopFileRelative)}catch{return false}
}

export const stopFileAbsolute=(cwd:string,relative:string)=>`${cwd.replace(/[\\/]+$/,'')}${cwd.includes('\\')?'\\':'/'}${relative}`

async function pushRound(run:LoopRun,text:string){
  const permission_profile=run.permissionProfile
  if(run.taskId)return api<Task>(`/api/sessions/${encodeURIComponent(run.taskId)}/message`,'POST',{text,images:[],permission_profile})
  return api<Task>('/api/sessions','POST',{title:text.slice(0,60)||'目标循环',text,images:[],cwd:run.cwd,provider:run.provider,model:run.model,permission_profile,...(run.reasoningEffort?{reasoning_effort:run.reasoningEffort}:{})})
}

// A round ends when its task leaves the active states; the live socket invalidates ['tasks'] for us.
async function waitForTask(id:string,controller:{stopped:boolean}){
  for(let tick=0;tick<2880;tick++){
    if(controller.stopped)return
    const cached=(queryClient.getQueryData<Task[]>(['tasks'])??[]).find(item=>item.id===id)
    if(cached&&!isActiveTask(cached))return
    if(!cached&&tick%4===3){
      try{const task=await api<Task|null>(`/api/tasks/${encodeURIComponent(id)}`);if(task&&!isActiveTask(task))return}catch{/* transient: the next tick retries */}
    }
    await sleep(1500)
  }
}

function finish(key:string,detail:string,status:LoopStatus='finished'){
  controllers.delete(key)
  patch(key,{status,detail})
}

async function drive(key:string,controller:{stopped:boolean},onBind?:(task:Task)=>void){
  while(!controller.stopped){
    const run=snapshot(key)
    if(!run||run.status!=='running'){controllers.delete(key);return}
    if(run.maxRounds>0&&run.rounds>=run.maxRounds)return finish(key,`已完成 ${run.maxRounds} 轮`)
    if(run.maxRuntimeSeconds>0&&Date.now()-run.startedAt>=run.maxRuntimeSeconds*1000)return finish(key,'已达最大运行时间')
    if(await stopFilePresent(run))return finish(key,'代理已创建停止文件')
    let task:Task
    try{
      task=await pushRound(run,run.prompt.replaceAll('{{STOP_FILE}}',stopFileAbsolute(run.cwd||run.stopFile,run.stopFile||stopFileRelative)))
    }catch(error){
      const errors=(snapshot(key)?.errors??0)+1
      if(run.maxProviderErrors>0&&errors>=run.maxProviderErrors)return finish(key,`连续失败 ${errors} 次：${String(error)}`,'failed')
      patch(key,{errors,detail:`推送失败，即将重试：${String(error)}`})
      await pause(Math.max(5000,run.intervalSeconds*1000),controller)
      continue
    }
    const bound=snapshot(key)
    if(!bound)return
    patch(key,{taskId:task.id,rounds:bound.rounds+1,errors:0,detail:''})
    if(!run.taskId)onBind?.(task)
    void queryClient.invalidateQueries({queryKey:['tasks']})
    void queryClient.invalidateQueries({queryKey:['sessions']})
    await waitForTask(task.id,controller)
    if(controller.stopped)return
    await pause(Math.max(1000,(snapshot(key)?.intervalSeconds??run.intervalSeconds)*1000),controller)
  }
  controllers.delete(key)
}

export function startGoalLoop(key:string,run:LoopRun,onBind?:(task:Task)=>void){
  const existing=controllers.get(key)
  if(existing)existing.stopped=true
  const controller={stopped:false}
  controllers.set(key,controller)
  useGoalLoop.getState().start(key,{...run,rounds:0,errors:0,startedAt:Date.now(),status:'running',detail:''})
  void drive(key,controller,onBind)
}

export function stopGoalLoop(key:string,detail='已手动停止循环'){
  const controller=controllers.get(key)
  if(controller)controller.stopped=true
  controllers.delete(key)
  if(snapshot(key))patch(key,{status:'stopped',detail})
}

export function isLoopRunning(key:string){return !!controllers.get(key)&&snapshot(key)?.status==='running'}
