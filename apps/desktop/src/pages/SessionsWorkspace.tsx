import { usePanelDrawer } from '../lib/usePanelDrawer'
import { useWorkspaceLayout } from '../lib/workspaceLayoutContext'
import { WorkspaceSplitter } from '../components/WorkspaceSplitter'
import { ComposerSecondaryActions } from '../components/ComposerSecondaryActions'
import { useUi } from '../store/ui'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { useAutoGrow } from '../lib/useAutoGrow'
import { resolveSendWorkspace } from '../lib/workspace'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowUp, Check, Cloud, ChevronDown, ChevronRight, ExternalLink, Folder, FolderPlus, Laptop, MessageSquare, MoreHorizontal, PanelRight, Plus, Search, Square, SquarePen, ShieldCheck, SlidersHorizontal, Target, X } from 'lucide-react'
import { api, endpoints } from '../lib/api'
import { useAllMembers, useDevices, useLocalAx, usePermissions, useSessions, useTasks } from '../lib/query'
import { useLive } from '../lib/live'
import { useSessionUi } from '../store/sessions'
import { conversations, isActiveTask } from '../lib/conversations'
import { Action } from '../components/shared'
import { Menu } from '../components/ui/menu'
import { conversationTranscript, latestTurnChangedFiles } from '../lib/sessionTranscript'
import type { LocalAxSession, Session, Task } from '../lib/types'
import { TranscriptLines } from '../components/SessionTranscript'
import { ModelControls } from '../components/ModelControls'
import { TurnNavigator } from '../components/TurnNavigator'
import { selectedEffort } from '../lib/modelControls'
import { ImageLightbox, SelectionMenu, SessionInteractions } from '../components/SessionInteractions'
import { UnifiedFilePanel, type FileReviewRequest } from '../components/UnifiedFilePanel'
import { SideChat } from '../components/SideChat'
import type { ChangedFile, SessionLine } from '../lib/sessionTranscript'
import { GoalLoopDialog, type LoopStart } from '../components/GoalLoopDialog'
import { startGoalLoop, stopGoalLoop } from '../lib/goalLoop'
import { stopFileRelative, useGoalLoop, type LoopRun } from '../store/goal'
import { open } from '@tauri-apps/plugin-dialog'
import { axAvailable, axLocalState, axSelectModel, axSelectInferenceMode } from '../lib/ax'
import { call as invoke } from '../lib/errors'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { useTerminalDock } from '../store/terminal'
import { useLang, useT } from '../lib/i18n'
import { ProjectDialog, useConnectionText } from '../components/ConnectionDialogs'
import { connections } from '../lib/connections'
import './sessions.css'

