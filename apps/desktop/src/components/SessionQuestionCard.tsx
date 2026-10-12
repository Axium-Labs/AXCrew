import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MessageCircleQuestion, ChevronRight, Pencil, X } from 'lucide-react'
import { api } from '../lib/api'
import type { Task } from '../lib/types'
import type { SessionAnswer, SessionQuestion } from '../lib/sessionQuestions'
import { useLang } from '../lib/i18n'
import { useSessionUi } from '../store/sessions'
import './session-question.css'

export function SessionQuestionCard({task,question,disabled,onBusy}:{task:Task;question:SessionQuestion;disabled?:boolean;onBusy:(busy:boolean)=>void}){
  const lang=useLang(s=>s.lang),copy=(zh:string,en:string)=>lang==='zh'?zh:en,query=useQueryClient(),id=useId()
  const key=`answer:${task.id}:${question.id}`,draft=useSessionUi(s=>s.drafts[key]??''),setDraft=useSessionUi(s=>s.setDraft)
  const [collapsed,setCollapsed]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),lock=useRef(false),mounted=useRef(true)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onBusy(false)}},[onBusy])
  const blocked=disabled||saving||task.status!=='waiting_user'
  const answer=async(value:SessionAnswer)=>{
    if(blocked||lock.current)return
    lock.current=true;setSaving(true);setError('');onBusy(true)
    try{
      const result=await api<Task>(`/api/sessions/${encodeURIComponent(task.id)}/answer`,'POST',value)
      query.setQueryData<Task[]>(['tasks'],old=>[...(old??[]).filter(item=>item.id!==result.id),result])
      setDraft(key,'')
      void query.invalidateQueries({queryKey:['tasks']});void query.invalidateQueries({queryKey:['history',task.id]})
    }catch(reason){if(mounted.current)setError(String(reason))}
    finally{lock.current=false;onBusy(false);if(mounted.current)setSaving(false)}
  }
  const submit=()=>void answer({question_id:question.id,text:draft.trim()})
  if(collapsed)return <button type="button" className="session-question-reopen" onClick={()=>setCollapsed(false)}><MessageCircleQuestion size={14}/>{copy('待回答的问题','Question awaiting your answer')}</button>
  return <section className="session-question-card" aria-labelledby={id}>
    <header><MessageCircleQuestion size={14} aria-hidden="true"/><span>{copy('问题','Question')}</span><button type="button" className="session-question-close" aria-label={copy('收起问题','Collapse question')} onClick={()=>setCollapsed(true)}><X size={14}/></button></header>
    <p id={id} className="session-question-title">{question.text}</p>
    {!!question.options.length&&<div className="session-question-options">{question.options.map((option,index)=><button type="button" key={option.id} title={option.description} aria-label={option.label} disabled={blocked} onClick={()=>void answer({question_id:question.id,option_id:option.id})}><span className="session-question-number" aria-hidden="true">{index+1}</span><span className="session-question-option-label">{option.label}</span><ChevronRight size={14} aria-hidden="true"/></button>)}</div>}
    {question.allowFreeText&&<div className="session-question-custom"><Pencil size={14} aria-hidden="true"/><textarea id={`${id}-answer`} aria-label={copy('或自行撰写回复','Or write your own reply')} placeholder={copy('或自行撰写回复','Or write your own reply')} rows={1} className="session-question-answer" value={draft} disabled={disabled||saving} onChange={event=>setDraft(key,event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(draft.trim())submit()}}}/><button type="button" disabled={blocked||!draft.trim()} onClick={submit}>{copy(saving?'发送中…':'发送',saving?'Sending…':'Send')}</button></div>}
    {task.status!=='waiting_user'&&<small>{copy('正在保存问题…','Saving question…')}</small>}
    {error&&<p role="alert" className="session-question-error">{copy('发送失败，回答已保留。','Send failed; your answer is retained.')} {error}</p>}
  </section>
}
