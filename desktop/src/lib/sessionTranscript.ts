import type { CrewEvent, SessionHistory, Task } from './types'

/**
 * `at` is epoch milliseconds, normalised from the seconds AX reports.
 * `output` is a tool result: history replay and live updates both carry it, and
 * the collapsed transcript only shows it once the row is opened.
 */
export type SessionLine = { type:'user'|'agent'|'tool'|'thought'; text:string; output?:string; status?:string; key:string; at?:number }

/**
 * The view keeps one transcript row per message, so a tool result is capped
 * before it can reach React: a single search can return megabytes of matches.
 */
export const MAX_TOOL_OUTPUT = 20000

/** ACP tool content is a list of content blocks; flatten whatever text they carry. */
function toolOutput(update:Record<string,unknown>):string|undefined{
  const content=update.content
  if(typeof content==='string')return content.slice(0,MAX_TOOL_OUTPUT)||undefined
  if(!Array.isArray(content))return undefined
  const text=content.map(block=>{
    const item=block as {content?:{text?:string};text?:string}|null
    return item?.content?.text??item?.text??''
  }).join('')
  return text.slice(0,MAX_TOOL_OUTPUT)||undefined
}

/**
 * A tool call only carries a title on the live path; a replayed transcript often
 * reports nothing but the provider's call id, which is not a label a human can
 * read — those rows name the tool generically instead.
 */
function toolTitle(update:Record<string,unknown>):string{
  const raw=update.rawInput as {name?:unknown}|undefined
  for(const candidate of [update.title,raw?.name]){
    if(typeof candidate!=='string')continue
    const text=candidate.trim()
    if(!text)continue
    if(/^(?:call|toolu|fc|chatcmpl)[_-][\w-]+$/i.test(text))continue
    if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text))continue
    if(/^\d+$/.test(text))continue
    return text
  }
  return ''
}

/** Tool output streams in updates: keep the longest text rather than doubling it. */
function mergeOutput(previous:string|undefined,next:string|undefined):string|undefined{
  if(!next)return previous
  if(!previous)return next
  return next.startsWith(previous)||!previous.startsWith(next)?next:previous
}

/**
 * ACP carries no message time, so AX stamps it into the private `_ax` object that
 * Crew already reads for vendor extensions.
 */
function updateTime(update:Record<string,unknown>){
  const meta=update['_ax'] as {createdAt?:number}|undefined
  const value=meta?.createdAt
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return undefined
  return value<1e12?value*1000:value
}

function cleanUserText(text:string){
  const marker='\n\nThe user attached images. Inspect each with the view_image tool before answering:\n'
  const index=text.indexOf(marker)
  if(index<0)return text
  const count=text.slice(index+marker.length).split('\n').filter(line=>line.startsWith('- .ax/crew-attachments/')).length
  return `${text.slice(0,index)}${text.slice(0,index)?'\n\n':''}📎 ${count} 张图片`
}

export function transcript(history?:SessionHistory, live:CrewEvent[]=[]):SessionLine[] {
  const entries=[
    ...(history?.updates??[]).map(item=>({update:item.update,at:updateTime(item.update)})),
    ...live.map(item=>({update:item.payload,at:updateTime(item.payload)??(item.timestamp?item.timestamp*1000:undefined)})),
  ]
  const lines:SessionLine[]=[]
  for(const {update,at} of entries){
    const kind=String(update.sessionUpdate??'')
    if(kind==='user_message_chunk'||kind==='agent_message_chunk'||kind==='agent_thought_chunk'){
      const type=kind==='user_message_chunk'?'user':kind==='agent_message_chunk'?'agent':'thought'
      const text=String((update.content as {text?:string}|undefined)?.text??'')
      const key=update.messageId?String(update.messageId):undefined
      // A streamed message keeps the time of its first chunk, so the label does not drift.
      if(lines.at(-1)?.type===type&&(!key||lines.at(-1)?.key===key))lines[lines.length-1].text+=text
      else lines.push({type,text,key:key??`${lines.length}-${type}`,...(at===undefined?{}:{at})})
    }else if(kind==='tool_call'){
      const output=toolOutput(update)
      lines.push({type:'tool',text:toolTitle(update),...(output?{output}:{}),status:String(update.status??'pending'),key:String(update.toolCallId??lines.length),...(at===undefined?{}:{at})})
    }else if(kind==='tool_call_update'){
      const call=lines.findLast(line=>line.key===update.toolCallId)
      const output=toolOutput(update)
      if(call){
        call.status=String(update.status??'completed')
        if(call.at===undefined&&at!==undefined)call.at=at
        if(!call.text)call.text=toolTitle(update)
        call.output=mergeOutput(call.output,output)
      }else lines.push({type:'tool',text:toolTitle(update),...(output?{output}:{}),status:String(update.status??'completed'),key:String(update.toolCallId??lines.length),...(at===undefined?{}:{at})})
    }
  }
  return lines
}