import { imageFromFile, type AttachedImage } from '../lib/composerImages'
import { VoiceInput } from '../components/VoiceInput'
const slashCommands=[
  {name:'/new',key:'session.slash.new'},{name:'/model',key:'session.slash.model'},
  {name:'/login',key:'session.slash.login'},{name:'/logout',key:'session.slash.logout'},
  {name:'/memory',key:'session.slash.memory'},{name:'/permissions',key:'session.slash.permissions'},
  {name:'/status',key:'session.slash.status'},{name:'/resume',key:'session.slash.resume'},
  {name:'/skills',key:'session.slash.skills'},{name:'/tools',key:'session.slash.tools'},
  {name:'/mcp',key:'session.slash.mcp'},{name:'/compact',key:'session.slash.compact'},
] as const
const PROJECT_KEY='ax-crew.projects'
// Projects are directories; the same directory may be spelled with either slash.
const normalizePath=(value:string)=>value.replace(/\\/g,'/').replace(/^\/\/\?\//,'').replace(/\/+$/,'').toLowerCase()
const baseName=(value:string)=>value.replace(/\\/g,'/').replace(/\/+$/,'').split('/').pop()||value
function loadProjectDirs(){
  try{const value=JSON.parse(localStorage.getItem(PROJECT_KEY)??'[]');return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[]}catch{return []}
}

function timeLabel(value?:number|null){
  if(!value)return ''
  const ms=value<1e12?value*1000:value
  const date=new Date(ms)
  const now=new Date()
  const locale=useLang.getState().lang==='en'?'en-US':'zh-CN'
  const clock=date.toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'})
  return date.toDateString()===now.toDateString()?clock:`${date.getMonth()+1}/${date.getDate()} ${clock}`
}

function LocalThread({session,onLines}:{session:LocalAxSession|undefined;onLines:(lines:SessionLine[])=>void}){
  const t=useT()
  const history=useQuery({queryKey:['local-session',session?.id],queryFn:()=>endpoints.localSession(session!.id),enabled:!!session,retry:1,refetchOnWindowFocus:false})
  const lines=useMemo(()=>conversationTranscript(history.data,[],undefined,false),[history.data])
  useEffect(()=>onLines(lines),[lines,onLines])
  if(!session)return <div className="session-thread-waiting">{t('session.readingLocal')}</div>
  return <div className="session-transcript">
    {history.isError&&<div className="session-inline-error">{t('session.loadLocalFailed')}{String(history.error)} <button onClick={()=>void history.refetch()}>{t('session.retry')}</button></div>}
    {!history.isLoading&&!history.isError&&!lines.length&&<div className="session-thread-waiting">{t('session.noMessages')}</div>}
    <TranscriptLines lines={lines}/>
  </div>
}

export function SessionsWorkspace(){
  const {id}=useParams(),navigate=useNavigate(),location=useLocation(),queryClient=useQueryClient(),[params]=useSearchParams()
  const t=useT(),connectionText=useConnectionText()
  const ui=useSessionUi()
  const namedProjects=useQuery({queryKey:["named-projects"],queryFn:connections.projects})
  const [projectDialog,setProjectDialog]=useState(false),[cloud,setCloud]=useState(!!ui.selectedEnvironment)
  const {setListOpen:saveListOpen,rightOpen,setRightOpen,rightTab,setRightTab,thinkingEffort,setThinkingEffort}=ui
  const sessions=useSessions(),tasks=useTasks(),members=useAllMembers(),devices=useDevices(),permissions=usePermissions(),localAx=useLocalAx()
  const settings=useQuery({queryKey:['settings'],queryFn:endpoints.settings})
  const ax=useQuery({queryKey:['ax-local'],queryFn:axLocalState,enabled:axAvailable,retry:false})
  const [switchingInference,setSwitchingInference]=useState(false)
  const fastInference=ax.data?.inference_mode==='fast'
  const toggleInference=async()=>{
    if(switchingInference)return
    setSwitchingInference(true)
    try{
      const mode=await axSelectInferenceMode(fastInference?'standard':'fast')
      queryClient.setQueryData<import('../lib/ax').AxLocalState>(['ax-local'],state=>state?{...state,inference_mode:mode}:state)
      setSendError('')
    }catch(error){setSendError(String(error))}finally{setSwitchingInference(false)}
  }
  const listRef=useRef<HTMLElement>(null),previewRef=useRef<HTMLElement>(null)
  const layout=useWorkspaceLayout(),[listDrawerOpen,setListDrawerOpen]=useState(false)
  const listOpen=layout.listDocked||listDrawerOpen
  usePanelDrawer(listRef,listDrawerOpen&&!layout.listDocked)
  usePanelDrawer(previewRef,layout.rightMode==='drawer'&&!listDrawerOpen)
  const setListOpen=(open:boolean)=>{saveListOpen(open);setListDrawerOpen(open&&!layout.listDocked)}
  useEffect(()=>{if(layout.listDocked)setListDrawerOpen(false)},[layout.listDocked])
  const resetLayout=()=>{ui.resetLayout();useUi.getState().setSidebar(true);setListDrawerOpen(false)}
  const [context,setContext] = useState<{id:string;title:string;active:boolean;x:number;y:number}|null>(null)
  const [editSession,setEditSession] = useState<{id:string;kind:'title'|'project';value:string}|null>(null)
  const [deleteTarget,setDeleteTarget] = useState<{id:string;title:string}|null>(null)
  const [deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState('')
  const metadataKey = (key:string) => key.includes(':')?key:`local:${key}`
  const meta = (key:string) => ui.metadata[metadataKey(key)] ?? {}
  const label = (key:string,title:string) => `${meta(key).marked?'★ ':''}${meta(key).title??title}`
  const contextSession = (event: React.MouseEvent, key:string, title:string, active:boolean) => {
    event.preventDefault()
    setContext({id:metadataKey(key),title:meta(key).title??title,active,x:Math.min(event.clientX,window.innerWidth-230),y:Math.min(event.clientY,window.innerHeight-240)})
  }
  useEffect(()=>{
    const close = () => setContext(null)
    const key = (event: globalThis.KeyboardEvent) => { if(event.key==='Escape'){close();setEditSession(null)} }
    window.addEventListener('click',close);window.addEventListener('keydown',key);window.addEventListener('scroll',close,true)
    return()=>{window.removeEventListener('click',close);window.removeEventListener('keydown',key);window.removeEventListener('scroll',close,true)}
  },[])

  const [search,setSearch]=useState(''),[onlyActive,setOnlyActive]=useState(false),[projectsOpen,setProjectsOpen]=useState(true),[recentOpen,setRecentOpen]=useState(true)
  const [projectDirs,setProjectDirs]=useState<string[]>(loadProjectDirs),[openProject,setOpenProject]=useState<string|null>(null)
  const [sending,setSending]=useState(false),[sendError,setSendError]=useState('')
  const [imagesByDraft,setImagesByDraft]=useState<Record<string,AttachedImage[]>>({})
  const [imagePreview,setImagePreview]=useState<AttachedImage|null>(null)
  const [localLines,setLocalLines]=useState<SessionLine[]>([])
  const [branchDraft,setBranchDraft]=useState<{key:string;title:string;memberId?:string;lines:SessionLine[];context:{role:string;text:string}[]}|null>(null)
  const [changedView,setChangedView]=useState<{files:ChangedFile[];request?:FileReviewRequest;root?:string;liveKey?:string}>({files:[]})
  const [sideQuotes,setSideQuotes]=useState<string[]>([]),[sideTaskIds,setSideTaskIds]=useState<string[]>([])
  const [selectionContainer,setSelectionContainer]=useState<HTMLDivElement|null>(null)
  const [goalOpen,setGoalOpen]=useState(false)
  const [cursor,setCursor]=useState(0),[completionIndex,setCompletionIndex]=useState(0),[completionClosed,setCompletionClosed]=useState(false)
  const inputRef=useRef<HTMLTextAreaElement>(null),imageInputRef=useRef<HTMLInputElement>(null),scrollRef=useRef<HTMLDivElement>(null),followScroll=useRef(true),sendLock=useRef(false),mounted=useRef(true)
  const attachScroll=useCallback((node:HTMLDivElement|null)=>{scrollRef.current=node;setSelectionContainer(node)},[])
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const locationRef=useRef(location.key);locationRef.current=location.key
  const groups=useMemo(()=>conversations(sessions.data??[],tasks.data??[],[...ui.startingIds,...(id?[id]:[])]),[sessions.data,tasks.data,ui.startingIds,id])
  const current=groups.find(group=>group.tasks.some(task=>task.id===id))
  const task=current?.latest??tasks.data?.find(item=>item.id===id)
  const selectedBinding=current?.binding
  const localId=params.get('local'),localMode=!!localId&&!id
  const draftKey=current?.root.id??id??(localId?`local:${localId}`:branchDraft?.key??'new')
  // While tasks/bindings load, a route may still use its turn ID. Keep the newest
  // draft across those aliases so adopting a canonical conversation never drops text.
  const draftAliases=[...new Set([draftKey,...(id?[id]:[]),...(current?.tasks.map(item=>item.id)??[])])]
  const draftSource=draftAliases.reduce((best,key)=>ui.drafts[key]!==undefined&&(ui.drafts[best]===undefined||(ui.draftUpdatedAt[key]??0)>(ui.draftUpdatedAt[best]??0))?key:best,draftKey)
  const draft=ui.drafts[draftSource]??ui.drafts[draftKey]??''
  useAutoGrow(inputRef,draft,location.key)
  const images=imagesByDraft[draftKey]??[]
  // A loop keeps the key it was started under, so resolve it through the conversation's tasks:
  // the draft key changes as soon as the first pushed round creates the session.
  const runs=useGoalLoop(state=>state.runs)
  const loopKey=useMemo(()=>{
    const belongs=(taskId:string|null)=>!!taskId&&(taskId===id||!!current?.tasks.some(item=>item.id===taskId))
    const direct=runs[draftKey]
    if(direct&&(!direct.taskId||belongs(direct.taskId)))return draftKey
    return Object.entries(runs).find(([,run])=>belongs(run.taskId))?.[0]
  },[runs,draftKey,id,current])
  const loopRun=loopKey?runs[loopKey]:undefined
  const permissionMode=ui.permissionModes[draftKey]??ui.defaultPermission
  const setDraft=(text:string)=>{for(const key of new Set([draftKey,...(id?[id]:[])]))ui.setDraft(key,text)}
  const selectedMember=members.data?.find(item=>item.id===task?.assigned_member)
  const chosenEnvironment=members.data?.find(item=>item.id===ui.selectedEnvironment&&item.device_id!=="local")
  const member=id?selectedMember:cloud?chosenEnvironment:undefined
  const remoteMode=id?(member?.device_id??task?.assigned_device??selectedBinding?.device_id??'local')!=="local":!params.get("local")&&cloud
  const device=devices.data?.find(item=>item.id===member?.device_id)
  const busy=isActiveTask(task)
  const history=useQuery({queryKey:['history',task?.id],queryFn:()=>endpoints.history(task!.id),enabled:!!selectedBinding,staleTime:Infinity,refetchOnWindowFocus:false,retry:1,placeholderData:(previous,previousQuery)=>current?.tasks.some(item=>item.id===previousQuery?.queryKey[1])?previous:undefined})
  const streams=useLive(state=>state.streams)
  const freshEvents=useMemo(()=>(streams[task?.id??'']??[]).filter(event=>event.kind.startsWith('agent.')||event.kind.startsWith('tool.')),[streams,task?.id])
  const historySettled=!!task?.finished_at&&history.dataUpdatedAt>task.finished_at*1000&&!history.isFetching&&!history.isError
  const lines=useMemo(()=>conversationTranscript(history.data,freshEvents,task,!historySettled),[history.data,freshEvents,task,historySettled])
  const rows=groups.filter(group=>!group.tasks.some(task=>sideTaskIds.includes(task.id))).map(group=>({binding:{...group.binding,task_id:group.root.id,ax_session_id:group.key,member_id:group.root.assigned_member,device_id:group.root.assigned_device},task:group.root,latest:group.latest,latestAt:group.latest.created_at,key:group.key}))
  const visibleRows=rows.filter(row=>{
    const label=`${meta(row.key).title??row.task?.title??''} ${row.binding.ax_session_id}`.toLowerCase()
    return label.includes(search.toLowerCase())&&(!onlyActive||!!row.task&&isActiveTask(row.latest))
  }).sort((a,b)=>Number(!!meta(b.key).marked)-Number(!!meta(a.key).marked)||b.latestAt-a.latestAt)
  // Conversations that already exist in the local AX store are listed next to the
  // Crew ones; they are read in place and only adopted when the user continues them.
  const localGroups=useMemo(()=>{
    const needle=search.trim().toLowerCase()
    return (localAx.data?.projects??[]).map(project=>({project,sessions:project.sessions.filter(session=>!needle||`${session.title} ${session.preview}`.toLowerCase().includes(needle))})).filter(group=>!!group.sessions.length||(!!group.project.error&&!needle))
  },[localAx.data,search])
  const localMatch=localGroups.flatMap(group=>group.sessions.map(session=>({session,project:group.project}))).find(item=>item.session.id===localId)
  // Paired machines other than this one: their own AX projects and sessions.
  // Projects are directories: local AX stores plus any directory the user picked.
  const projects=useMemo(()=>{
    const items:{key:string;name:string;root:string;sessions:LocalAxSession[];error?:string;picked:boolean}[]=[]
    const seen=new Set<string>()
    for(const group of localAx.data?.projects??[]){
      const key=normalizePath(group.root)
      if(seen.has(key))continue
      seen.add(key)
      items.push({key,name:baseName(group.root),root:group.root,sessions:group.sessions,error:group.error,picked:false})
    }
    for(const directory of projectDirs){
      const key=normalizePath(directory)
      if(seen.has(key))continue
      seen.add(key)
      items.push({key,name:baseName(directory),root:directory,sessions:[],picked:true})
    }
    for(const project of namedProjects.data??[]){
      if(project.device_id!=="local")continue
      const key=normalizePath(project.cwd),existing=items.find(item=>item.key===key)
      if(existing)existing.name=project.name
      else items.push({key,name:project.name,root:project.cwd,sessions:[],picked:false})
    }
    return items
  },[localAx.data,projectDirs,namedProjects.data])
  // A project owns every session that ran in its directory: AX history first, then
  // the Crew conversations that are not already one of those AX sessions.
  const projectSessions=(project:{root:string;sessions:LocalAxSession[]})=>{
    const known=new Set(project.sessions.map(session=>session.id))
    const crew=rows.filter(row=>{
      if(known.has(row.binding.ax_session_id))return false
      if(meta(row.key).project) return normalizePath(meta(row.key).project!)===normalizePath(project.root)
      const member=members.data?.find(item=>item.id===row.binding.member_id)
      return !!member&&member.device_id==="local"&&normalizePath(member.cwd)===normalizePath(project.root)
    })
    return [
      ...project.sessions.filter(session=>!meta(session.id).project||normalizePath(meta(session.id).project!)===normalizePath(project.root)).map(session=>({key:`local:${session.id}`,title:session.title||t('session.untitled'),at:session.updated_at,active:false,attached:!!session.task_id,open:()=>openLocal(session)})),
      ...(localAx.data?.projects??[]).filter(group=>normalizePath(group.root)!==normalizePath(project.root)).flatMap(group=>group.sessions.filter(session=>meta(session.id).project&&normalizePath(meta(session.id).project!)===normalizePath(project.root)).map(session=>({key:`local:${session.id}`,title:session.title,at:session.updated_at,active:false,attached:!!session.task_id,open:()=>openLocal(session)}))),
      ...crew.map(row=>({key:`${row.binding.device_id}:${row.binding.ax_session_id}`,title:row.task?.title??t('session.recentSession'),at:row.latestAt,active:isActiveTask(row.latest),attached:true,open:()=>navigate(`/sessions/${row.binding.task_id}`)})),
    ].sort((a,b)=>Number(!!meta(b.key).marked)-Number(!!meta(a.key).marked)||b.at-a.at)
  }
  const persistProjects=(next:string[])=>{setProjectDirs(next);try{localStorage.setItem(PROJECT_KEY,JSON.stringify(next))}catch{/* a local convenience only */}}
  const startInProject=(root:string)=>{ui.setSelectedEnvironment(null);setCloud(false);ui.setSelectedCwd(root);newSession()}
  const addProject=()=>setProjectDialog(true)
  const openLocal=(session:LocalAxSession)=>navigate(session.task_id?`/sessions/${session.task_id}`:`/sessions?local=${encodeURIComponent(session.id)}`)
  const adoptLocal=async()=>{
    if(!localMatch)return
    const task=await api<Task>('/api/sessions/attach','POST',{ax_session_id:localMatch.session.id,cwd:localMatch.project.root,title:localMatch.session.title})
    queryClient.setQueryData<Task[]>(['tasks'],old=>[...(old??[]).filter(entry=>entry.id!==task.id),task])
    navigate(`/sessions/${task.id}`)
  }
  const canSend=(!!draft.trim()||images.length>0)&&!sending&&(!id||!!selectedBinding)&&(!remoteMode||!!member&&!!device&&["online","busy"].includes(device.status))
  const addImages=async(files:File[])=>{try{if(images.length+files.length>4)throw new Error(t('error.tooManyImages'));const added=await Promise.all(files.map(file=>imageFromFile(file,t)));setImagesByDraft(state=>({...state,[draftKey]:[...(state[draftKey]??[]),...added]}));setSendError('')}catch(error){setSendError(String(error))}}

  useEffect(()=>{setSendError('');followScroll.current=true;requestAnimationFrame(()=>inputRef.current?.focus())},[draftKey])
  useEffect(()=>{if(followScroll.current&&scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight},[lines,draftKey])
  useEffect(()=>{const close=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.activeElement?.closest('.sidebar.is-drawer')){if(listDrawerOpen)setListDrawerOpen(false);else setRightOpen(false)};if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='b'){event.preventDefault();setListOpen(!listOpen)}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[listOpen,setListOpen,setRightOpen])

  const newSession=()=>{setBranchDraft(null);useSessionUi.getState().setPermissionMode('new',ui.defaultPermission);setSendError('');navigate('/sessions');requestAnimationFrame(()=>inputRef.current?.focus())}
  const showDetails=()=>{setRightTab('details');setRightOpen(true)}
  const send=async()=>{
    const text=draft.trim()
    if(!canSend||sendLock.current)return
    sendLock.current=true;setSending(true);setSendError('')
    const origin=locationRef.current,sourceKey=draftKey,binding=selectedBinding,attached=imagesByDraft[draftKey]??[]
    try{
      if(remoteMode&&attached.length)throw new Error(connectionText("远程会话暂不支持图片附件，请移除附件后发送","Remote sessions do not support image attachments yet. Remove images to send."))
      let cwd=ui.selectedCwd??settings.data?.default_cwd
      if(!id&&!remoteMode&&axAvailable){
        const resolved=await resolveSendWorkspace(cwd)
        if(!resolved){setSendError(t('error.workspaceSelectionCancelled'));return}
        cwd=resolved
        useSessionUi.getState().setSelectedCwd(resolved)
      }
      const created=id
        ?await api<Task>(`/api/sessions/${encodeURIComponent(task!.id)}/message`,'POST',{text,images:attached,permission_profile:permissionMode,...(effectiveEffort?{reasoning_effort:effectiveEffort}:{})})
        :await api<Task>('/api/sessions','POST',{title:branchDraft?.title??(text.slice(0,60)||t('session.imageTitle')),text,images:attached,...((branchDraft?.memberId??(remoteMode?member?.id:undefined))?{member_id:branchDraft?.memberId??member?.id}:{cwd,provider:ax.data?.selected_model?.provider,model:ax.data?.selected_model?.id}),...(branchDraft?{context:branchDraft.context}:{}),permission_profile:permissionMode,...(effectiveEffort?{reasoning_effort:effectiveEffort}:{})})
      queryClient.setQueryData<Task[]>(['tasks'],old=>[...(old??[]).filter(item=>item.id!==created.id),created])
      if(attached.length){queryClient.setQueryData(['sent-images',created.id],attached.map(image=>({name:image.name,src:`data:${image.mime};base64,${image.data}`})))}
      if(binding)queryClient.setQueryData<Session[]>(['sessions'],old=>[...(old??[]).filter(item=>item.task_id!==created.id),{...binding,task_id:created.id}])
      else {useSessionUi.getState().addStarting(created.id);useSessionUi.getState().setPermissionMode(created.id,permissionMode)}
      for(const key of draftAliases){if(useSessionUi.getState().drafts[key]===draft)useSessionUi.getState().setDraft(key,'')}
      setImagesByDraft(state=>({...state,[sourceKey]:[]}))
      if(mounted.current&&locationRef.current===origin){
        setBranchDraft(null)
        if(!id)navigate(`/sessions/${created.id}`)
        followScroll.current=true;requestAnimationFrame(()=>inputRef.current?.focus())
      }
      void queryClient.invalidateQueries({queryKey:['tasks']})
      void queryClient.invalidateQueries({queryKey:['sessions']})
    }catch(error){if(mounted.current&&locationRef.current===origin)setSendError(String(error))}
    finally{sendLock.current=false;setSending(false)}
  }
  const onSubmit=(event:FormEvent)=>{event.preventDefault();void send()}
  const onComposerKeyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{
    if(completions.length&&!completionClosed&&['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(event.key)){
      event.preventDefault()
      if(event.key==='Escape')setCompletionClosed(true)
      else if(event.key==='ArrowDown')setCompletionIndex(index=>(index+1)%completions.length)
      else if(event.key==='ArrowUp')setCompletionIndex(index=>(index+completions.length-1)%completions.length)
      else selectCompletion(completions[Math.min(completionIndex,completions.length-1)])
      return
    }
    if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send()}
  }
  const originalTitle=localMode?(localMatch?.session.title||t('session.localAxSession')):id?(current?.root.title??task?.title??t('session.loading')):t('session.new')
  const title=meta(localId??current?.key??'').title??originalTitle
  const permissionLabel=t(`session.permission.${permissionMode}`)
  const workspace=member?.cwd??ui.selectedCwd??settings.data?.default_cwd
  const imageRoot=remoteMode?undefined:localMode?localMatch?.project.root:workspace
  const currentChanges=useMemo(()=>latestTurnChangedFiles(localMode?localLines:lines),[localMode,localLines,lines])
  const reviewFiles=changedView.request&&changedView.liveKey!==draftKey?changedView.files:currentChanges
  useEffect(()=>{setChangedView({files:[]})},[draftKey])
  const openCurrentChanges=()=>{setChangedView(view=>({files:currentChanges,root:imageRoot,liveKey:draftKey,request:{id:(view.request?.id??0)+1}}));setRightTab('files');setRightOpen(true)}
  const openChanges=(files:ChangedFile[],path?:string)=>{setChangedView(view=>({files,root:imageRoot,request:{path,id:(view.request?.id??0)+1}}));setRightTab('files');setRightOpen(true)}
  const branchFrom=(line:SessionLine)=>{
    const source=localMode?localLines:lines,index=source.findIndex(item=>item.key===line.key)
    if(index<0)return
    const prefix=source.slice(0,index+1).filter(item=>item.type==='user'||item.type==='agent'&&!!item.text)
    const context=prefix.map(item=>({role:item.type==='user'?'user':'assistant',text:item.text+(item.images?.length?'\n\nThe user attached images. Inspect each with the view_image tool before answering:\n'+item.images.filter(image=>image.path).map(image=>`- ${image.path}`).join('\n'):'')}))
    if(member?.device_id!=="local"&&member){ui.setSelectedEnvironment(member.id);setCloud(true)}
    if(imageRoot)ui.setSelectedCwd(imageRoot)
    const key=`branch:${crypto.randomUUID()}`
    ui.setPermissionMode(key,permissionMode);setBranchDraft({key,memberId:member?.id,title:`${useLang.getState().lang==='zh'?'分支':'Branch'} · ${title}`,lines:prefix,context});navigate('/sessions');requestAnimationFrame(()=>inputRef.current?.focus())
  }
  const openSideChat=(text:string)=>{setSideQuotes(quotes=>quotes.includes(text)?quotes:[...quotes,text]);setRightTab('chat');setRightOpen(true)}
  const addQuote=(text:string)=>{setDraft(`${draft}${draft?'\n\n':''}${text.split('\n').map(line=>`> ${line}`).join('\n')}\n\n`);inputRef.current?.focus()}
  const remoteCatalog=useQuery({queryKey:["remote-composer-catalog",member?.device_id,member?.cwd],queryFn:()=>endpoints.capabilities(member!.device_id,member!.cwd),enabled:remoteMode&&!!member&&!!device&&["online","busy"].includes(device.status),retry:false})
  const sshMode=remoteMode&&!!member?.device_id.startsWith('ssh:')
  const models=remoteMode&&!sshMode?(remoteCatalog.data?.models.providers.flatMap(provider=>provider.models.map(model=>({...model,provider:provider.id})))??[]):ax.data?.providers.filter(provider=>provider.configured).flatMap(provider=>provider.models)??(remoteCatalog.data?.models.providers.flatMap(provider=>provider.models.map(model=>({...model,provider:provider.id})))??[])
  const boundModel:import('../lib/ax').AxModel|null|undefined=remoteMode&&member?.model?{provider:member.provider??'',id:member.model,display_name:member.model}:remoteMode&&!sshMode?undefined:ax.data?.selected_model
  const catalogModel=models.find(model=>model.id===boundModel?.id&&model.provider===boundModel?.provider)
  const selectedModel=catalogModel?{...catalogModel,reasoning_effort:boundModel?.reasoning_effort}:boundModel
  const effectiveEffort=selectedEffort(selectedModel,thinkingEffort)
  const slashToken=draft.slice(0,cursor).match(/(?:^|\n)\/([^\s]*)$/)?.[1]
  const referenceToken=draft.slice(0,cursor).match(/(?:^|\s)@([^\s]*)$/)?.[1]
  const debouncedReference=useDebouncedValue(referenceToken??'',180)
  const fileMatches=useQuery({queryKey:['workspace-file-search',workspace,debouncedReference],queryFn:()=>invoke<string[]>('search_workspace_files',{root:workspace,query:debouncedReference}),enabled:!remoteMode&&axAvailable&&!!workspace&&referenceToken!==undefined,retry:false})
  const completions=referenceToken!==undefined?(fileMatches.data??[]).map(path=>({kind:'file' as const,value:path,label:path,description:t('session.referenceWorkspaceFile')}))
    :slashToken!==undefined?slashCommands.filter(item=>item.name.slice(1).includes(slashToken.toLowerCase())).map(item=>({kind:'slash' as const,value:item.name,label:item.name,description:t(item.key)})):[]
  const runAxSlash=(command:string)=>{
    if(!axAvailable||!workspace||!ax.data?.active_path){setSendError(t('error.desktopNeedsAx'));return}
    const escaped=ax.data.active_path.replaceAll("'","''")
    useTerminalDock.getState().addTab(workspace,`& '${escaped}' tui`)
    setSendError(t('error.axTerminalOpened',{command}))
  }
  const selectCompletion=(item:(typeof completions)[number])=>{
    if(item.kind==='file'){
      const start=cursor-(referenceToken?.length??0)-1
      const reference=item.value.includes(' ')?`@"${item.value}"`:`@${item.value}`
      const next=`${draft.slice(0,start)}${reference} ${draft.slice(cursor)}`
      setDraft(next);requestAnimationFrame(()=>{inputRef.current?.focus();inputRef.current?.setSelectionRange(start+reference.length+1,start+reference.length+1)})
    }else{
      setDraft('')
      switch(item.value){
        case '/new':newSession();break
        case '/model':document.querySelector<HTMLButtonElement>('.session-footer-auto')?.click();break
        case '/login':case '/logout':case '/status':navigate('/settings');break
        case '/memory':navigate('/settings');break
        case '/permissions':document.querySelector<HTMLButtonElement>('.session-composer-permission')?.click();break
        case '/resume':setListOpen(true);break
        default:runAxSlash(item.value)
      }
    }
    setCompletionClosed(true)
  }
  const chooseWorkspace=async()=>{
    if(remoteMode){setProjectDialog(true);return}
    if(!axAvailable){setSendError(t('error.desktopPickWorkspace'));return}
    try{
      const selected=await open({directory:true,multiple:false,defaultPath:workspace})
      if(typeof selected==='string'){ui.setSelectedCwd(selected);setSendError('')}
    }catch(error){setSendError(String(error))}
  }
  const chooseModel=async(provider:string,model:string)=>{
    if(remoteMode&&member){
      if(id)return
      try{
        const selected=await connections.selectModel(member.id,provider,model)
        await queryClient.invalidateQueries({queryKey:['allMembers']})
        ui.setSelectedEnvironment(selected.id);setSendError('')
      }catch(error){setSendError(String(error))}
      return
    }
    try{queryClient.setQueryData(['ax-local'],await axSelectModel(provider,model));setSendError('')}
    catch(error){setSendError(String(error))}
  }
  const startLoop=(config:LoopStart)=>{
    if(!workspace){setSendError(t('error.chooseWorkspaceFirst'));return}
    const key=loopKey??draftKey
    const run:LoopRun={...config,taskId:id??null,cwd:workspace,provider:ax.data?.selected_model?.provider??null,model:ax.data?.selected_model?.id??null,reasoningEffort:effectiveEffort||undefined,permissionProfile:permissionMode,stopFile:stopFileRelative,rounds:0,errors:0,startedAt:Date.now(),status:'running',detail:''}
    setSendError('');setGoalOpen(false)
    startGoalLoop(key,run,task=>{useSessionUi.getState().addStarting(task.id);navigate(`/sessions/${task.id}`)})
  }
  const stopLoop=()=>stopGoalLoop(loopKey??draftKey)
  const clearLoop=()=>useGoalLoop.getState().clear(loopKey??draftKey)

  const optimisticImages=queryClient.getQueryData<import('../lib/sessionTranscript').SessionImage[]>(['sent-images',task?.id])
  const displayLines=lines.map(line=>line.key===`prompt-${task?.id}`&&optimisticImages?.length?{...line,images:optimisticImages}:line)
  return <SessionInteractions value={{root:imageRoot,onChanges:openChanges,onBranch:branchFrom,onSideChat:openSideChat,onAddQuote:addQuote}}><div className={`sessions-workspace ${listOpen?'has-session-list':''} ${rightOpen?'has-right-panel':''}`} data-right-mode={layout.rightMode} data-list-mode={layout.listDocked?'docked':listDrawerOpen?'drawer':'closed'} style={{'--preview-width':`${layout.rightWidth}px`} as React.CSSProperties}>
    {listDrawerOpen&&!layout.listDocked&&<button className="session-list-backdrop" aria-label={connectionText('关闭会话列表抽屉','Close sessions drawer')} onClick={()=>setListDrawerOpen(false)}/>}
    <aside ref={listRef} role={listDrawerOpen&&!layout.listDocked?'dialog':undefined} aria-modal={listDrawerOpen&&!layout.listDocked||undefined} className={`session-list-panel ${listOpen?'':'is-closed'}`} aria-hidden={!listOpen} aria-label={listOpen?t('session.listOpen'):t('session.listClosed')}>
      <div className="session-list-heading"><button className="session-list-toggle" aria-label={t('session.collapseList')} aria-expanded={listOpen} title={t('session.collapseList')} onClick={()=>setListOpen(false)}><MessageSquare size={18}/><strong>{t('nav.sessions')}</strong></button></div>
      <div className="session-list-body" aria-hidden={!listOpen}>
      <button className="session-new-chat" aria-label={t('session.newChat')} title={t('session.newChat')} tabIndex={listOpen?0:-1} onClick={newSession}><SquarePen size={17}/><span>{t('session.newChat')}</span></button>
      <div className="session-list-search"><Search size={17}/><input aria-label={t('session.search')} value={search} onChange={event=>setSearch(event.target.value)} placeholder={t('session.searchPlaceholder')}/><button className={onlyActive?'is-filtered':''} aria-label={t('session.filterActive')} title={onlyActive?t('session.showAll'):t('session.onlyActive')} onClick={()=>setOnlyActive(value=>!value)}><SlidersHorizontal size={17}/></button></div>
      <div className="session-list-scroll">
        <section className="session-section" aria-label={t('session.sectionProjects')}>
          <button className="session-section-head" aria-label={t('session.sectionProjects')} aria-expanded={projectsOpen} onClick={()=>setProjectsOpen(value=>!value)}><strong>{t('session.sectionProjects')}</strong><ChevronRight size={16} className={projectsOpen?'rotate-90':''}/></button>
          {projectsOpen&&<div className="session-section-body">
            {projects.map(project=>{
              const opened=openProject===project.key
              const sessions=opened?projectSessions(project):[]
              return <div key={project.key} className={`session-project ${opened?'is-open':''}`}>
                <div className="session-project-row">
                  <button className="session-project-pick" aria-expanded={opened} title={project.root} onClick={()=>setOpenProject(opened?null:project.key)}>
                    <Folder size={16}/><span>{project.name}</span>
                    {project.error&&<i className="session-project-warn" title={project.error}>!</i>}
                  </button>
                  <button className="session-project-action" aria-label={t('session.newInProject',{name:project.name})} title={t('session.newSessionHere')} onClick={()=>startInProject(project.root)}><SquarePen size={15}/></button>
                  <Menu trigger={<button className="session-project-action" type="button" aria-label={t('session.moreActions',{name:project.name})} title={t('session.moreActions',{name:project.name})}><MoreHorizontal size={15}/></button>} items={[
                    {label:t('session.newSessionHere'),action:()=>startInProject(project.root)},
                    {label:t('session.setAsWorkspace'),action:()=>ui.setSelectedCwd(project.root)},
                    ...((namedProjects.data??[]).find(p=>p.device_id==='local'&&normalizePath(p.cwd)===project.key)?[{label:connectionText('从项目中移除','Remove project'),action:()=>{const named=namedProjects.data!.find(p=>p.device_id==='local'&&normalizePath(p.cwd)===project.key)!;void connections.removeProject(named.id).then(()=>queryClient.invalidateQueries({queryKey:['named-projects']})).catch(e=>setSendError(String(e)))}}]:[]),
                    ...(project.picked?[{label:t('session.removeFromList'),action:()=>persistProjects(projectDirs.filter(directory=>normalizePath(directory)!==project.key))}]:[]),
                  ]}/>
                </div>
                {opened&&<div className="session-project-sessions">
                  {sessions.map(item=><button key={item.key} onContextMenu={event=>contextSession(event,item.key,item.title,item.active)} className={`session-project-session ${item.active?'is-active':''}`} onClick={item.open}>
                    <span className="session-project-title">{label(item.key,item.title)}</span>
                    {!item.active&&<small>{timeLabel(item.at)}</small>}
                  </button>)}
                  {!sessions.length&&<div className="session-local-note">{t('session.emptyProject')}</div>}
                </div>}
              </div>
            })}
            {(namedProjects.data??[]).filter(project=>project.device_id!=='local').map(project=><div key={project.id} className="session-project">
              <div className="session-project-row"><button className="session-project-pick" title={project.cwd} onClick={()=>{ui.setSelectedEnvironment(project.member_id);setCloud(true);newSession()}}><Laptop size={16}/><span>{project.name}</span></button><Menu trigger={<button className="session-project-action" aria-label={connectionText('项目操作','Project actions')}><MoreHorizontal size={15}/></button>} items={[{label:connectionText('新建远程会话','New remote session'),action:()=>{ui.setSelectedEnvironment(project.member_id);setCloud(true);newSession()}},{label:connectionText('从项目中移除','Remove project'),action:()=>{void connections.removeProject(project.id).then(()=>queryClient.invalidateQueries({queryKey:['named-projects']})).catch(e=>setSendError(String(e)))}}]}/></div>
            </div>)}
            {!projects.length&&!(namedProjects.data??[]).some(p=>p.device_id!=='local')&&<div className="session-list-empty">{localAx.isLoading?t('session.readingLocalAx'):t('session.noProjects')}</div>}
            <button className="session-add-project" onClick={()=>void addProject()}><FolderPlus size={15}/><span>{connectionText('添加项目','Add project')}</span></button>
          </div>}
        </section>
        <section className="session-section" aria-label={t('session.sectionRecent')}>
          <button className="session-section-head" aria-label={t('session.sectionRecent')} aria-expanded={recentOpen} onClick={()=>setRecentOpen(value=>!value)}><strong>{t('session.sectionRecent')}</strong><ChevronRight size={16} className={recentOpen?'rotate-90':''}/></button>
          {recentOpen&&<div className="session-section-body">
            {visibleRows.map(row=><button key={row.binding.ax_session_id} onContextMenu={event=>contextSession(event,row.key,row.task?.title??t('session.untitled'),isActiveTask(row.latest))} className={`session-recent-row ${current?.key===row.key?'is-selected':''}`} onClick={()=>navigate(`/sessions/${row.binding.task_id}`)}>
              {isActiveTask(row.latest)&&<span className="session-recent-dot"/>}
              <span className="session-project-title">{label(row.key,row.task?.title||t('session.untitled'))}</span>
              <small>{timeLabel(row.latestAt)}</small>
            </button>)}
            {!visibleRows.length&&<div className="session-list-empty">{sessions.isLoading?t('session.loadingSessions'):search||onlyActive?t('session.noMatch'):t('session.noSessionsYet')}</div>}
          </div>}
        </section>

      </div>
      </div>
    </aside>

    <section className="session-chat-panel" hidden={layout.rightMode==='full'}>
      <div className="session-chat-header"><button type="button" className="session-header-icon session-header-list-toggle" aria-label={listOpen?connectionText('切换会话列表','Toggle session list'):t('session.expandList')} aria-expanded={listOpen} onClick={()=>setListOpen(!listOpen)}><MessageSquare size={17}/></button><Menu trigger={<button className="session-title-menu" aria-label={t('session.menu')}><strong title={title}>{title}</strong><ChevronDown size={15}/></button>} items={[{label:t('session.new'),action:newSession},{label:t('session.details'),action:showDetails},{label:connectionText('恢复默认布局','Restore default layout'),action:resetLayout},...(id?[{label:t('session.openTask'),action:()=>navigate(`/tasks/${task?.id??id}`)}]:[])]}/><div className="session-header-spacer"/><button type="button" className="session-header-icon session-header-right-toggle" aria-label={rightOpen?connectionText('切换右侧面板','Toggle right panel'):t('session.openRight')} aria-expanded={rightOpen} onClick={()=>setRightOpen(!rightOpen)}><PanelRight size={17}/></button>{id&&<Link className="session-header-icon" to={`/tasks/${task?.id??id}`} aria-label={t('session.viewTask')} title={t('session.viewTask')}><ExternalLink size={17}/></Link>}</div>
      <TurnNavigator lines={localMode?localLines:!id&&branchDraft?branchDraft.lines:displayLines} container={selectionContainer} onJump={()=>{followScroll.current=false}}/>
      <div className="session-chat-scroll" ref={attachScroll} onScroll={event=>{const node=event.currentTarget;followScroll.current=node.scrollHeight-node.scrollTop-node.clientHeight<80}}>
        {localMode?<LocalThread session={localMatch?.session} onLines={setLocalLines}/>:id&&!task&&!tasks.isPending?<div className="session-thread-waiting">{tasks.error?t('session.loadFailedRetry'):t('session.gone')}<button onClick={()=>void tasks.refetch()}>{t('session.reload')}</button></div>:!id&&branchDraft?<div className="session-transcript"><div className="session-branch-banner">{branchDraft.title}<button type="button" onClick={newSession}>{useLang.getState().lang==='zh'?'取消分支':'Cancel branch'}</button></div><TranscriptLines lines={branchDraft.lines}/></div>:!id?null:<div className="session-transcript">{history.error&&<div className="session-inline-error">{t('session.loadHistoryFailed')}{String(history.error)} <button onClick={()=>void history.refetch()}>{t('session.retry')}</button></div>}{lines.length?<TranscriptLines lines={displayLines} hideActiveChanges active={busy} finishedAt={task?.finished_at?task.finished_at*1000:undefined}/>:<div className="session-thread-waiting">{task?.status==='failed'?`${t('session.startFailedDetail')}${task.output?.error??t('session.seeLinkedTask')}`:task?.status==='cancelled'?t('session.stopped'):selectedBinding?t('session.loadingMessages'):t('session.starting')}</div>}</div>}
      </div>
      {localMode?<div className="session-local-bar" role="status"><span>{t('session.readOnlyNote')}</span><div className="session-local-bar-actions">{localMatch?.session.task_id?<Link className="session-local-link" to={`/sessions/${localMatch.session.task_id}`}>{t('session.alreadyInCrew')} <ExternalLink size={13}/></Link>:<Action variant="default" run={adoptLocal} disabled={!localMatch}>{t('session.continueInCrew')}</Action>}</div></div>:<div className="session-composer-wrap">
        {!id&&members.isSuccess&&!members.data.length&&<div className="session-inline-error" role="status">{t('session.runtimeNotReady')}<Link to="/settings">{t('session.openSettings')}</Link></div>}        {!id&&members.isError&&<div className="session-inline-error" role="alert">{t('session.readRuntimeFailed')}{String(members.error)} <button onClick={()=>void members.refetch()}>{t('session.retry')}</button></div>}
        {permissions.data?.filter(permission=>permission.request.sessionId===selectedBinding?.ax_session_id).map(permission=><div className="session-permission-request" key={permission.request_id}><strong>{permission.request.toolCall.title}</strong><span>{t('session.askConfirm')}</span><div>{permission.request.options.map(option=><Action key={option.optionId} run={()=>api(`/api/permissions/${permission.request_id}/resolve`,'POST',{option_id:option.optionId})}>{option.name}</Action>)}</div></div>)}
        {task&&<div className="session-run-status" role="status">{task.status==='waiting_permission'?t('session.waitingPermission'):busy?'':task.status==='failed'?`${t('session.execFailed')}${task.output?.error??t('session.viewLinkedTask')}`:task.status==='cancelled'?t('session.stopped'):task.status==='waiting_user'?t('session.waitingUser'):''}</div>}
        {busy&&!!currentChanges.length&&<div className="session-live-changes"><button type="button" onClick={openCurrentChanges} aria-label={useLang.getState().lang==='zh'?'查看当前文件变更':'View current file changes'} aria-expanded={rightOpen&&rightTab==='files'&&changedView.liveKey===draftKey}><span>{useLang.getState().lang==='zh'?`${currentChanges.length} 个文件已更改`:`${currentChanges.length} files changed`}</span><b>+{currentChanges.reduce((sum,file)=>sum+file.additions,0)}</b><em>-{currentChanges.reduce((sum,file)=>sum+file.deletions,0)}</em></button></div>}
        {loopRun&&<div className={`session-loop-status is-${loopRun.status}`} role="status"><span className="session-loop-dot"/><strong>{loopRun.kind==='goal'?t('session.goalLoop'):t('session.prWatch')}</strong><span>{loopRun.status==='running'?t('session.roundProgress',{rounds:loopRun.rounds,seconds:loopRun.intervalSeconds}):(loopRun.detail||t('session.loopStopped'))}</span>{loopRun.status==='running'?<button type="button" onClick={stopLoop}>{t('session.stopLoop')}</button>:<button type="button" aria-label={t('session.clearLoop')} title={t('session.clearLoop')} onClick={clearLoop}><X size={13}/></button>}</div>}
        {completions.length>0&&!completionClosed&&<div className="session-completions" role="listbox" aria-label={referenceToken!==undefined?t('session.fileSuggestions'):t('session.slashSuggestions')}>{completions.map((item,index)=><button type="button" role="option" aria-selected={index===completionIndex} className={index===completionIndex?"is-active":""} key={item.value} onMouseDown={event=>event.preventDefault()} onClick={()=>selectCompletion(item)}><strong>{item.label}</strong><small>{item.description}</small></button>)}</div>}{!id&&!sending&&<div className="session-composer-tabs" aria-label={t('session.chooseWorkspace')}>
          <button type="button" className="session-composer-tab session-composer-project" disabled={!!id} title={id?t('session.workspaceFixed'):workspace??t('session.chooseWorkspace')} onClick={()=>void chooseWorkspace()}><Folder size={18}/><span>{workspace?baseName(workspace):t('session.chooseWorkspace')}</span></button>
          <Dropdown.Root>
            <Dropdown.Trigger asChild><button type="button" className="session-composer-tab session-composer-location" disabled={!!id} aria-label={t('session.workLocation')} title={id?t('session.workspaceFixed'):t('session.workLocation')}>{remoteMode?<Cloud size={18}/>:<Laptop size={18}/>}<span>{remoteMode?t('session.cloud'):t('session.thisComputer')}</span></button></Dropdown.Trigger>
            <Dropdown.Portal><Dropdown.Content className="ax-menu session-location-menu" side="top" align="start" sideOffset={6} collisionPadding={12}>
              <Dropdown.Label className="session-location-label">{t('session.workLocation')}</Dropdown.Label>
              <Dropdown.RadioGroup value={remoteMode?'cloud':'local'} onValueChange={value=>{setCloud(value==='cloud');ui.setSelectedEnvironment(null);setSendError('')}}>
                <Dropdown.RadioItem className="session-location-item" value="local"><Laptop size={19}/><span>{t('session.thisComputer')}</span><Dropdown.ItemIndicator className="session-location-check"><Check size={18}/></Dropdown.ItemIndicator></Dropdown.RadioItem>
                <Dropdown.RadioItem className="session-location-item" value="cloud"><Cloud size={19}/><span>{t('session.cloud')}</span><Dropdown.ItemIndicator className="session-location-check"><Check size={18}/></Dropdown.ItemIndicator></Dropdown.RadioItem>
              </Dropdown.RadioGroup>
            </Dropdown.Content></Dropdown.Portal>
          </Dropdown.Root>
          {remoteMode&&<Menu className="session-environment-menu" trigger={<button type="button" className="session-composer-tab" disabled={!!id} aria-label={connectionText('选择环境','Choose environment')}><Laptop size={18}/><span>{member?(namedProjects.data?.find(p=>p.device_id===member.device_id&&p.cwd===member.cwd)?.name??device?.name??member.name):connectionText('选择环境','Choose environment')}</span></button>} items={[
            ...(members.data??[]).filter(m=>m.device_id!=='local').map(m=>{const d=devices.data?.find(d=>d.id===m.device_id);return {label:<><strong>{namedProjects.data?.find(p=>p.device_id===m.device_id&&p.cwd===m.cwd)?.name??m.name} · {d?.name??m.device_id}</strong><small>{m.cwd}{m.model?' · '+m.model:''}{!d||!['online','busy'].includes(d.status)?' · '+connectionText('离线','Offline'):''}</small></>,disabled:!d||!['online','busy'].includes(d.status),action:()=>{ui.setSelectedEnvironment(m.id);setSendError('')}}}),
            {label:connectionText('添加远程项目','Add remote project'),action:()=>setProjectDialog(true)},
            {label:connectionText('管理连接','Manage connections'),action:()=>navigate('/connect')},
          ]}/>}
        </div>}<form className="session-composer" onSubmit={onSubmit} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void addImages([...event.dataTransfer.files])}}><input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event=>{void addImages([...event.target.files??[]]);event.target.value=""}}/>{images.length>0&&<div className="session-image-previews">{images.map((image,index)=><div key={`${image.name}-${index}`} className="session-image-preview"><button type="button" className="session-image-open" aria-label={`${useLang.getState().lang==='zh'?'查看图片':'View image'} ${image.name}`} onClick={()=>setImagePreview(image)}><img src={`data:${image.mime};base64,${image.data}`} alt={image.name}/></button><button type="button" aria-label={t('session.removeImage',{index:index+1})} onClick={()=>setImagesByDraft(state=>({...state,[draftKey]:(state[draftKey]??[]).filter((_,position)=>position!==index)}))}><X size={13}/></button></div>)}</div>}<textarea ref={inputRef} aria-label={t('session.sendMessage')} value={draft} disabled={sending} onChange={event=>{setDraft(event.target.value);setCursor(event.target.selectionStart);setCompletionClosed(false);setCompletionIndex(0)}} onClick={event=>setCursor(event.currentTarget.selectionStart)} onKeyUp={event=>setCursor(event.currentTarget.selectionStart)} onPaste={event=>{const pasted=[...event.clipboardData.files].filter(file=>file.type.startsWith("image/"));if(pasted.length)void addImages(pasted)}} onKeyDown={onComposerKeyDown} placeholder={t('session.placeholder')} rows={2}/><div className="session-composer-actions"><Menu trigger={<button type="button" className="session-composer-icon" title={t('session.addContext')} aria-label={t('session.addContext')}><Plus size={20}/></button>} items={[{label:t('session.addImage'),action:()=>imageInputRef.current?.click()},{label:t('session.referenceFile'),action:()=>{setRightTab('files');setRightOpen(true)}},{label:t('session.details'),action:showDetails}]}/><ComposerSecondaryActions><button type="button" className="session-composer-icon" aria-label={t('session.setGoal')} title={t('session.setGoal')} disabled={remoteMode} onClick={()=>setGoalOpen(true)}><Target size={19}/></button><Menu trigger={<button type="button" className={`session-composer-permission ${permissionMode==='yolo'?'is-full':''}`} aria-label={t('session.accessMode')} title={t('session.chooseAccess')}><ShieldCheck size={16}/>{permissionLabel}<ChevronDown size={13}/></button>} items={[{label:<><strong>{t('session.permission.ask')}</strong><small>{t('session.permission.askHint')}</small></>,action:()=>ui.setPermissionMode(draftKey,"ask")},{label:<><strong>{t('session.permission.read')}</strong><small>{t('session.permission.readHint')}</small></>,action:()=>ui.setPermissionMode(draftKey,"read")},{label:<><strong>{t('session.permission.trust')}</strong><small>{t('session.permission.trustHint')}</small></>,action:()=>ui.setPermissionMode(draftKey,"trust")},{label:<><strong>YOLO</strong><small>{t('session.permission.yoloHint')}</small></>,action:()=>ui.setPermissionMode(draftKey,"yolo")}]}/><VoiceInput onText={text=>setDraft((draft?draft+' ':'')+text)} onError={setSendError} disabled={sending}/></ComposerSecondaryActions><div className="session-composer-spacer"/><ModelControls models={models} model={selectedModel} effort={effectiveEffort} onEffort={setThinkingEffort} onModel={chooseModel} modelDisabled={remoteMode&&!!id} fast={fastInference} fastDisabled={(remoteMode&&!sshMode)||!axAvailable||!ax.data||switchingInference} onFast={()=>void toggleInference()} emptyHint={remoteMode?connectionText('暂无可用模型，请在对应 AX 中配置','No models available. Configure the corresponding AX.'):t('session.connectModel')} onConfigure={()=>navigate('/settings')}/>{busy?<button type="button" className="session-send-button session-stop-button" aria-label={t('session.stop')} title={t('session.stop')} disabled={sending} onClick={async()=>{if(sendLock.current)return;sendLock.current=true;setSending(true);try{await api(`/api/tasks/${task!.id}/cancel`,'POST',{});void queryClient.invalidateQueries({queryKey:['tasks']});void queryClient.invalidateQueries({queryKey:['history',task!.id]})}catch(error){setSendError(String(error))}finally{sendLock.current=false;setSending(false)}}}><Square size={14}/></button>:null}{<button className="session-send-button" type="submit" aria-label={t('session.sendMessage')} title={busy?connectionText('发送补充指导，继续当前任务','Send guidance and continue the current task'):t('session.sendMessage')} disabled={!canSend}><ArrowUp size={20}/></button>}</div></form>{sendError&&<div className="session-inline-error" role="alert">{t('session.failedKeptDraft')}{sendError}</div>}</div>}
    </section>

    {layout.rightMode==='docked'&&(rightTab==='files'?<WorkspaceSplitter layout={layout} onRatio={ui.setSplitRatio}/>:<div className="session-preview-gap"/>)}
    {layout.rightMode==='drawer'&&<button className="session-right-backdrop" aria-label={t('session.rightBackdrop')} onClick={()=>setRightOpen(false)}/>}
    <aside ref={previewRef} role={layout.rightMode==='drawer'?'dialog':undefined} aria-modal={layout.rightMode==='drawer'||undefined} hidden={listDrawerOpen&&layout.rightMode==='drawer'} className={`session-right-panel ${rightOpen?'':'is-closed'} ${rightOpen&&rightTab==='files'?'is-files':''}`} aria-hidden={!rightOpen} aria-label={rightOpen?t('session.rightPanelOpen'):t('session.rightPanelClosed')}>
      <div className="session-right-tabs">
        {rightOpen&&<><button className={rightTab==='files'?'active':''} onClick={()=>setRightTab('files')}><Folder size={17}/> {t('session.tabFiles')}</button><button className={rightTab==='chat'?'active':''} onClick={()=>setRightTab('chat')}>{useLang.getState().lang==='zh'?'聊天':'Chat'}</button><button className={rightTab==='details'?'active':''} onClick={()=>setRightTab('details')}><SlidersHorizontal size={17}/> {t('session.tabDetails')}</button></>}
        {rightOpen&&<Menu trigger={<button type="button" className="session-layout-menu" aria-label={connectionText('面板布局','Panel layout')}><MoreHorizontal size={17}/></button>} items={[{label:connectionText(layout.rightMode==='full'?'显示主聊天':'仅侧栏视图',layout.rightMode==='full'?'Show main chat':'Sidebar only'),action:()=>ui.setChatOpen(layout.rightMode==='full')},{label:connectionText('恢复默认布局','Restore default layout'),action:resetLayout}]}/>}
        <button className="session-right-toggle" aria-label={rightOpen?t('session.closeRight'):t('session.openRight')} title={rightOpen?t('session.collapseRight'):t('session.expandRight')} aria-expanded={rightOpen} onClick={()=>setRightOpen(!rightOpen)}><PanelRight size={18}/></button>
      </div>
      <div className="session-file-panel-slot" hidden={!rightOpen||rightTab!=='files'}><UnifiedFilePanel key={`${draftKey}:${imageRoot??member?.cwd??''}:${remoteMode}`} changedFiles={reviewFiles} reviewRequest={changedView.request} member={member} workspaceRoot={changedView.root??imageRoot} remote={remoteMode} onReference={path=>{setDraft(`${draft}${draft?'\n':''}@file ${path}`);inputRef.current?.focus()}}/></div>
      <SessionInteractions value={{root:imageRoot,onChanges:openChanges}}><div className="session-side-chat-slot" hidden={!rightOpen||rightTab!=='chat'}><SideChat quotes={sideQuotes} onQuotesChange={setSideQuotes} cwd={imageRoot} memberId={remoteMode?member?.id:undefined} models={models} initialModel={selectedModel} fast={fastInference} onFast={()=>void toggleInference()} fastDisabled={(remoteMode&&!sshMode)||!axAvailable||!ax.data||switchingInference} remote={remoteMode} onRemoteModel={chooseModel} onTask={id=>setSideTaskIds(ids=>[...ids,id])}/></div></SessionInteractions>
      {rightOpen&&rightTab==='details'&&<div className="session-right-details"><div><span>{t('session.deviceLabel')}</span><strong>{device?.name??member?.device_id??'—'}</strong></div><div><span>{t('session.taskStatus')}</span><strong>{task?.status?t('status.'+task.status):t('session.statusNew')}</strong></div><div><span>{t('session.axSessionId')}</span><strong className="session-detail-id">{selectedBinding?.ax_session_id??'—'}</strong></div>{id&&<Link to={`/tasks/${task?.id??id}`}>{t('session.viewTask')} <ExternalLink size={14}/></Link>}</div>}
    </aside>
    <ProjectDialog open={projectDialog} onClose={()=>setProjectDialog(false)} onCreated={project=>{if(project.device_id==="local"){ui.setSelectedCwd(project.cwd);ui.setSelectedEnvironment(null);setCloud(false)}else{ui.setSelectedEnvironment(project.member_id);setCloud(true)}newSession()}}/>
    {context&&<div className="session-context-menu ax-menu" role="menu" style={{left:context.x,top:context.y}}>
      <button role="menuitem" onClick={()=>setEditSession({id:context.id,kind:'title',value:context.title})}>{t('session.rename')}</button>
      <button role="menuitem" onClick={()=>ui.setMetadata(context.id,{marked:!meta(context.id).marked})}>{meta(context.id).marked?t('session.unmark'):t('session.mark')}</button>
      <button role="menuitem" onClick={()=>setEditSession({id:context.id,kind:'project',value:meta(context.id).project??''})}>{t('session.moveProject')}</button>
      <button role="menuitem" disabled={context.active} onClick={()=>{setDeleteError('');setDeleteTarget(context)}}>{t('session.permanentDelete')}</button>
    </div>}
    {editSession&&<div className="session-dialog-backdrop" onClick={()=>setEditSession(null)}><form className="session-edit-dialog" role="dialog" aria-modal="true" aria-label={t(editSession.kind==='title'?'session.rename':'session.moveProject')} onClick={event=>event.stopPropagation()} onSubmit={event=>{event.preventDefault();ui.setMetadata(editSession.id,{[editSession.kind]:editSession.value.trim()||undefined});setEditSession(null)}}>
      <h2>{t(editSession.kind==='title'?'session.rename':'session.moveProject')}</h2>
      {editSession.kind==='title'?<input autoFocus aria-label={t('session.title')} value={editSession.value} onChange={event=>setEditSession({...editSession,value:event.target.value})}/>:<select autoFocus aria-label={t('session.moveProject')} value={editSession.value} onChange={event=>setEditSession({...editSession,value:event.target.value})}><option value="">{t('session.originalProject')}</option>{projects.map(project=><option key={project.key} value={project.root}>{project.name} · {project.root}</option>)}</select>}
      <div><button type="button" onClick={()=>setEditSession(null)}>{t('common.cancel')}</button><button type="submit">{t('common.save')}</button></div>
    </form></div>}
    {deleteTarget&&<div className="session-dialog-backdrop"><div className="session-edit-dialog" role="dialog" aria-modal="true" aria-label={t('session.permanentDelete')}>
      <h2>{t('session.permanentDelete')}</h2><p>{deleteTarget.title}</p><p>{t('session.deleteHint')}</p>
      {deleteError&&<p role="alert" className="session-inline-error">{deleteError}</p>}
      <div><button disabled={deleting} onClick={()=>setDeleteTarget(null)}>{t('common.cancel')}</button><button className="is-danger" disabled={deleting} onClick={async()=>{
        setDeleting(true);setDeleteError('');try{
          const group=groups.find(g=>g.key===deleteTarget.id)
          if(group?.binding)await api(`/api/sessions/${encodeURIComponent(group.root.id)}`,'DELETE')
          else if(deleteTarget.id.startsWith('local:'))await api(`/api/ax/local/${encodeURIComponent(deleteTarget.id.slice(6))}`,'DELETE')
          else throw new Error(t('session.retry'))
          await Promise.all(['tasks','sessions','local-ax','localAx'].map(key=>queryClient.invalidateQueries({queryKey:[key]})))
          setDeleteTarget(null);newSession()
        }catch(error){setDeleteError(String(error))}finally{setDeleting(false)}
      }}>{deleting?'…':t('session.permanentDelete')}</button></div>
    </div></div>}
    <SelectionMenu container={selectionContainer}/>
    {imagePreview&&<ImageLightbox src={`data:${imagePreview.mime};base64,${imagePreview.data}`} name={imagePreview.name} onClose={()=>setImagePreview(null)}/>}
    <GoalLoopDialog open={goalOpen} onOpenChange={setGoalOpen} storeKey={loopKey??draftKey} run={loopRun} workspace={workspace} disabled={!axAvailable||!workspace} onStart={startLoop} onStop={stopLoop}/>
  </div></SessionInteractions>
}
