import type { CrewEvent, SessionHistory, Task } from './types'

export function transcriptTurns(lines: SessionLine[]) {
  const turns: SessionLine[][] = []
  for (const line of lines) {
    if (line.type === 'user' && !line.steering || !turns.length) turns.push([])
    turns[turns.length - 1].push(line)
  }
  return turns
}

/**
 * `at` is epoch milliseconds, normalised from the seconds AX reports.
 * `output` is a tool result: history replay and live updates both carry it, and
 * the collapsed transcript only shows it once the row is opened.
 */
export type ChangedFile = { path:string; additions:number; deletions:number; diff?:string|null; binary?:boolean; change?:'created'|'modified'|'deleted' }
export type SessionImage = {path?:string;name:string;src?:string}
export type SessionLine = { type:'user'|'agent'|'tool'|'thought'; steering?:boolean; text:string; images?:SessionImage[]; operation?:string; output?:string; rawOutput?:string; toolKind?:string; toolInput?:Record<string,unknown>; changedFiles?:ChangedFile[]; status?:string; key:string; at?:number; end?:number }

/**
 * The view keeps one transcript row per message, so a tool result is capped
 * before it can reach React: a single search can return megabytes of matches.
 */
export const MAX_TOOL_OUTPUT = 20000

/** ACP tool content is a list of content blocks; flatten whatever text they carry. */
function toolOutput(update:Record<string,unknown>):string|undefined{
  const result=update.rawOutput as {summary?:string;diagnostics?:unknown[];raw_output?:string}|undefined
  if(result?.raw_output!==undefined)return compactOutput(result.raw_output,result.diagnostics)
  const content=update.content
  if(typeof content==='string')return compactOutput(content)||undefined
  if(!Array.isArray(content))return undefined
  const text=content.map(block=>{
    const item=block as {content?:{text?:string};text?:string}|null
    return item?.content?.text??item?.text??''
  }).join('')
  return compactOutput(text)||undefined
}

export function compactOutput(raw:string,diagnostics:unknown[]=[]):string {
  let text=raw
  try{
    const value=JSON.parse(raw)
    if(Array.isArray(value?.matches))text=value.matches.map((m:{path:string;line:number;text:string})=>`${m.path}:${m.line}: ${m.text}`).join('\n')
    else if(Array.isArray(value?.changed_files))text=value.changed_files.map((f:ChangedFile)=>`${f.path} +${f.additions} -${f.deletions}`).join('\n')
    else if(value&&typeof value==='object')text=Object.entries(value).map(([key,value])=>`${key}: ${typeof value==='string'?value:JSON.stringify(value)}`).join('\n')
  }catch{/* plain stdout */}
  const clean=text
  const errors=diagnostics.map(d=>typeof d==='string'?d:JSON.stringify(d)).join('\n')
  return [clean.slice(0,6000),clean.length>6000?'… 输出已压缩':'',errors.slice(0,3000)].filter(Boolean).join('\n')
}

function toolFields(update:Record<string,unknown>):Partial<SessionLine>{
  const raw=update.rawOutput as {status?:string;raw_output?:string}|undefined
  const input=update.rawInput as {name?:string;arguments?:Record<string,unknown>}|undefined
  const args=input?.arguments
  let operation:string|undefined
  let toolKind=input?.name??(update.kind?String(update.kind):undefined)
  if(args){
    const path=String(args.path??'')
    if(toolKind==='shell')operation=String(args.command??'')
    else if(toolKind==='filesystem'){
      toolKind=String(args.operation??'read')
      operation=`${toolKind} ${path}${args.start_line||args.end_line?`:${args.start_line??1}–${args.end_line??'…'}`:''}`
    }else if(toolKind==='search')operation=`search '${args.query??''}' in ${path}`
    else if(toolKind==='patch'){
      const edits=Array.isArray(args.edits)?args.edits as {start_line?:number;delete_count?:number;expected_lines?:string[];new_text?:string}[]:[]
      operation=[path,...edits.map(edit=>`@@ line ${edit.start_line}, remove ${edit.delete_count} @@\n${(edit.expected_lines??[]).map(line=>`- ${line}`).join('\n')}\n${(edit.new_text??'').split('\n').map(line=>`+ ${line}`).join('\n')}`)].join('\n')
    }
  }
  let changedFiles:ChangedFile[]|undefined
  try{changedFiles=JSON.parse(raw?.raw_output??'{}').changed_files}catch{/* not JSON */}
  return {...(toolKind?{toolKind}:{}),...(args?{toolInput:args}:{}),...(operation?{operation}:{}),
    ...(raw?.raw_output!==undefined?{rawOutput:raw.raw_output}:{}),...(changedFiles?{changedFiles}:{}),
    ...(raw?.status==='error'?{status:'failed'}:{})}
}

