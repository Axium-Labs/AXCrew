import { ComposerSecondaryActions } from './ComposerSecondaryActions'
import { useAutoGrow } from '../lib/useAutoGrow'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, ChevronDown, ShieldCheck, Square, X, MessageSquarePlus, Plus } from 'lucide-react'
import { open } from '@tauri-apps/plugin-dialog'
import { call as invoke } from '../lib/errors'
import { api, endpoints } from '../lib/api'
import type { AxModel } from '../lib/ax'
import type { Task, Session } from '../lib/types'
import { conversationTranscript } from '../lib/sessionTranscript'
import { isActiveTask } from '../lib/conversations'
import { useTasks, useSessions } from '../lib/query'
import { useLive } from '../lib/live'
import { useLang, useT } from '../lib/i18n'
import { selectedEffort } from '../lib/modelControls'
import { imageFromFile, type AttachedImage } from '../lib/composerImages'
import { TranscriptLines } from './SessionTranscript'
import { ModelControls } from './ModelControls'
import { VoiceInput } from './VoiceInput'
import { Menu } from './ui/menu'

type Props={quotes:string[];onQuotesChange:(quotes:string[])=>void;cwd?:string;memberId?:string;models:AxModel[];initialModel?:AxModel|null;fast:boolean;onFast:()=>void;fastDisabled:boolean;remote:boolean;onRemoteModel:(provider:string,model:string)=>Promise<void>;onTask:(id:string)=>void}
export function SideChat({quotes,onQuotesChange,cwd,memberId,models,initialModel,fast,onFast,fastDisabled,remote,onRemoteModel,onTask}:Props){
  const lang=useLang(s=>s.lang),t=useT(),navigate=useNavigate(),query=useQueryClient(),tasks=useTasks(),sessions=useSessions(),streams=useLive(s=>s.streams)
  const [taskId,setTaskId]=useState<string>(),[draft,setDraft]=useState(''),[sending,setSending]=useState(false),[error,setError]=useState('')
  const [permission,setPermission]=useState<'read'|'ask'|'trust'|'yolo'>('read'),[effort,setEffort]=useState(''),[pickedModel,setPickedModel]=useState<AxModel|null>(null),[boundModel,setBoundModel]=useState<AxModel|null>(null)
  const [images,setImages]=useState<AttachedImage[]>([]),[files,setFiles]=useState<string[]>([])
  const [boundWorkspace,setBoundWorkspace]=useState<{cwd?:string;memberId?:string;remote:boolean}|null>(null)
  const activeWorkspace=taskId&&boundWorkspace?boundWorkspace:{cwd,memberId,remote}
  const lock=useRef(false),scroll=useRef<HTMLDivElement>(null),follow=useRef(true),imageInput=useRef<HTMLInputElement>(null)
  const task=tasks.data?.find(task=>task.id===taskId),binding=sessions.data?.find(session=>session.task_id===taskId),busy=isActiveTask(task)
  const selection=taskId?boundModel:pickedModel??initialModel
  const model=models.find(model=>model.provider===selection?.provider&&model.id===selection?.id)??selection
  const effectiveEffort=selectedEffort(model,effort)
  const history=useQuery({queryKey:['history',taskId],queryFn:()=>endpoints.history(taskId!),enabled:!!binding,retry:1,refetchOnWindowFocus:false})
  const settled=!!task?.finished_at&&history.dataUpdatedAt>task.finished_at*1000&&!history.isFetching&&!history.isError
  const lines=conversationTranscript(history.data,streams[taskId??'']??[],task,!settled)
  useEffect(()=>{if(follow.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight},[lines])
  const inputRef=useRef<HTMLTextAreaElement>(null)
  useAutoGrow(inputRef,draft)
  const addImages=async(selected:File[])=>{try{if(images.length+selected.length>4)throw new Error(t('error.tooManyImages'));const added=await Promise.all(selected.map(file=>imageFromFile(file,t)));setImages(current=>[...current,...added]);setError('')}catch(reason){setError(String(reason))}}
  const send=async()=>{
    const text=draft.trim();if((!text&&!images.length&&!files.length)||lock.current||(busy&&!binding)||(!activeWorkspace.cwd&&!activeWorkspace.memberId))return
    lock.current=true;setSending(true);setError('')
    try{
      if(activeWorkspace.remote&&images.length)throw new Error(lang==='zh'?'远程会话暂不支持图片附件':'Remote sessions do not support image attachments yet')
      const context=[...quotes.map(text=>({role:'user',text})),...await Promise.all(files.map(async path=>({role:'user',text:`File: ${path}\n${await invoke<string>('read_workspace_file',{root:activeWorkspace.cwd,relative:path})}`})))],body={text:text||(files.length?(lang==='zh'?'请查看附加的工作区文件。':'Review the attached workspace files.'):''),images,permission_profile:permission,...(effectiveEffort?{reasoning_effort:effectiveEffort}:{}),context}
      const created=taskId?await api<Task>(`/api/sessions/${encodeURIComponent(taskId)}/message`,'POST',body):await api<Task>('/api/sessions','POST',{...body,title:lang==='zh'?`侧边聊天：${text.slice(0,30)||t('session.imageTitle')}`:`Side chat: ${text.slice(0,30)||t('session.imageTitle')}`,...(memberId?{member_id:memberId}:{cwd,provider:model?.provider,model:model?.id})})
      query.setQueryData<Task[]>(['tasks'],old=>[...(old??[]).filter(task=>task.id!==created.id),created])
      if(binding)query.setQueryData<Session[]>(['sessions'],old=>[...(old??[]).filter(session=>session.task_id!==created.id),{...binding,task_id:created.id}])
      if(!taskId){setBoundModel(model??null);setBoundWorkspace({cwd,memberId,remote})}
      onTask(created.id);setTaskId(created.id);setDraft('');setImages([]);setFiles([]);follow.current=true
      void query.invalidateQueries({queryKey:['sessions']});void query.invalidateQueries({queryKey:['tasks']})
    }catch(reason){setError(String(reason))}finally{lock.current=false;setSending(false)}
  }
  return <div className="session-side-chat"><header><MessageSquarePlus size={18}/><strong>{lang==='zh'?'侧边聊天':'Side chat'}</strong><button type="button" aria-label={lang==='zh'?'新建侧边聊天':'New side chat'} disabled={busy||sending} onClick={()=>{setTaskId(undefined);setBoundModel(null);setBoundWorkspace(null);setDraft('');setImages([]);setFiles([]);setError('');onQuotesChange([])}}><Plus size={17}/></button></header><div className="session-side-chat-scroll" ref={scroll} onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.clientHeight-node.scrollTop<80}}>{lines.length?<TranscriptLines lines={lines} active={busy} finishedAt={task?.finished_at?task.finished_at*1000:undefined}/>:<div className="session-side-chat-empty"><MessageSquarePlus size={34}/><strong>{lang==='zh'?'侧边聊天':'Side chat'}</strong><p>{lang==='zh'?'围绕选中文字提问，主聊天保持原处。':'Ask about selected text while keeping your main conversation in place.'}</p></div>}</div>
    <form className="session-side-composer" onSubmit={event=>{event.preventDefault();void send()}} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void addImages([...event.dataTransfer.files])}}>
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event=>{void addImages([...event.target.files??[]]);event.target.value=''}}/>
      {(quotes.length>0||files.length>0)&&<div className="session-side-quotes">{quotes.map((quote,index)=><div key={index}><span title={quote}>{quote}</span><button type="button" aria-label={lang==='zh'?'移除文字片段':'Remove quoted passage'} onClick={()=>onQuotesChange(quotes.filter((_,i)=>i!==index))}><X size={13}/></button></div>)}{files.map(path=><div key={path}><span title={path}>{path}</span><button type="button" aria-label={lang==='zh'?'移除文件':'Remove file'} onClick={()=>setFiles(files.filter(item=>item!==path))}><X size={13}/></button></div>)}</div>}
      {!!images.length&&<div className="session-image-previews">{images.map((image,index)=><div className="session-image-preview" key={index}><img src={`data:${image.mime};base64,${image.data}`} alt={image.name}/><button type="button" aria-label={t('session.removeImage',{index:index+1})} onClick={()=>setImages(images.filter((_,i)=>i!==index))}><X size={13}/></button></div>)}</div>}
      <textarea ref={inputRef} aria-label={lang==='zh'?'侧边聊天输入':'Side chat message'} placeholder={lang==='zh'?'随心输入':'Ask anything'} value={draft} onChange={event=>setDraft(event.target.value)} onPaste={event=>{const images=[...event.clipboardData.files].filter(file=>file.type.startsWith('image/'));if(images.length)void addImages(images)}} disabled={sending} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send()}}}/>
      <div className="session-side-composer-actions"><Menu trigger={<button type="button" className="session-composer-icon" aria-label={t('session.addContext')} disabled={sending}><Plus size={20}/></button>} items={[{label:t('session.addImage'),disabled:activeWorkspace.remote,action:()=>imageInput.current?.click()},{label:t('session.referenceFile'),disabled:activeWorkspace.remote,action:()=>{void (async()=>{try{const result=await open({multiple:true,directory:false,defaultPath:activeWorkspace.cwd});if(result)setFiles(current=>[...new Set([...current,...(Array.isArray(result)?result:[result])])])}catch(reason){setError(String(reason))}})()}}]}/>
        <ComposerSecondaryActions><Menu trigger={<button type="button" className={`session-composer-permission ${permission==='yolo'?'is-full':''}`} aria-label={t('session.accessMode')} title={t('session.permission.'+permission)}><ShieldCheck size={16}/><ChevronDown size={12}/></button>} items={(['ask','read','trust','yolo'] as const).map(mode=>({label:<><strong>{t('session.permission.'+mode)}</strong><small>{t('session.permission.'+mode+'Hint')}</small></>,action:()=>setPermission(mode)}))}/><VoiceInput disabled={sending} onText={text=>setDraft(current=>(current?current+' ':'')+text)} onError={setError}/></ComposerSecondaryActions>
        <div className="session-composer-spacer"/><ModelControls models={models} model={model} effort={effectiveEffort} onEffort={setEffort} onModel={async(provider,id)=>{if(taskId)return;try{if(remote)await onRemoteModel(provider,id);setPickedModel(models.find(model=>model.provider===provider&&model.id===id)??null);setError('')}catch(reason){setError(String(reason))}}} modelDisabled={!!taskId} fast={fast} fastDisabled={fastDisabled} onFast={onFast} emptyHint={t('session.connectModel')} onConfigure={()=>navigate('/settings/models')}/>
        {busy&&<button type="button" className="session-send-button session-stop-button" aria-label={lang==='zh'?'停止侧边聊天':'Stop side chat'} disabled={sending} onClick={async()=>{try{await api(`/api/tasks/${taskId}/cancel`,'POST',{});void query.invalidateQueries({queryKey:['tasks']})}catch(reason){setError(String(reason))}}}><Square size={14}/></button>}<button type="submit" className="session-send-button" aria-label={lang==='zh'?'发送侧边消息':'Send side chat message'} disabled={(!draft.trim()&&!images.length&&!files.length)||sending||(busy&&!binding)||(!activeWorkspace.cwd&&!activeWorkspace.memberId)}><ArrowUp size={19}/></button>
      </div>{error&&<p className="session-inline-error" role="alert">{error}</p>}
    </form></div>
}
