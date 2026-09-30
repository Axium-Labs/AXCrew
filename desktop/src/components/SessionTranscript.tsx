import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { MessageMarkdown } from './MessageMarkdown'
import { useLang } from '../lib/i18n'
import type { ChangedFile, SessionLine } from '../lib/sessionTranscript'

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
  const name=line.toolKind??''
  if(name==='shell'||/^running /.test(line.text))return 'Shell'
  if(name==='search'||/^searching /.test(line.text))return 'Search'
  if(name==='patch'||/^editing /.test(line.text))return 'Patch'
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
  const command=line.operation??(line.text.replace(/^running /,'')||toolType(line))
  const elapsed=line.at?formatDuration((line.end??(running?now:line.at))-line.at,lang):''
  return <div className={`session-tool is-${failed?'failed':success?'success':'running'}`}>
    <button type="button" className="session-tool-row" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <span aria-hidden="true">⌘</span><span className="session-tool-title">{lang==='zh'?(running?'正在运行 ':failed?'运行失败 ':'已运行 '):''}{command.split('\n')[0]}</span>
      {elapsed&&<small>{elapsed}</small>}<ChevronDown size={13} className={open?'is-open':''}/>
    </button>
    {open&&<div className="session-tool-card">
      <header>{toolType(line)}</header><pre className="session-tool-command">{command}</pre>
      <pre className="session-tool-output">{raw?line.rawOutput:line.output||(lang==='zh'?'暂无输出':'No output')}</pre>
      <footer>{line.rawOutput&&<button type="button" onClick={()=>setRaw(value=>!value)}>{raw?(lang==='zh'?'显示摘要':'Show summary'):(lang==='zh'?'展开原始输出':'Show raw output')}</button>}<span className={`session-tool-status is-${failed?'failed':success?'success':'running'}`}>{status}</span></footer>
    </div>}
  </div>
}
function Changes({files}:{files:ChangedFile[]}){
  const lang=useLang(s=>s.lang)
  const [all,setAll]=useState(false)
  if(!files.length)return null
  return <section className="session-changes"><header>{lang==='zh'?`已编辑 ${files.length} 个文件`:`Edited ${files.length} files`}<span><b>+{files.reduce((n,f)=>n+f.additions,0)}</b> <em>-{files.reduce((n,f)=>n+f.deletions,0)}</em></span></header>
    {(all?files:files.slice(0,3)).map(file=><div className="session-change-file" key={file.path}><span>{file.path}</span><b>+{file.additions}</b><em>-{file.deletions}</em></div>)}
    {files.length>3&&<button type="button" onClick={()=>setAll(value=>!value)}>{all?(lang==='zh'?'收起':'Show less'):(lang==='zh'?`再显示 ${files.length-3} 个文件`:'Show more files')}</button>}
  </section>
}
export function TranscriptLine({line}:{line:SessionLine}){
  const lang=useLang(s=>s.lang)
  if(line.type==='tool')return <ToolRow line={line}/>
  const time=clock(line.at,lang)
  if(!line.text&&line.changedFiles)return null
  if(line.type==='user')return <div className="session-transcript-line is-user"><div className="session-transcript-user"><div className="session-transcript-bubble"><MessageMarkdown text={line.text}/></div>{time&&<time className="session-transcript-time">{time}</time>}</div></div>
  return <div className={`session-transcript-line is-${line.type}`}><div className="session-transcript-body"><MessageMarkdown text={line.text}/>{time&&<time className="session-transcript-time">{time}</time>}</div></div>
}
export function TranscriptLines({lines}:{lines:SessionLine[]}){
  const turns:SessionLine[][]=[]
  for(const line of lines){if(line.type==='user'||!turns.length)turns.push([]);turns[turns.length-1].push(line)}
  return <>{turns.map(turn=>{
    const files=new Map<string,ChangedFile>()
    const final=turn.findLast(line=>!line.text&&line.changedFiles)
    for(const line of final?[final]:turn)if(line.status==='completed'||line.status==='success')for(const file of line.changedFiles??[]){const old=files.get(file.path);files.set(file.path,{...file,additions:file.additions+(old?.additions??0),deletions:file.deletions+(old?.deletions??0)})}
    return <div key={turn[0].key}>{turn.map(line=><TranscriptLine key={line.key} line={line}/>)}<Changes files={[...files.values()]}/></div>
  })}</>
}