// History replays whole messages; websocket events contain chunks for the current turn.
// Reconcile within that turn so a refetch cannot erase or duplicate streamed text.
export function conversationTranscript(history:SessionHistory|undefined, events:CrewEvent[], task:Task|undefined, includeCurrent:boolean):SessionLine[]{
  const saved=transcript(history)
  if(!includeCurrent||!task)return saved.map(line=>line.type==='user'?{...line,text:cleanUserText(line.text)}:line)
  const prompt=typeof task.input==='string'?task.input:task.input&&typeof task.input==='object'&&'prompt' in task.input?String(task.input.prompt):''
  if(!prompt)return saved.map(line=>line.type==='user'?{...line,text:cleanUserText(line.text)}:line)
  const lastUser=saved.findLastIndex(line=>line.type==='user')
  const hasCurrent=lastUser>=0&&saved[lastUser].text===prompt&&(!history?.task_id||history.task_id===task.id)
  const before=hasCurrent?saved.slice(0,lastUser):saved
  const previous=hasCurrent?saved.slice(lastUser+1):[]
  const streamed=transcript(undefined,events).filter(line=>line.type!=='user')
  const body=previous.map(line=>({...line}))
  const offsets=new Map<string,number>()
  for(const line of streamed){
    const occurrence=offsets.get(line.type)??0;offsets.set(line.type,occurrence+1)
    const match=line.type==='tool'?body.findIndex(item=>item.type==='tool'&&item.key===line.key):body.map((item,index)=>({item,index})).filter(({item})=>item.type===line.type)[occurrence]?.index??-1
    if(match<0)body.push({...line})
    else{
      const previous=body[match],output=mergeOutput(previous.output,line.output)
      body[match]={...previous,...line,text:previous.text.startsWith(line.text)?previous.text:line.text,...(output?{output}:{})}
    }
  }
  const sentAt=task.created_at?task.created_at*1000:undefined
  return [...before,{type:'user',text:prompt,key:`prompt-${task.id}`,...(sentAt===undefined?{}:{at:sentAt})} as SessionLine,...body.map((line,index)=>({...line,key:`${task.id}-${index}-${line.key}`}))].map(line=>line.type==='user'?{...line,text:cleanUserText(line.text)}:line)
}

/**
 * One renderable row of the transcript. Everything a turn did on the way to its
 * answer — thinking, tool calls, the narration between them — collapses into one
 * `process` block, so the answer is the only thing that stays open.
 */
export type TranscriptBlock = { kind:'line'; key:string; line:SessionLine } | { kind:'process'; key:string; lines:SessionLine[]; end?:number }

/** The turn's last answer stays open; every step before and after it folds away. */
export function transcriptBlocks(lines:SessionLine[]):TranscriptBlock[]{
  const blocks:TranscriptBlock[]=[]
  let turn:SessionLine[]=[]
  const flush=()=>{
    if(!turn.length)return
    const answer=turn.findLastIndex(line=>line.type==='agent')
    const head=answer<0?turn:turn.slice(0,answer)
    const tail=answer<0?[]:turn.slice(answer+1)
    // The folded row is timed from its own first step to the end of the turn, so a
    // block with one step still reports how long the turn took.
    const end=turn.at(-1)?.at
    if(head.length)blocks.push({kind:'process',key:`process-${head[0].key}`,lines:head,...(end===undefined?{}:{end})})
    if(answer>=0)blocks.push({kind:'line',key:turn[answer].key,line:turn[answer]})
    if(tail.length)blocks.push({kind:'process',key:`process-${tail[0].key}`,lines:tail,...(end===undefined?{}:{end})})
    turn=[]
  }
  for(const line of lines){
    if(line.type==='user'){flush();blocks.push({kind:'line',key:line.key,line})}
    else turn.push(line)
  }
  flush()
  return blocks
}
