import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send, RotateCcw, Square, ExternalLink } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Action, Empty, Status } from '../components/shared'
import { Button } from '../components/ui/button'
import { Textarea } from '../components/ui/input'
import { api, endpoints } from '../lib/api'
import { useSessions, useTasks } from '../lib/query'
import { useLive } from '../lib/live'
import { useSessionUi } from '../store/sessions'
import { conversations, isActiveTask } from '../lib/conversations'
import { conversationTranscript } from '../lib/sessionTranscript'
import type { Session, Task } from '../lib/types'
import { short } from '../lib/utils'
import { MessageMarkdown } from '../components/MessageMarkdown'

export function SessionThread({taskId}:{taskId:string}){
  const sessions=useSessions(),tasks=useTasks(),navigate=useNavigate(),query=useQueryClient()
  const groups=useMemo(()=>conversations(sessions.data??[],tasks.data??[],[taskId]),[sessions.data,tasks.data,taskId])
  const current=groups.find(group=>group.tasks.some(task=>task.id===taskId))
  const task=current?.latest,binding=current?.binding,rootId=current?.root.id??taskId,busy=isActiveTask(task)
  const {drafts,setDraft}=useSessionUi(),message=drafts[rootId]??''
  const history=useQuery({queryKey:['history',task?.id],queryFn:()=>endpoints.history(task!.id),enabled:!!binding,staleTime:Infinity,refetchOnWindowFocus:false,retry:1,placeholderData:(previous,previousQuery)=>current?.tasks.some(item=>item.id===previousQuery?.queryKey[1])?previous:undefined})
  const streams=useLive(state=>state.streams)
  const settled=!!task?.finished_at&&history.dataUpdatedAt>task.finished_at*1000&&!history.isFetching&&!history.isError
  const lines=useMemo(()=>conversationTranscript(history.data,settled?[]:streams[task?.id??'']??[],task,!settled),[history.data,streams,task,settled])
  const active=useRef(true),selected=useRef(taskId);selected.current=taskId
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
  return <div className="flex min-h-[480px] flex-col">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs"><span>AX Session · {binding?short(binding.ax_session_id):'正在启动…'}</span><div className="flex items-center gap-2">{task&&<Status value={task.status}/>}<Action run={()=>history.refetch()} disabled={!binding||history.isFetching}><RotateCcw size={13}/> 刷新</Action><Button variant="secondary" onClick={()=>navigate(`/sessions/${rootId}`)}><ExternalLink size={13}/> 打开会话</Button>{busy&&<Action variant="danger" run={()=>api(`/api/tasks/${task!.id}/cancel`,'POST',{})}><Square size={12}/> 停止</Action>}</div></div>
    {history.error&&<div className="p-3 text-xs text-danger">无法读取会话：{String(history.error)}</div>}
    <div className="min-h-0 flex-1 p-5"><div className="transcript">{lines.length?lines.map(line=><div className="message" key={line.key}><div className="text-xs text-muted">{line.type==='agent'?'AX':line.type==='user'?'你':line.type==='tool'?'工具':'思考'}</div>{line.type==='tool'?<div className="tool-block">{line.text}</div>:<MessageMarkdown text={line.text}/>}{line.status&&<span className="ml-3 text-xs text-muted">{line.status}</span>}</div>):<Empty title={task?.status==='failed'?'会话启动失败':binding?'正在加载会话…':'等待 AX Session'}/>}</div></div>
    {binding&&<div className="border-t border-border p-4"><div className="mx-auto flex max-w-[920px] items-end gap-2"><Textarea rows={2} className="min-h-14 flex-1" placeholder="发送消息，继续此会话" value={message} onChange={event=>setDraft(rootId,event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();document.getElementById(`send-${taskId}`)?.closest('button')?.click()}}}/><Action disabled={!message.trim()||busy} variant="default" run={async()=>{const source=taskId;const created=await api<Task>(`/api/sessions/${task!.id}/message`,'POST',{text:message.trim()});query.setQueryData<Task[]>(['tasks'],old=>[...(old??[]).filter(item=>item.id!==created.id),created]);query.setQueryData<Session[]>(['sessions'],old=>[...(old??[]).filter(item=>item.task_id!==created.id),{...binding,task_id:created.id}]);if(useSessionUi.getState().drafts[rootId]===message)setDraft(rootId,'');if(active.current&&selected.current===source)navigate(`/sessions/${rootId}`)}}><span id={`send-${taskId}`} className="flex items-center gap-1"><Send size={14}/> 发送</span></Action></div><div className="mx-auto mt-1 max-w-[920px] text-[10px] text-muted">Enter 发送 · Shift+Enter 换行</div></div>}
  </div>
}