function mergeStatus(previous:string|undefined,next:string|undefined):string|undefined{
  if(previous==='failed'||next==='failed'||next==='error')return 'failed'
  if(previous==='completed'&&(!next||next==='pending'||next==='in_progress'))return previous
  return next??previous
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
  return text.split('\n\n[AX Crew conversation context]\n')[0].slice(0,index<0?undefined:index)
}

function userLine(line:SessionLine):SessionLine{
  if(line.type!=='user')return line
  const paths=[...line.text.matchAll(/^- (\.ax\/crew-attachments\/[^\r\n]+)$/gm)].map(match=>match[1]).filter(path=>/\.(png|jpe?g|webp|gif)$/i.test(path))
  return {...line,text:cleanUserText(line.text),...(paths.length?{images:paths.map(path=>({path,name:path.split('/').at(-1)??path}))}:{})}
}

export function contextLines(prompt:string):SessionLine[]{
  const raw=prompt.split('\n\n[AX Crew conversation context]\n')[1]?.split('\n[End AX Crew conversation context]')[0]
  if(!raw)return []
  try{
    const context=JSON.parse(raw) as {role:string;text:string}[]
    if(!Array.isArray(context))return []
    return context.filter(item=>['user','assistant'].includes(item.role)&&typeof item.text==='string').map((item,index)=>({type:item.role==='user'?'user':'agent',text:item.text,key:`context-${index}`}))
  }catch{return []}
}

export function transcript(history?:SessionHistory, live:CrewEvent[]=[]):SessionLine[] {
  const entries=[
    ...(history?.updates??[]).map(item=>({update:item.update,at:updateTime(item.update)})),
    ...live.map(item=>({update:item.payload,at:updateTime(item.payload)??(item.timestamp?item.timestamp*1000:undefined)})),
  ]
  const lines:SessionLine[]=[]
  for(const {update,at} of entries){
    const kind=String(update.sessionUpdate??'')
    if(kind==='turn_changes'){
      const key=`changes-${lines.findLast(line=>line.type==='user'&&!line.steering)?.key??'current'}`
      const previous=lines.find(line=>line.key===key)
      const changedFiles=Array.isArray(update.changedFiles)?update.changedFiles as ChangedFile[]:[]
      if(previous)previous.changedFiles=changedFiles
      else lines.push({type:'agent',text:'',key,changedFiles,status:'completed'})
      continue
    }
    if(kind==='user_message_chunk'||kind==='agent_message_chunk'||kind==='agent_thought_chunk'){
      const type=kind==='user_message_chunk'?'user':kind==='agent_message_chunk'?'agent':'thought'
      const text=String((update.content as {text?:string}|undefined)?.text??'')
      const key=update.messageId?String(update.messageId):undefined
      const steering=type==='user'&&(update._ax as {steering?:boolean}|undefined)?.steering===true
      if(type==='user'&&!lines.length)lines.push(...contextLines(text))
      // A streamed message keeps the time of its first chunk, so the label does not drift.
      if(lines.at(-1)?.type===type&&(!key||lines.at(-1)?.key===key)){lines[lines.length-1].text+=text;lines[lines.length-1].end=at??lines.at(-1)?.end}
      else lines.push({type,text,key:key??`${lines.length}-${type}`,...(steering?{steering:true}:{}),...(at===undefined?{}:{at})})
    }else if(kind==='tool_call'||kind==='tool_call_update'){
      const call=lines.findLast(line=>line.key===update.toolCallId)
      const output=toolOutput(update)
      if(call){
        const fields=toolFields(update)
        call.status=mergeStatus(call.status,fields.status??(update.status===undefined?undefined:String(update.status)))
        if(call.status==='completed'||call.status==='failed')call.end=at??call.end
        if(call.at===undefined&&at!==undefined)call.at=at
        if(!call.text)call.text=toolTitle(update)
        call.output=mergeOutput(call.output,output)
        Object.assign(call,{...fields,status:call.status})
      }else lines.push({type:'tool',text:toolTitle(update),...(output?{output}:{}),status:String(update.status??'pending'),key:String(update.toolCallId??lines.length),...(at===undefined?{}:{at}),...toolFields(update)})
    }
  }
  return lines
}

