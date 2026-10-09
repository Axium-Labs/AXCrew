import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { Copy, Check, GitBranch, X } from 'lucide-react'
import { isTauri } from '@tauri-apps/api/core'
import { call as invoke } from '../lib/errors'
import { Dialog } from './ui/dialog'
import { useLang } from '../lib/i18n'
import type { ChangedFile, SessionLine, SessionImage } from '../lib/sessionTranscript'

type Interactions={root?:string;onChanges?:(files:ChangedFile[],path?:string)=>void;onBranch?:(line:SessionLine)=>void;onSideChat?:(text:string)=>void;onAddQuote?:(text:string)=>void}
const Context=createContext<Interactions>({})
export function SessionInteractions({value,children}:{value:Interactions;children:ReactNode}){return <Context.Provider value={value}>{children}</Context.Provider>}
export const useSessionInteractions=()=>useContext(Context)

export function MessageActions({line}:{line:SessionLine}){
  const lang=useLang(s=>s.lang),{onBranch}=useSessionInteractions()
  const [copied,setCopied]=useState(false),[error,setError]=useState('')
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),1800);return()=>clearTimeout(timer)},[copied])
  return <div className="session-message-actions"><button type="button" title={lang==='zh'?'复制':'Copy'} aria-label={lang==='zh'?'复制消息':'Copy message'} onClick={async()=>{try{await navigator.clipboard.writeText(line.text||line.images?.map(image=>image.name).join('\n')||'');setCopied(true);setError('')}catch{setError(lang==='zh'?'复制失败':'Copy failed')}}}>{copied?<Check size={15}/>:<Copy size={15}/>}</button>{line.type==='agent'&&onBranch&&<button type="button" aria-label={lang==='zh'?'创建聊天分支':'Branch conversation'} title={lang==='zh'?'从这里创建聊天分支':'Branch from here'} onClick={()=>onBranch(line)}><GitBranch size={15}/></button>}{error&&<small role="alert">{error}</small>}</div>
}

export function ImageLightbox({src,name,onClose}:{src:string;name:string;onClose:()=>void}){
  const lang=useLang(s=>s.lang)
  return <Dialog closeLabel={lang==='zh'?'关闭图片':'Close image'} open onOpenChange={open=>{if(!open)onClose()}} title={name} wide><img className="session-image-full" src={src} alt={name}/></Dialog>
}
export function MessageImage({image}:{image:SessionImage}){
  const {root}=useSessionInteractions(),lang=useLang(s=>s.lang)
  const [src,setSrc]=useState(image.src??''),[open,setOpen]=useState(false),[error,setError]=useState('')
  useEffect(()=>{
    let alive=true
    setSrc(image.src??'');setError('')
    if(!image.src&&image.path&&root&&isTauri())void invoke<string>('read_workspace_image',{root,relative:image.path}).then(value=>{if(alive)setSrc(value)}).catch(reason=>{if(alive)setError(String(reason))})
    return()=>{alive=false}
  },[root,image.path,image.src])
  return <><button type="button" className="session-sent-image" aria-label={`${lang==='zh'?'查看图片':'View image'} ${image.name}`} onClick={()=>{if(src)setOpen(true)}} disabled={!src}>{src?<img src={src} alt={image.name}/>:<span>{error||image.name}</span>}</button>{open&&<ImageLightbox src={src} name={image.name} onClose={()=>setOpen(false)}/>}</>
}

export function SelectionMenu({container}:{container:HTMLElement|null}){
  const {onSideChat,onAddQuote}=useSessionInteractions(),lang=useLang(s=>s.lang)
  const [selection,setSelection]=useState<{text:string;x:number;y:number}|null>(null)
  useEffect(()=>{
    if(!container)return
    const read=()=>{
      const selected=window.getSelection()
      if(!selected||selected.isCollapsed||!selected.rangeCount||!container.contains(selected.anchorNode)||!container.contains(selected.focusNode)){setSelection(null);return}
      const text=selected.toString().trim(),rect=selected.getRangeAt(0).getBoundingClientRect()
      if(!text){setSelection(null);return}
      setSelection({text,x:Math.max(12,Math.min(rect.left,window.innerWidth-330)),y:rect.top>48?rect.top-42:rect.bottom+8})
    }
    const close=()=>setSelection(null)
    const changed=()=>{if(window.getSelection()?.isCollapsed)close()}
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')close()}
    container.addEventListener('mouseup',read);container.addEventListener('keyup',read);container.addEventListener('scroll',close);document.addEventListener('selectionchange',changed);window.addEventListener('resize',close);window.addEventListener('keydown',key)
    return()=>{container.removeEventListener('mouseup',read);container.removeEventListener('keyup',read);container.removeEventListener('scroll',close);document.removeEventListener('selectionchange',changed);window.removeEventListener('resize',close);window.removeEventListener('keydown',key)}
  },[container])
  if(!selection)return null
  const run=(fn:((text:string)=>void)|undefined)=>{fn?.(selection.text);window.getSelection()?.removeAllRanges();setSelection(null)}
  return <div className="session-selection-menu" role="toolbar" aria-label={lang==='zh'?'选中文字操作':'Selected text actions'} style={{left:selection.x,top:selection.y}} onMouseDown={event=>event.preventDefault()}>{onAddQuote&&<button type="button" onClick={()=>run(onAddQuote)}>{lang==='zh'?'添加到对话':'Add to conversation'}</button>}{onSideChat&&<button type="button" onClick={()=>run(onSideChat)}>{lang==='zh'?'在侧边聊天中提问':'Ask in side chat'}</button>}<button type="button" aria-label={lang==='zh'?'关闭选择菜单':'Close selection menu'} onClick={()=>setSelection(null)}><X size={14}/></button></div>
}
