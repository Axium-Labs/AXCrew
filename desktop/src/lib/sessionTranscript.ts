import type { CrewEvent, SessionHistory, Task } from './types'

export type SessionLine = { type:'user'|'agent'|'tool'|'thought'; text:string; status?:string; key:string }
function cleanUserText(text:string){
  const marker='\n\nThe user attached images. Inspect each with the view_image tool before answering:\n'
  const index=text.indexOf(marker)
  if(index<0)return text
  const count=text.slice(index+marker.length).split('\n').filter(line=>line.startsWith('- .ax/crew-attachments/')).length
  return `${text.slice(0,index)}${text.slice(0,index)?'\n\n':''}📎 ${count} 张图片`
}

export function transcript(history?:SessionHistory, live:CrewEvent[]=[]):SessionLine[] {
  const updates=[...(history?.updates??[]).map(item=>item.update),...live.map(item=>item.payload)]
  const lines:SessionLine[]=[]
  for(const update of updates){
    const kind=String(update.sessionUpdate??'')
    if(kind==='user_message_chunk'||kind==='agent_message_chunk'||kind==='agent_thought_chunk'){
      const type=kind==='user_message_chunk'?'user':kind==='agent_message_chunk'?'agent':'thought'
      const text=String((update.content as {text?:string}|undefined)?.text??'')
      const key=update.messageId?String(update.messageId):undefined
      if(lines.at(-1)?.type===type&&(!key||lines.at(-1)?.key===key))lines[lines.length-1].text+=text
      else lines.push({type,text,key:key??`${lines.length}-${type}`})
    }else if(kind==='tool_call')lines.push({type:'tool',text:String(update.title??update.toolCallId??'Tool call'),status:String(update.status??'pending'),key:String(update.toolCallId??lines.length)})
    else if(kind==='tool_call_update'){
      const call=lines.findLast(line=>line.key===update.toolCallId)
      if(call)call.status=String(update.status??'completed')
      else lines.push({type:'tool',text:String(update.title??update.toolCallId??'工具'),status:String(update.status??'completed'),key:String(update.toolCallId??lines.length)})
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
    else body[match]={...body[match],...line,text:body[match].text.startsWith(line.text)?body[match].text:line.text}
  }
  return [...before,{type:'user',text:prompt,key:`prompt-${task.id}`} as SessionLine,...body.map((line,index)=>({...line,key:`${task.id}-${index}-${line.key}`}))].map(line=>line.type==='user'?{...line,text:cleanUserText(line.text)}:line)
}
