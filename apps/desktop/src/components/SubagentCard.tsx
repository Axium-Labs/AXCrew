import { createContext, useContext } from 'react'
import { Bot, Check, ChevronRight, CircleAlert, LoaderCircle, Square } from 'lucide-react'
import { subagentStatus, type SessionLine } from '../lib/sessionTranscript'
import { useLang } from '../lib/i18n'
import './subagents.css'

export const SubagentNavigation = createContext<((id:string)=>void)|undefined>(undefined)

export function SubagentStatusIcon({status}:{status:string}){
  return status==='running'?<LoaderCircle size={14} className="subagent-spinner"/>:status==='completed'?<Check size={14}/>:status==='failed'?<CircleAlert size={14}/>:<Square size={12}/>
}

export function SubagentCard({line}:{line:SessionLine}){
  const lang=useLang(state=>state.lang),open=useContext(SubagentNavigation)
  const agent=line.subagent
  if(!agent)return null
  return <button type="button" className={`session-subagent-card is-${agent.status}`} onClick={()=>open?.(agent.agentId)} disabled={!open} aria-label={`${lang==='zh'?'查看子代理':'View agent'} ${line.text}`}>
    <Bot size={17}/><span className="session-subagent-caption"><strong>{line.text}</strong><small><SubagentStatusIcon status={agent.status}/>{subagentStatus(agent.status,lang)}</small></span><ChevronRight size={15}/>
  </button>
}
