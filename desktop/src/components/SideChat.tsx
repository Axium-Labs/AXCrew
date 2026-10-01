import { useAutoGrow } from '../lib/useAutoGrow'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Square, X, MessageSquarePlus, Plus } from 'lucide-react'
import { api, endpoints } from '../lib/api'
import type { Task, Session } from '../lib/types'
import { conversationTranscript } from '../lib/sessionTranscript'
import { isActiveTask } from '../lib/conversations'
import { useTasks, useSessions } from '../lib/query'
import { useLive } from '../lib/live'
import { useLang } from '../lib/i18n'
import { TranscriptLines } from './SessionTranscript'

export function SideChat({quotes,onQuotesChange,cwd,memberId,provider,model,onTask}:{quotes:string[];onQuotesChange:(quotes:string[])=>void;cwd?:string;memberId?:string;provider?:string;model?:string;onTask:(id:string)=>void}){
  const lang=useLang(s=>s.lang),query=useQueryClient(),tasks=useTasks(),sessions=useSessions(),streams=useLive(s=>s.streams)
  const [taskId,setTaskId]=useState<string>(),[draft,setDraft]=useState(''),[sending,setSending]=useState(false),[error,setError]=useState('')
  const lock=useRef(false),scroll=useRef<HTMLDivElement>(null),follow=useRef(true)
  const task=tasks.data?.find(task=>task.id===taskId),binding=sessions.data?.find(session=>session.task_id===taskId),busy=isActiveTask(task)
  const history=useQuery({queryKey:['history',taskId],queryFn:()=>endpoints.history(taskId!),enabled:!!binding,retry:1,refetchOnWindowFocus:false})
  const settled=!!task?.finished_at&&history.dataUpdatedAt>task.finished_at*1000&&!history.isFetching&&!history.isError
  const lines=conversationTranscript(history.data,streams[taskId??'']??[],task,!settled)
  useEffect(()=>{if(follow.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight},[lines])
  const inputRef=useRef<HTMLTextAreaElement>(null)
  useAutoGrow(inputRef,draft)
  const send=async()=>{
    const text=draft.trim();if(!text||lock.current||busy||(!cwd&&!memberId))return
    lock.current=true;setSending(true);setError('')
    try{
      const context=quotes.map(text=>({role:'user',text}))
      const created=taskId?await api<Task>(`/api/sessions/${encodeURIComponent(taskId)}/message`,'POST',{text,permission_profile:'read',context}):await api<Task>('/api/sessions','POST',{text,title:lang==='zh'?`侧边聊天：${text.slice(0,30)}`:`Side chat: ${text.slice(0,30)}`,...(memberId?{member_id:memberId}:{cwd,provider,model}),permission_profile:'read',context})
      query.setQueryData<Task[]>(['tasks'],old=>[...(old??[]).filter(task=>task.id!==created.id),created])
      if(binding)query.setQueryData<Session[]>(['sessions'],old=>[...(old??[]).filter(session=>session.task_id!==created.id),{...binding,task_id:created.id}])
      onTask(created.id);setTaskId(created.id);setDraft('');follow.current=true
      void query.invalidateQueries({queryKey:['sessions']});void query.invalidateQueries({queryKey:['tasks']})
    }catch(reason){setError(String(reason))}finally{lock.current=false;setSending(false)}
  }
  return <div className="session-side-chat"><header><MessageSquarePlus size={18}/><strong>{lang==='zh'?'侧边聊天':'Side chat'}</strong><button type="button" aria-label={lang==='zh'?'新建侧边聊天':'New side chat'} disabled={busy||sending} onClick={()=>{setTaskId(undefined);setDraft('');setError('');onQuotesChange([])}}><Plus size={17}/></button></header><div className="session-side-chat-scroll" ref={scroll} onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.clientHeight-node.scrollTop<80}}>{lines.length?<TranscriptLines lines={lines} active={busy} finishedAt={task?.finished_at?task.finished_at*1000:undefined}/>:<div className="session-side-chat-empty"><MessageSquarePlus size={34}/><strong>{lang==='zh'?'侧边聊天':'Side chat'}</strong><p>{lang==='zh'?'围绕选中文字提问，主聊天保持原处。':'Ask about selected text while keeping your main conversation in place.'}</p></div>}</div><form className="session-side-composer" onSubmit={event=>{event.preventDefault();void send()}}>{quotes.length>0&&<div className="session-side-quotes">{quotes.map((quote,index)=><div key={index}><span title={quote}>{quote}</span><button type="button" aria-label={lang==='zh'?'移除文字片段':'Remove quoted passage'} onClick={()=>onQuotesChange(quotes.filter((_,i)=>i!==index))}><X size={13}/></button></div>)}</div>}<textarea ref={inputRef} aria-label={lang==='zh'?'侧边聊天输入':'Side chat message'} placeholder={lang==='zh'?'随心输入':'Ask anything'} value={draft} onChange={event=>setDraft(event.target.value)} disabled={sending} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send()}}}/><div className="session-side-composer-actions">{busy?<button type="button" className="session-send-button session-stop-button" aria-label={lang==='zh'?'停止侧边聊天':'Stop side chat'} onClick={async()=>{try{await api(`/api/tasks/${taskId}/cancel`,'POST',{});void query.invalidateQueries({queryKey:['tasks']})}catch(reason){setError(String(reason))}}}><Square size={14}/></button>:<button type="submit" className="session-send-button" aria-label={lang==='zh'?'发送侧边消息':'Send side chat message'} disabled={!draft.trim()||sending||(!cwd&&!memberId)}><ArrowUp size={19}/></button>}</div>{error&&<p className="session-inline-error" role="alert">{error}</p>}</form></div>
}
