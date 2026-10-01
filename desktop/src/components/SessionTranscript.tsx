import { useEffect, useState } from 'react'
import { ChevronDown, Terminal, Pencil, Search, FileText } from 'lucide-react'
import { MessageMarkdown } from './MessageMarkdown'
import { useLang } from '../lib/i18n'
import type { ChangedFile, SessionLine } from '../lib/sessionTranscript'
import { MessageActions, MessageImage, useSessionInteractions } from './SessionInteractions'

function clock(at:number|undefined,lang:'zh'|'en'){
  if(!at)return ''
  const date=new Date(at)
  const time=date.toLocaleTimeString(lang==='en'?'en-US':'zh-CN',{hour:'2-digit',minute:'2-digit'})
  return date.toDateString()===new Date().toDateString()?time:`${date.getMonth()+1}/${date.getDate()} ${time}`
}
export function formatDuration(ms:number,lang:'zh'|'en'='zh'){
  const seconds=Math.max(0,Math.floor(ms/1000))
  if(seconds<60)return lang==='zh'?`${seconds} 秒`:`${seconds}s`
  if(seconds<3600)return lang==='zh'?`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`:`${Math.floor(seconds/60)}m ${seconds%60}s`
  return lang==='zh'?`${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds%3600/60)} 分`:`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`
}
function toolType(line:SessionLine){
  const name=(line.toolKind??'').toLowerCase()
  if(name==='patch'||name==='write')return name==='patch'?'Patch':'Write'
  if(['shell','execute','exec_command','write_stdin'].includes(name)||/^running /.test(line.text))return 'Shell'
  if(name==='search'||/^searching /.test(line.text))return 'Search'
  if(['patch','edit','apply_patch'].includes(name)||/^editing /.test(line.text))return 'Patch'
  if(name==='filesystem'||/^read |^list |^write /.test(line.text))return /^write /.test(line.text)?'Write':/^list /.test(line.text)?'List':'Read'
  if(name==='read'||name==='tool_output')return 'Read'
  if(name==='write')return 'Write'
  if(name==='list')return 'List'
  return name||'Tool'
}
export function ToolRow({line}:{line:SessionLine}){
  const lang=useLang(s=>s.lang)
  const [open,setOpen]=useState(false)
  const [raw,setRaw]=useState(false)
  const [now,setNow]=useState(Date.now())
  const failed=line.status==='failed'||line.status==='error'
  const success=!failed&&(line.status==='completed'||line.status==='success')
  const running=!failed&&!success
  useEffect(()=>{if(!running)return;const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer)},[running])
  const status=lang==='zh'?(failed?'✕ 失败':success?'✓ 成功':'运行中'):(failed?'✕ Failed':success?'✓ Success':'Running')
  const command=line.operation??(line.text.replace(/^(running|editing|searching) /,'')||toolType(line))
  const elapsed=line.at?formatDuration((line.end??(running?now:line.at))-line.at,lang):''
  return <div className={`session-tool is-${failed?'failed':success?'success':'running'}`}>
    <button type="button" className="session-tool-row" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      {['Patch','Write'].includes(toolType(line))?<Pencil size={16}/>:toolType(line)==='Shell'?<Terminal size={16}/>:toolType(line)==='Search'?<Search size={16}/>:<FileText size={16}/>}<span className="session-tool-title">{lang==='zh'?(running?'正在执行 ':failed?'执行失败 ':['Patch','Write'].includes(toolType(line))?'已编辑 ':'已运行 '):''}{command.split('\n')[0]}</span>      {elapsed&&<small>{elapsed}</small>}<ChevronDown size={13} className={open?'is-open':''}/>
    </button>
    {open&&<div className="session-tool-card">
      <header>{toolType(line)}</header><pre className="session-tool-command">{command}</pre>
      {line.changedFiles?.filter(file=>file.diff).map(file=><section className="session-tool-diff" key={file.path}><header>{file.path} <b>+{file.additions}</b> <em>-{file.deletions}</em></header><DiffLines diff={file.diff!}/></section>)}
      <pre className="session-tool-output">{raw?line.rawOutput:line.output||(lang==='zh'?'暂无输出':'No output')}</pre>
      <footer>{line.rawOutput&&<button type="button" onClick={()=>setRaw(value=>!value)}>{raw?(lang==='zh'?'显示摘要':'Show summary'):(lang==='zh'?'展开原始输出':'Show raw output')}</button>}<span className={`session-tool-status is-${failed?'failed':success?'success':'running'}`}>{status}</span></footer>
    </div>}
  </div>
}
function ToolGroup({lines}:{lines:SessionLine[]}){
  const lang=useLang(s=>s.lang)
  const [open,setOpen]=useState(false)
  const edit=lines.some(line=>['Patch','Write'].includes(toolType(line)))
  const shell=lines.some(line=>toolType(line)==='Shell')
  const failed=lines.some(line=>line.status==='failed'||line.status==='error')
  const running=lines.some(line=>!['completed','success','failed','error'].includes(line.status??''))
  const label=lang==='zh'?(edit?(shell?'编辑了文件运行了命令':'编辑了文件'):shell?'运行了命令':'调用了工具'):(edit?(shell?'Edited files and ran commands':'Edited files'):shell?'Ran commands':'Used tools')
  return <section className={`session-tool-group${failed?' is-failed':''}`}>
    <button type="button" className="session-tool-group-summary" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      {edit?<Pencil size={17}/>:<Terminal size={17}/>}<span>{label}</span><ChevronDown size={14} className={open?'is-open':''}/>
      {(failed||running)&&<small>{lang==='zh'?(failed?'部分执行失败':'执行中'):(failed?'Some calls failed':'Running')}</small>}
    </button>
    <div className="session-tool-group-items" hidden={!open}>{lines.map(line=><ToolRow key={line.key} line={line}/>)}</div>
  </section>
}
function toolBlocks(lines:SessionLine[]){
  const blocks:SessionLine[][]=[]
  for(const line of lines){
    const previous=blocks[blocks.length-1]
    if(line.type==='tool'&&previous?.[0].type==='tool')previous.push(line)
    else blocks.push([line])
  }
  return blocks
}
export function DiffLines({diff}:{diff:string}){
  let old=0,next=0
  return <pre className="session-diff">{diff.split('\n').map((line,index)=>{
    const hunk=/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if(hunk){old=Number(hunk[1]);next=Number(hunk[2]);return <div className="session-diff-hunk" key={index}>{line}</div>}
    if(!line||/^(diff |index |--- |\+\+\+ |\\)/.test(line))return null
    const added=line.startsWith('+'),deleted=line.startsWith('-')
    const number=deleted?old++:added?next++:next++
    if(!added&&!deleted)old++
    return <div key={index} className={added?'is-added':deleted?'is-deleted':'is-context'}><span className="session-diff-number">{number}</span><code>{line.slice(1)}</code></div>
  })}</pre>
}
function Changes({files}:{files:ChangedFile[]}){
  const lang=useLang(s=>s.lang)
  const {onChanges}=useSessionInteractions()
  const [all,setAll]=useState(false)
  const [selected,setSelected]=useState<string|null>(null)
  const [hovered,setHovered]=useState<string|null>(null)
  const [viewAll,setViewAll]=useState(false)
  if(!files.length)return null
  const current=files.find(file=>file.path===(hovered??selected))
  return <section className="session-changes" onKeyDown={event=>{if(event.key==='Escape'){setSelected(null);setHovered(null);setViewAll(false)}}}><header><span className="session-changes-icon"><FileText size={24}/></span><div className="session-changes-heading"><strong>{lang==='zh'?`已编辑 ${files.length} 个文件`:`Edited ${files.length} files`}</strong><span><b>+{files.reduce((n,f)=>n+f.additions,0)}</b> <em>-{files.reduce((n,f)=>n+f.deletions,0)}</em></span></div><button type="button" className="session-changes-undo" disabled title={lang==='zh'?'此记录没有安全恢复快照，无法撤销':'No safe restore snapshot is available'}>{lang==='zh'?'撤销 ↶':'Undo ↶'}</button><button type="button" onClick={()=>{if(onChanges){onChanges(files);return}setViewAll(value=>!value);setSelected(files[0].path);setHovered(null)}}>{lang==='zh'?'查看变更':'View changes'}</button></header>
    {(all?files:files.slice(0,3)).map(file=><div className="session-change-entry" key={file.path} onMouseEnter={()=>{if(!onChanges)setHovered(file.path)}} onMouseLeave={()=>setHovered(null)}><button type="button" className="session-change-file" aria-expanded={selected===file.path} onClick={()=>onChanges?onChanges(files,file.path):setSelected(selected===file.path?null:file.path)}><span>{file.path}</span><b>+{file.additions}</b><em>-{file.deletions}</em></button>
      {!viewAll&&current?.path===file.path&&<div className="session-change-preview"><header><span>{file.path}</span><b>+{file.additions}</b><em>-{file.deletions}</em><button type="button" onClick={()=>{setSelected(null);setHovered(null)}}>{lang==='zh'?'关闭':'Close'}</button></header>{file.diff?<DiffLines diff={file.diff}/>:<p>{lang==='zh'?'此记录未保存文件差异。':'No diff was saved.'}</p>}</div>}
    </div>)}
    {viewAll&&<div className="session-changes-full" role="region" aria-label={lang==='zh'?'文件变更':'File changes'}><button type="button" onClick={()=>{setViewAll(false);setSelected(null)}}>{lang==='zh'?'关闭':'Close'}</button>{files.map(file=><section key={file.path}><header><span>{file.path}</span><b>+{file.additions}</b><em>-{file.deletions}</em></header>{file.diff?<DiffLines diff={file.diff}/>:<p>{lang==='zh'?'此记录未保存文件差异。':'No diff was saved.'}</p>}</section>)}</div>}
    {files.length>3&&<button type="button" onClick={()=>setAll(value=>!value)}>{all?(lang==='zh'?'收起':'Show less'):(lang==='zh'?`再显示 ${files.length-3} 个文件`:'Show more files')}</button>}
  </section>
}
export function TranscriptLine({line}:{line:SessionLine}){
  const lang=useLang(s=>s.lang)
  if(line.type==='tool')return <ToolRow line={line}/>
  const time=clock(line.at,lang)
  if(!line.text&&line.changedFiles)return null
  if(line.type==='user')return <div className="session-transcript-line is-user"><div className="session-transcript-user">{!!line.images?.length&&<div className="session-sent-images">{line.images.map((image,index)=><MessageImage key={image.path??index} image={image}/>)}</div>}{line.text&&<div className="session-transcript-bubble"><MessageMarkdown text={line.text}/></div>}{time&&<time className="session-transcript-time">{time}</time>}<MessageActions line={line}/></div></div>
  return <div className={`session-transcript-line is-${line.type}`}><div className="session-transcript-body"><MessageMarkdown text={line.text}/>{line.type==='agent'&&<MessageActions line={line}/>}</div></div>
}
function Steps({lines}:{lines:SessionLine[]}){
  return <>{toolBlocks(lines.filter(line=>!!line.text||line.type==='tool')).map(block=>block[0].type==='tool'?<ToolGroup key={block[0].key} lines={block}/>:<TranscriptLine key={block[0].key} line={block[0]}/>)}</>
}
function TranscriptTurn({turn,active,finishedAt}:{turn:SessionLine[];active:boolean;finishedAt?:number}){
  const lang=useLang(s=>s.lang)
  const [expanded,setExpanded]=useState<boolean|null>(null)
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{if(!active)return;const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer)},[active])
  const user=turn[0].type==='user'?turn[0]:undefined
  const body=user?turn.slice(1):turn
  const lastAnswer=body.findLastIndex(line=>line.type==='agent'&&!!line.text.trim())
  const answerIndex=!active&&lastAnswer>=0&&!body.slice(lastAnswer+1).some(line=>line.type==='tool'||line.type==='thought')?lastAnswer:-1
  const answer=answerIndex>=0?body[answerIndex]:undefined
  const process=body.filter((_,index)=>index!==answerIndex)
  const open=expanded??active
  const [mountedAt]=useState(Date.now())
  const start=user?.at??body.find(line=>line.at)?.at??(active?mountedAt:undefined)
  const end=finishedAt??Math.max(0,...body.map(line=>line.end??line.at??0))
  const duration=start&&(active||end>=start)?formatDuration((active?now:end)-start,lang):''
  const hasProcess=active||!!duration||process.some(line=>!!line.text||line.type==='tool')
  const files=new Map<string,ChangedFile>()
  const final=turn.findLast(line=>!line.text&&line.changedFiles)
  for(const line of final?[final]:turn)if(line.status==='completed'||line.status==='success')for(const file of line.changedFiles??[]){const old=files.get(file.path);files.set(file.path,{...file,additions:file.additions+(old?.additions??0),deletions:file.deletions+(old?.deletions??0)})}
  return <div className={`session-turn${active?' is-running':''}`}>
    {user&&<TranscriptLine line={user}/>}
    {hasProcess&&<section className="session-process">
      <button type="button" className="session-process-summary" aria-expanded={open} onClick={()=>setExpanded(!open)}><span>{lang==='zh'?(active?'思考中':!duration?'执行过程':''):(active?'Thinking':!duration?'Work details':'')}</span>{duration&&<time>{lang==='zh'?`用时 ${duration}`:`Worked for ${duration}`}</time>}<ChevronDown size={14} className={open?'is-open':''}/></button>
      <div className="session-process-content" hidden={!open}><Steps lines={process}/></div>
    </section>}
    {answer&&<TranscriptLine line={answer}/>}
    <Changes files={[...files.values()]}/>
  </div>
}
export function TranscriptLines({lines,active=false,finishedAt}:{lines:SessionLine[];active?:boolean;finishedAt?:number}){
  const turns:SessionLine[][]=[]
  for(const line of lines){if(line.type==='user'||!turns.length)turns.push([]);turns[turns.length-1].push(line)}
  return <>{turns.map((turn,index)=><TranscriptTurn key={turn[0].key} turn={turn} active={active&&index===turns.length-1} finishedAt={index===turns.length-1?finishedAt:undefined}/>)}</>
}
