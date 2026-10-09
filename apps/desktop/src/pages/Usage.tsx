import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useT, useLang } from '../lib/i18n'
import './usage.css'

type Counts={input:number;output:number;cached:number;messages:number;tools:number;skills:number;unreported:number}
type Report={start:number;today:number;totals:Counts;daily:{day:number;model:string;client:string;counts:Counts}[];ranking:{id:string;title:string;model:string;client:string;counts:Counts}[];warnings:{code:'unreadable_projects'|'unreadable_sessions'|'damaged_lines';count:number}[]}
const colors=['#8a76e8','#56b6c2','#63bd92','#d8a94e','#e58a6e','#d877b4']
const format=(value:number)=>value.toLocaleString()
function Chart({data,metric,group,title}:{data:Report;metric:keyof Counts;group:'model'|'client';title:string}){
  const t=useT(),lang=useLang(state=>state.lang)
  const days=Array.from({length:data.today-data.start+1},(_,i)=>data.start+i)
  const groups=[...new Set(data.daily.filter(row=>row.counts[metric]>0).map(row=>row[group]))]
  const values=groups.map(name=>days.map(day=>data.daily.filter(row=>row.day===day&&row[group]===name).reduce((sum,row)=>sum+row.counts[metric],0)))
  const max=Math.max(3,Math.ceil(Math.max(0,...values.flat())/3)*3)
  const date=(day:number)=>new Date(day*86400000).toLocaleDateString(lang==='en'?'en-US':'zh-CN',{month:'short',day:'numeric',timeZone:'UTC'})
  return <section className="usage-card"><h2>{title}</h2><strong className="usage-total">{format(data.totals[metric])}</strong>
    {groups.length?<><svg className="usage-chart" viewBox="0 0 800 210" role="img" aria-label={title}>
      {[0,1,2,3].map(i=><g key={i}><line x1="58" x2="785" y1={20+i*50} y2={20+i*50} stroke="currentColor" opacity=".1"/><text x="4" y={24+i*50}>{format(Math.round(max*(1-i/3)))}</text></g>)}
      {values.map((series,i)=><polyline key={groups[i]} points={series.map((value,index)=>`${58+index/Math.max(1,days.length-1)*727},${170-value/max*150}`).join(' ')} fill="none" stroke={colors[i%colors.length]} strokeWidth="2.5"/>)}
      {[0,Math.floor((days.length-1)/2),days.length-1].map((i,j)=><text key={j} x={58+i/Math.max(1,days.length-1)*727} y="202" textAnchor={j===0?'start':j===2?'end':'middle'}>{date(days[i])}</text>)}
    </svg><div className="usage-legend">{groups.map((name,i)=><span key={name}><i style={{background:colors[i%colors.length]}}/>{name==='Unreported'?t('usage.unreported'):name}</span>)}</div></>:<p className="usage-empty">{t('usage.empty')}</p>}
  </section>
}
export function Usage(){
  const t=useT(),[days,setDays]=useState(7),[group,setGroup]=useState<'model'|'client'>('model'),[more,setMore]=useState(false)
  const report=useQuery({queryKey:['usage',days],queryFn:()=>api<Report>(`/api/usage?days=${days}&offset=${new Date().getTimezoneOffset()}`),refetchInterval:60000})
  const data=report.data
  return <div className="usage-page"><div className="usage-heading"><p>{t('usage.note')}</p><div className="ax-segmented usage-switch"><button className={days===7?'is-active':''} onClick={()=>setDays(7)}>7 {useLang.getState().lang==='en'?'days':'天'}</button><button className={days===30?'is-active':''} onClick={()=>setDays(30)}>30 {useLang.getState().lang==='en'?'days':'天'}</button></div></div>
    {report.isError&&<p role="alert" className="ax-notice is-error">{String(report.error)}</p>}{report.isLoading&&<p role="status">…</p>}
    {data&&<><div className="usage-metrics">{(['input','output','cached','unreported'] as const).map(key=><section className="usage-card" key={key}><span>{t(`usage.${key}`)}</span><strong>{format(data.totals[key])}</strong></section>)}</div>
      <div className="ax-segmented usage-switch usage-group"><button className={group==='model'?'is-active':''} onClick={()=>setGroup('model')}>{t('usage.model')}</button><button className={group==='client'?'is-active':''} onClick={()=>setGroup('client')}>{t('usage.client')}</button></div>
      <Chart data={{...data,totals:{...data.totals,input:data.totals.input+data.totals.output},daily:data.daily.map(row=>({...row,counts:{...row.counts,input:row.counts.input+row.counts.output}}))}} metric="input" group={group} title={t('usage.tokens')}/>
      <Chart data={data} metric="messages" group={group} title={t('usage.messages')}/>
      <Chart data={data} metric="tools" group="client" title={t('usage.tools')}/><Chart data={data} metric="skills" group="client" title={t('usage.skills')}/>
      <section className="usage-card"><h2>{t('usage.ranking')}</h2><div className="usage-table"><table><thead><tr><th>{t('session.title')}</th><th>{t('usage.tokens')}</th><th>{t('usage.messages')}</th></tr></thead><tbody>{data.ranking.slice(0,more?undefined:5).map(row=><tr key={row.id}><td><details><summary>{row.title}</summary><p>{row.client} · {row.model==='Unreported'?t('usage.unreported'):row.model}</p><p>{t('usage.input')}: {format(row.counts.input)} · {t('usage.output')}: {format(row.counts.output)} · {t('usage.cached')}: {format(row.counts.cached)}</p><p>{t('usage.tools')}: {row.counts.tools} · {t('usage.skills')}: {row.counts.skills} · {t('usage.unreported')}: {row.counts.unreported}</p></details></td><td>{format(row.counts.input+row.counts.output)}</td><td>{row.counts.messages}</td></tr>)}</tbody></table>{!data.ranking.length&&<p>{t('usage.empty')}</p>}</div>{data.ranking.length>5&&!more&&<button className="usage-more" onClick={()=>setMore(true)}>{t('usage.more')}</button>}</section>
      {!!data.warnings.length&&<p role="status" className="ax-notice">{data.warnings.map(warning=>t('usage.warning.'+warning.code,{count:warning.count})).join('\n')}</p>}
    </>}
  </div>
}
