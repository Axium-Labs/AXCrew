import type { CrewEvent, Task } from './types'
import type { SessionLine } from './sessionTranscript'

export type SessionQuestion = { id:string; text:string; allowFreeText:boolean; options:{id:string;label:string;description?:string}[] }
export type SessionAnswer = { question_id:string; option_id?:string; text?:string }

export function sessionQuestion(value: unknown): SessionQuestion | undefined {
  if (!value || typeof value !== 'object') return
  const q=value as Record<string,unknown>,text=q.text??q.question
  if(typeof q.id!=='string'||!q.id||typeof text!=='string'||!text.trim())return
  const options=Array.isArray(q.options)?q.options.flatMap(value=>{
    if(!value||typeof value!=='object')return []
    const o=value as Record<string,unknown>
    return typeof o.id==='string'&&typeof o.label==='string'?[{id:o.id,label:o.label,...(typeof o.description==='string'?{description:o.description}:{})}]:[]
  }):[]
  return {id:q.id,text,allowFreeText:q.allowFreeText===true||q.allow_free_text===true,options}
}

export function answeredSessionQuestions(lines:SessionLine[]):{id:string;text:string;answer:string}[] {
  return lines.flatMap(line=>{
    if(line.toolKind!=='request_user_input'||!line.rawOutput)return []
    try{
      const value=JSON.parse(line.rawOutput)
      if(value.status!=='answered'||typeof value.question_id!=='string')return []
      const selected=Array.isArray(line.toolInput?.options)?line.toolInput.options.find((o:{id?:string})=>o.id===value.answer?.option_id):undefined
      const answer=value.answer?.text??selected?.label??value.answer?.option_id
      return typeof value.question==='string'&&typeof answer==='string'?[{id:value.question_id,text:value.question,answer}]:[]
    }catch{return []}
  })
}

/** Stored task state survives reload; streaming questions appear before parking completes. */
export function pendingSessionQuestion(task:Task|undefined,events:CrewEvent[]):SessionQuestion|undefined {
  if(!task||!['running','waiting_user','waiting_permission'].includes(task.status))return
  if(task.status==='waiting_user')return sessionQuestion(task.output?.question)
  const answered=task.output?.answer?.question_id
  const event=events.findLast(e=>e.task_id===task.id&&e.payload.sessionUpdate==='agent_question'&&(!task.started_at||e.timestamp>=task.started_at))
  const question=sessionQuestion(event?.payload.question)
  return question?.id!==answered?question:undefined
}
