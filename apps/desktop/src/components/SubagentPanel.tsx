import { useLayoutEffect, useRef } from 'react'
import { Bot, GitBranch } from 'lucide-react'
import { useLang } from '../lib/i18n'
import { subagentStatus, type SessionLine } from '../lib/sessionTranscript'
import { TranscriptLines } from './SessionTranscript'
import { MessageMarkdown } from './MessageMarkdown'
import { SubagentStatusIcon } from './SubagentCard'
import { SessionInteractions } from './SessionInteractions'

export function SubagentPanel({agents,selectedId,onSelect,visible}:{agents:SessionLine[];selectedId:string|null;onSelect:(id:string)=>void;visible:boolean}){
  const lang=useLang(state=>state.lang),zh=lang==='zh'
  const selected=agents.find(line=>line.subagent?.agentId===selectedId)??agents.at(-1),agent=selected?.subagent
  const scroll=useRef<HTMLDivElement>(null),follow=useRef(true)
  useLayoutEffect(()=>{follow.current=true},[agent?.agentId])
  useLayoutEffect(()=>{const node=scroll.current;if(visible&&node&&follow.current)node.scrollTop=node.scrollHeight},[visible,agent?.lines,agent?.summary,agent?.agentId])
  if(!agent)return <div className="session-right-empty"><Bot size={26}/><strong>{zh?'子代理工作区':'Agent workspace'}</strong><small>{zh?'AX 委派任务后，可在这里查看每个子代理的任务、工作进度、工具调用和结果。此功能需要支持子代理事件的 AX。':'When AX delegates work, inspect each agent’s task, progress, tool calls and result here. Requires AX with subagent event support.'}</small></div>
  const parent=agents.find(line=>line.subagent?.agentId===agent.parentAgentId)?.text
  const running=agents.filter(line=>line.subagent?.status==='running').length
  return <section className="session-subagents" aria-label={zh?'子代理工作区':'Agent workspace'}>
    <header className="session-subagents-heading"><Bot size={16}/><strong>{zh?'子代理':'Agents'}</strong><span>{zh?`${agents.length} 个 · ${running} 个工作中`:`${agents.length} total · ${running} working`}</span></header>
    <div className="session-subagents-list" role="group" aria-label={zh?'选择子代理':'Select agent'}>{agents.map(line=>{
      const item=line.subagent!
      return <button key={item.agentId} type="button" aria-pressed={item.agentId===agent.agentId} onClick={()=>onSelect(item.agentId)} className={`session-subagents-item is-${item.status}`}>
        <SubagentStatusIcon status={item.status}/><span title={line.text}>{item.parentAgentId&&<GitBranch size={12}/>}<strong>{line.text}</strong></span><small>{subagentStatus(item.status,lang)}</small>
      </button>
    })}</div>
    <div className="session-subagent-detail" ref={scroll} onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.scrollTop-node.clientHeight<70}}>
      <header><h3>{selected!.text}</h3><span className={`session-subagent-status is-${agent.status}`}><SubagentStatusIcon status={agent.status}/>{subagentStatus(agent.status,lang)}</span></header>
      {parent&&<p className="session-subagent-parent"><GitBranch size={13}/>{zh?'由以下子代理委派：':'Delegated by: '}{parent}</p>}
      {agent.task&&<details className="session-subagent-task"><summary>{zh?'任务说明':'Task instructions'}</summary><MessageMarkdown text={agent.task}/></details>}
      <SessionInteractions value={{}}><div className="session-subagent-transcript"><TranscriptLines key={agent.agentId} lines={agent.lines} active={agent.status==='running'} taskStatus={agent.status==='failed'?'failed':['cancelled','interrupted'].includes(agent.status)?'cancelled':agent.status==='completed'?'completed':undefined} finishedAt={selected?.end}/></div></SessionInteractions>
      {!agent.lines.length&&!agent.summary&&<p className="session-subagent-waiting" role="status">{agent.status==='running'?(zh?'等待子代理输出…':'Waiting for agent output…'):(zh?'未保存工作内容。':'No work content was saved.')}</p>}
      {agent.summary&&!agent.lines.some(line=>line.type==='agent'&&line.text.trim()===agent.summary!.trim())&&<section className="session-subagent-result"><h4>{zh?'结果':'Result'}</h4><MessageMarkdown text={agent.summary}/></section>}
      {agent.error&&<div className="session-inline-error" role="alert">{agent.error}</div>}
      {agent.historyTruncated&&<p className="session-subagent-waiting" role="status">{zh?'此子代理的历史较长，当前仅加载了部分工作记录。':'This agent has a long history. Only part of its work record was loaded.'}</p>}
      {agent.status==='interrupted'&&<p className="session-subagent-waiting">{zh?'主任务已结束，未收到此子代理的结束记录。':'The main task ended without a final record for this agent.'}</p>}
    </div>
  </section>
}