// History replays whole messages; websocket events contain chunks for the current turn.
// Reconcile within that turn so a refetch cannot erase or duplicate streamed text.
export function conversationTranscript(history:SessionHistory|undefined, events:CrewEvent[], task:Task|undefined, includeCurrent:boolean):SessionLine[]{
  const saved=transcript(history)
  if(!task)return saved.map(userLine)
  const prompt=typeof task.input==='string'?task.input:task.input&&typeof task.input==='object'&&'prompt' in task.input?String(task.input.prompt):''
  if(!prompt)return saved.map(userLine)
  const lastUser=saved.findLastIndex(line=>line.type==='user'&&!line.steering)
  const hasCurrent=lastUser>=0&&saved[lastUser].text===prompt&&(!history?.task_id||history.task_id===task.id)
  // Settled history can omit child tools or race with cancellation checkpoints.
  // Keep those rows by call ID, while saved message prose remains authoritative.
  if(!includeCurrent&&!events.some(event=>['tool_call','tool_call_update'].includes(String(event.payload.sessionUpdate))))return saved.map((line,index)=>userLine({...line,key:hasCurrent&&index===lastUser?`prompt-${task.id}`:line.key}))
  const before=hasCurrent?saved.slice(0,lastUser):saved.length?saved:contextLines(prompt)
  const previous=hasCurrent?saved.slice(lastUser+1):[]
  const streamed=transcript(undefined,events).filter(line=>includeCurrent?line.type!=='user'||line.steering:line.type==='tool')
  const body=previous.map(line=>({...line}))
  const offsets=new Map<string,number>()
  const category=(line:SessionLine)=>line.changedFiles&&!line.text&&line.type==='agent'?'changes':line.type
  for(const line of streamed){
    const kind=category(line)
    const occurrence=offsets.get(kind)??0;offsets.set(kind,occurrence+1)
    const exact=body.findIndex(item=>category(item)===kind&&item.key===line.key)
    const match=exact>=0?exact:line.type==='tool'||line.steering?-1:body.map((item,index)=>({item,index})).filter(({item})=>category(item)===kind)[occurrence]?.index??-1
    if(match<0)body.push({...line})
    else{
      const previous=body[match],output=mergeOutput(previous.output,line.output)
      const rawOutput=mergeOutput(previous.rawOutput,line.rawOutput)
      body[match]={...previous,...line,key:previous.key,at:previous.at??line.at,status:mergeStatus(previous.status,line.status),text:previous.text.startsWith(line.text)?previous.text:line.text,...(output?{output}:{}),...(rawOutput?{rawOutput}:{})}
    }
  }
  const sentAt=task.created_at?task.created_at*1000:undefined
  return [...before,{type:'user',text:prompt,key:`prompt-${task.id}`,...(sentAt===undefined?{}:{at:sentAt})} as SessionLine,...body].map(userLine)
}

/**
 * One renderable row of the transcript. Everything a turn did on the way to its
 * answer — thinking, tool calls, the narration between them — collapses into one
 * `process` block, so the answer is the only thing that stays open.
 */
export type TranscriptBlock = { kind:'line'; key:string; line:SessionLine } | { kind:'process'; key:string; lines:SessionLine[]; end?:number }

/** The turn's last answer stays open; every step before and after it folds away. */
export function transcriptBlocks(lines:SessionLine[]):TranscriptBlock[]{
  return lines.map(line=>({kind:'line',key:line.key,line}))
}

/** A final turn snapshot supersedes incremental successful tool edits. */
export function turnChangedFiles(turn: SessionLine[]): ChangedFile[] {
  const final = turn.findLast(line => line.type === 'agent' && !line.text && line.changedFiles !== undefined)
  if (final) return final.changedFiles ?? []
  const files = new Map<string, ChangedFile>()
  for (const line of turn) {
    if (!['completed', 'success'].includes(line.status ?? '')) continue
    for (const file of line.changedFiles ?? []) {
      const previous = files.get(file.path)
      files.set(file.path, { ...file, additions: file.additions + (previous?.additions ?? 0), deletions: file.deletions + (previous?.deletions ?? 0) })
    }
  }
  return [...files.values()]
}

export function latestTurnChangedFiles(lines: SessionLine[]): ChangedFile[] {
  return turnChangedFiles(lines.slice(Math.max(0, lines.findLastIndex(line => line.type === 'user' && !line.steering))))
}
