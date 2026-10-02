import { translate, useLang } from '../lib/i18n'
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
import { TranscriptLines } from '../components/SessionTranscript'
import './sessions.css'

export function SessionThread({taskId}:{taskId:string}){
  useLang(state=>state.lang);

  const sessions=useSessions(),tasks=useTasks(),navigate=useNavigate(),query=useQueryClient()
  const groups=useMemo(()=>conversations(sessions.data??[],tasks.data??[],[taskId]),[sessions.data,tasks.data,taskId])
  const current=groups.find(group=>group.tasks.some(task=>task.id===taskId))
  const task=current?.latest,binding=current?.binding,rootId=current?.root.id??taskId,busy=isActiveTask(task)
  const {drafts,setDraft}=useSessionUi(),message=drafts[rootId]??''
  const history=useQuery({queryKey:['history',task?.id],queryFn:()=>endpoints.history(task!.id),enabled:!!binding,staleTime:Infinity,refetchOnWindowFocus:false,retry:1,placeholderData:(previous,previousQuery)=>current?.tasks.some(item=>item.id===previousQuery?.queryKey[1])?previous:undefined})
  const streams=useLive(state=>state.streams)
  const settled=!!task?.finished_at&&history.dataUpdatedAt>task.finished_at*1000&&!history.isFetching&&!history.isError
  const lines=useMemo(()=>conversationTranscript(history.data,streams[task?.id??'']??[],task,!settled),[history.data,streams,task,settled])
  const active=useRef(true),selected=useRef(taskId);selected.current=taskId
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
  return <div className="flex min-h-[480px] flex-col">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs"><span>{translate("english.108")}{binding?short(binding.ax_session_id):translate("copy.337")}</span><div className="flex items-center gap-2">{task&&<Status value={task.status}/>}<Action run={()=>history.refetch()} disabled={!binding||history.isFetching}><RotateCcw size={13}/> {translate("copy.338")}</Action><Button variant="secondary" onClick={()=>navigate(`/sessions/${rootId}`)}><ExternalLink size={13}/> {translate("copy.339")}</Button>{busy&&<Action variant="danger" run={()=>api(`/api/tasks/${task!.id}/cancel`,'POST',{})}><Square size={12}/> {translate("copy.340")}</Action>}</div></div>
    {history.error&&<div className="p-3 text-xs text-danger">{translate("copy.341")}{String(history.error)}</div>}
    <div className="min-h-0 flex-1 p-5"><div className="session-transcript">{lines.length?<TranscriptLines lines={lines} active={busy} finishedAt={task?.finished_at?task.finished_at*1000:undefined}/>:<Empty title={task?.status==='failed'?translate("copy.345"):binding?translate("copy.346"):translate("copy.347")}/>}</div></div>
    {binding&&<div className="border-t border-border p-4"><div className="mx-auto flex max-w-[920px] items-end gap-2"><Textarea rows={2} className="min-h-14 flex-1" placeholder={translate("copy.348")} value={message} onChange={event=>setDraft(rootId,event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();document.getElementById(`send-${taskId}`)?.closest('button')?.click()}}}/><Action disabled={!message.trim()||busy} variant="default" run={async()=>{const source=taskId;const created=await api<Task>(`/api/sessions/${task!.id}/message`,'POST',{text:message.trim()});query.setQueryData<Task[]>(['tasks'],old=>[...(old??[]).filter(item=>item.id!==created.id),created]);query.setQueryData<Session[]>(['sessions'],old=>[...(old??[]).filter(item=>item.task_id!==created.id),{...binding,task_id:created.id}]);if(useSessionUi.getState().drafts[rootId]===message)setDraft(rootId,'');if(active.current&&selected.current===source)navigate(`/sessions/${rootId}`)}}><span id={`send-${taskId}`} className="flex items-center gap-1"><Send size={14}/> {translate("copy.349")}</span></Action></div><div className="mx-auto mt-1 max-w-[920px] text-[10px] text-muted">{translate("copy.350")}</div></div>}
  </div>
}
