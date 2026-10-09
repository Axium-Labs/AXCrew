import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { useLang } from '../lib/i18n'

type Recognition={lang:string;continuous:boolean;interimResults:boolean;start:()=>void;stop:()=>void;abort:()=>void;onresult:((event:{results:{[index:number]:{[index:number]:{transcript:string}};length:number};resultIndex:number})=>void)|null;onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null}
export function VoiceInput({onText,onError,disabled=false}:{onText:(text:string)=>void;onError:(error:string)=>void;disabled?:boolean}){
  const lang=useLang(s=>s.lang),zh=lang==='zh',[recording,setRecording]=useState(false),recognition=useRef<Recognition|null>(null),callbacks=useRef({onText,onError})
  callbacks.current={onText,onError}
  const Constructor=(window as unknown as {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition}).SpeechRecognition??(window as unknown as {webkitSpeechRecognition?:new()=>Recognition}).webkitSpeechRecognition
  useEffect(()=>()=>{if(recognition.current){recognition.current.onend=null;recognition.current.onerror=null;recognition.current.onresult=null;recognition.current.abort()}},[])
  return <button type="button" className="session-composer-icon" aria-label={zh?(recording?'停止语音输入':'语音输入'):(recording?'Stop voice input':'Voice input')} title={!Constructor?(zh?'当前运行环境不支持语音输入':'Voice input is unavailable in this runtime'):undefined} disabled={disabled||!Constructor} aria-pressed={recording} onClick={()=>{
    if(recording){recognition.current?.stop();return}
    if(!Constructor)return
    const next=new Constructor();recognition.current=next;next.lang=zh?'zh-CN':'en-US';next.continuous=false;next.interimResults=false
    next.onresult=event=>{for(let i=event.resultIndex;i<event.results.length;i++)callbacks.current.onText(event.results[i][0].transcript)}
    next.onerror=event=>{setRecording(false);callbacks.current.onError(`${zh?'语音输入失败':'Voice input failed'}: ${event.error}`)};next.onend=()=>setRecording(false)
    try{next.start();setRecording(true)}catch(error){callbacks.current.onError(String(error))}
  }}>{recording?<MicOff size={18}/>:<Mic size={18}/>}</button>
}
