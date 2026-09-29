import { create } from 'zustand'
import { getConnection } from './api'
import { queryClient } from './runtime'
import type { CrewEvent } from './types'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'

export type ConnectionStatus='Disconnected'|'Connecting'|'Connected'|'Reconnecting'
type Live={status:ConnectionStatus;events:CrewEvent[];streams:Record<string,CrewEvent[]>;setStatus:(status:ConnectionStatus)=>void;add:(items:CrewEvent[])=>void}
export const useLive=create<Live>(set=>({status:'Disconnected',events:[],streams:{},setStatus:status=>set({status}),add:items=>set(state=>{
  const streams={...state.streams}
  for(const event of [...items].reverse()){
    if(!event.task_id||!String(event.payload.sessionUpdate??'').length)continue
    const previous=streams[event.task_id]??[],last=previous.at(-1)
    const kind=event.payload.sessionUpdate
    const incoming=event.payload.content as {text?:string}|undefined
    const prior=last?.payload.content as {text?:string}|undefined
    if(last&&kind===last.payload.sessionUpdate&&['agent_message_chunk','agent_thought_chunk'].includes(String(kind))&&last.payload.messageId===event.payload.messageId&&typeof incoming?.text==='string'&&typeof prior?.text==='string'){
      streams[event.task_id]=[...previous.slice(0,-1),{...event,payload:{...event.payload,content:{...incoming,text:prior.text+incoming.text}}}]
    }else streams[event.task_id]=[...previous,event]
    // Keep recent conversations independently of the bounded Activity feed.
    if(Object.keys(streams).length>50)delete streams[Object.keys(streams)[0]]
  }
  return {events:[...items,...state.events].slice(0,500),streams}
})}))
const seen=new Set<string>()
let socket:WebSocket|undefined
let stopped=false
let generation=0
let retryTimer:ReturnType<typeof setTimeout>|undefined
let reconnect=0
let batch:CrewEvent[]=[]
let flushTimer:ReturnType<typeof setTimeout>|undefined
function flush(){if(batch.length){useLive.getState().add(batch.reverse());batch=[]}flushTimer=undefined}
async function notify(event:CrewEvent){
  if(!['device.disconnected','permission.requested'].includes(event.kind))return
  try{let granted=await isPermissionGranted();if(!granted)granted=(await requestPermission())==='granted';const request=event.payload?.request as {toolCall?:{title?:string}}|undefined;if(granted)sendNotification({title:event.kind==='permission.requested'?'AX Crew 需要授权':'AX 设备已断开',body:String(event.payload?.reason??request?.toolCall?.title??event.device_id??'AX Crew')})}catch{/* permission declined or unavailable */}
}
function consume(event:CrewEvent){
  if(seen.has(event.event_id))return
  seen.add(event.event_id);if(seen.size>5000)seen.clear()
  ;(event as CrewEvent&{received_at:number}).received_at=Date.now()
  batch.push(event);if(!flushTimer)flushTimer=setTimeout(flush,90)
  if(event.kind.startsWith('device.'))queryClient.invalidateQueries({queryKey:['devices']})
  if(event.kind.startsWith('task.')){queryClient.invalidateQueries({queryKey:['tasks']});if(event.task_id&&['task.completed','task.failed','task.cancelled'].includes(event.kind))queryClient.invalidateQueries({queryKey:['history',event.task_id]})}
  if(event.kind.startsWith('permission.'))queryClient.invalidateQueries({queryKey:['permissions']})
  if(event.kind.startsWith('crew.')||event.kind.startsWith('member.')){queryClient.invalidateQueries({queryKey:['crews']});queryClient.invalidateQueries({queryKey:['members']});queryClient.invalidateQueries({queryKey:['allMembers']})}
  if(event.kind==='session.bound')queryClient.invalidateQueries({queryKey:['sessions']})
  void notify(event)
}
export function startLive(){stopped=false;const current=++generation;void connect(current);return ()=>{if(current!==generation)return;stopped=true;++generation;if(retryTimer)clearTimeout(retryTimer);socket?.close();if(flushTimer)clearTimeout(flushTimer);flush()}}
async function connect(current:number){
  if(stopped||current!==generation)return
  useLive.getState().setStatus(reconnect?'Reconnecting':'Connecting')
  try{
    const {endpoint,token}=await getConnection()
    if(stopped||current!==generation)return
    const connectionSocket=new WebSocket(`${endpoint.replace(/^http/,'ws')}/api/ws?token=${encodeURIComponent(token)}`)
    socket=connectionSocket
    connectionSocket.onopen=()=>{if(stopped||current!==generation)return;reconnect=0;useLive.getState().setStatus('Connected');void queryClient.invalidateQueries()}
    connectionSocket.onmessage=message=>{if(stopped||current!==generation)return;try{consume(JSON.parse(message.data) as CrewEvent)}catch{/* malformed frame */}}
    connectionSocket.onclose=()=>retry(current)
    connectionSocket.onerror=()=>connectionSocket.close()
  }catch{retry(current)}
}
function retry(current:number){if(stopped||current!==generation)return;useLive.getState().setStatus('Disconnected');reconnect=Math.min(reconnect+1,7);retryTimer=setTimeout(()=>void connect(current),Math.min(1000*2**reconnect,15000))}
