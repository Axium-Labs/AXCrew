import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowUp, ChevronDown, ChevronRight, ExternalLink, Folder, FolderPlus, Laptop, MessageSquare, MoreHorizontal, PanelRight, Plus, RotateCcw, Search, Square, SquarePen, ShieldCheck, SlidersHorizontal, Target, X } from 'lucide-react'
import { api, endpoints } from '../lib/api'
import { useAllMembers, useDevices, useLocalAx, usePermissions, useSessions, useTasks } from '../lib/query'
import { useLive } from '../lib/live'
import { useSessionUi } from '../store/sessions'
import { conversations, isActiveTask } from '../lib/conversations'
import { Action } from '../components/shared'
import { Menu } from '../components/ui/menu'
import { conversationTranscript, transcript } from '../lib/sessionTranscript'
import type { LocalAxProject, LocalAxSession, Session, Task } from '../lib/types'
import { WorkspaceFiles } from './WorkspaceFiles'
import { MessageMarkdown } from '../components/MessageMarkdown'
import { GoalLoopDialog, type LoopStart } from '../components/GoalLoopDialog'
import { startGoalLoop, stopGoalLoop } from '../lib/goalLoop'
import { stopFileRelative, useGoalLoop, type LoopRun } from '../store/goal'
import { open } from '@tauri-apps/plugin-dialog'
import { axAvailable, axLocalState, axSelectModel } from '../lib/ax'
import { invoke } from '@tauri-apps/api/core'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { useTerminalDock } from '../store/terminal'
import './sessions.css'

const suggestions=[
  '帮我梳理今天的工作',
  '总结最近的项目改动',
  '检查待处理的问题',
  '规划下一步任务',
  '解释当前工作区',
  '整理已完成的工作',
]
type AttachedImage={name:string;mime:string;data:string}
const slashCommands=[
  {name:'/new',description:'新建会话'},{name:'/model',description:'选择 AX 模型'},
  {name:'/login',description:'登录模型提供商'},{name:'/logout',description:'管理登录凭据'},
  {name:'/memory',description:'管理记忆与备份'},{name:'/permissions',description:'设置会话权限'},
  {name:'/status',description:'查看本地 AX 状态'},{name:'/resume',description:'选择已有会话'},
  {name:'/skills',description:'在 AX 中管理技能'},{name:'/tools',description:'在 AX 中查看工具'},
  {name:'/mcp',description:'在 AX 中管理 MCP'},{name:'/compact',description:'在 AX 中压缩上下文'},
] as const
async function imageFromFile(file:File):Promise<AttachedImage>{
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw new Error('仅支持 PNG、JPEG、WebP、GIF 图片')
  if(file.size>8*1024*1024)throw new Error('单张图片不能超过 8 MB')
  const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)})
  return {name:file.name||'粘贴的图片',mime:file.type,data}
}


const PROJECT_KEY='ax-crew.projects'
// Projects are directories; the same directory may be spelled with either slash.
const normalizePath=(value:string)=>value.replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase()
const baseName=(value:string)=>value.replace(/\\/g,'/').replace(/\/+$/,'').split('/').pop()||value
function loadProjectDirs(){
  try{const value=JSON.parse(localStorage.getItem(PROJECT_KEY)??'[]');return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[]}catch{return []}
}

function timeLabel(value?:number|null){
  if(!value)return ''
  const ms=value<1e12?value*1000:value
  const date=new Date(ms)
  const now=new Date()
  const clock=date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})
  return date.toDateString()===now.toDateString()?clock:`${date.getMonth()+1}/${date.getDate()} ${clock}`
}

function LocalThread({session,project}:{session:LocalAxSession|undefined;project:LocalAxProject|undefined}){
  const history=useQuery({queryKey:['local-session',session?.id],queryFn:()=>endpoints.localSession(session!.id),enabled:!!session,retry:1,refetchOnWindowFocus:false})
  const lines=useMemo(()=>transcript(history.data),[history.data])
  if(!session)return <div className="session-thread-waiting">正在读取本地 AX 会话…</div>
  return <div className="session-transcript"><div className="session-transcript-meta">本地 AX · {session.title}{project?` · ${project.root}`:''}</div>
    {history.isError&&<div className="session-inline-error">读取本地记录失败：{String(history.error)} <button onClick={()=>void history.refetch()}>重试</button></div>}
    {!history.isLoading&&!history.isError&&!lines.length&&<div className="session-thread-waiting">这个会话没有可显示的消息。</div>}
    {lines.map(line=><div className={`session-transcript-line is-${line.type}`} key={line.key}><div className="session-transcript-avatar">{line.type==='user'?'你':line.type==='tool'?'⚙':'AX'}</div><div className="session-transcript-body"><div className="session-transcript-author">{line.type==='user'?'你':line.type==='tool'?'工具':line.type==='thought'?'思考':'AX Crew'}{line.status&&<small>{line.status}</small>}</div><MessageMarkdown text={line.text}/></div></div>)}
  </div>
}

export function SessionsWorkspace(){
  const {id}=useParams(),navigate=useNavigate(),location=useLocation(),queryClient=useQueryClient(),[params]=useSearchParams()
  const ui=useSessionUi()
  const {listOpen,setListOpen,rightOpen,setRightOpen,rightTab,setRightTab,thinkingEffort,setThinkingEffort}=ui
  const sessions=useSessions(),tasks=useTasks(),members=useAllMembers(),devices=useDevices(),permissions=usePermissions(),localAx=useLocalAx()
  const settings=useQuery({queryKey:['settings'],queryFn:endpoints.settings})
  const ax=useQuery({queryKey:['ax-local'],queryFn:axLocalState,enabled:axAvailable,retry:false})
  const [suggestionPage,setSuggestionPage]=useState(0)
  const [search,setSearch]=useState(''),[onlyActive,setOnlyActive]=useState(false),[projectsOpen,setProjectsOpen]=useState(true),[recentOpen,setRecentOpen]=useState(true),[remoteOpen,setRemoteOpen]=useState(false)
  const [projectDirs,setProjectDirs]=useState<string[]>(loadProjectDirs),[openProject,setOpenProject]=useState<string|null>(null)
  const [sending,setSending]=useState(false),[sendError,setSendError]=useState('')
  const [imagesByDraft,setImagesByDraft]=useState<Record<string,AttachedImage[]>>({})
  const [goalOpen,setGoalOpen]=useState(false)
  const [cursor,setCursor]=useState(0),[completionIndex,setCompletionIndex]=useState(0),[completionClosed,setCompletionClosed]=useState(false)
  const inputRef=useRef<HTMLTextAreaElement>(null),imageInputRef=useRef<HTMLInputElement>(null),scrollRef=useRef<HTMLDivElement>(null),followScroll=useRef(true),sendLock=useRef(false),mounted=useRef(true)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const locationRef=useRef(location.key);locationRef.current=location.key
  const groups=useMemo(()=>conversations(sessions.data??[],tasks.data??[],[...ui.startingIds,...(id?[id]:[])]),[sessions.data,tasks.data,ui.startingIds,id])
  const current=groups.find(group=>group.tasks.some(task=>task.id===id))
  const task=current?.latest??tasks.data?.find(item=>item.id===id)
  const selectedBinding=current?.binding
  const draftKey=current?.root.id??id??'new'
  const draft=ui.drafts[draftKey]??''
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
  const setDraft=(text:string)=>ui.setDraft(draftKey,text)
  const selectedMember=members.data?.find(item=>item.id===task?.assigned_member)
  const member=id?selectedMember:undefined
  const device=devices.data?.find(item=>item.id===member?.device_id)
  const busy=isActiveTask(task)
  const history=useQuery({queryKey:['history',task?.id],queryFn:()=>endpoints.history(task!.id),enabled:!!selectedBinding,staleTime:Infinity,refetchOnWindowFocus:false,retry:1,placeholderData:(previous,previousQuery)=>current?.tasks.some(item=>item.id===previousQuery?.queryKey[1])?previous:undefined})
  const streams=useLive(state=>state.streams)
  const freshEvents=useMemo(()=>(streams[task?.id??'']??[]).filter(event=>event.kind.startsWith('agent.')||event.kind.startsWith('tool.')),[streams,task?.id])
  const historySettled=!!task?.finished_at&&history.dataUpdatedAt>task.finished_at*1000&&!history.isFetching&&!history.isError
  const lines=useMemo(()=>conversationTranscript(history.data,historySettled?[]:freshEvents,task,!historySettled),[history.data,freshEvents,task,historySettled])
  const rows=groups.map(group=>({binding:{...group.binding,task_id:group.root.id,ax_session_id:group.key,member_id:group.root.assigned_member,device_id:group.root.assigned_device},task:group.root,latest:group.latest,latestAt:group.latest.created_at,key:group.key}))
  const visibleRows=rows.filter(row=>{
    const label=`${row.task?.title??''} ${row.binding.ax_session_id}`.toLowerCase()
    return label.includes(search.toLowerCase())&&(!onlyActive||!!row.task&&isActiveTask(row.latest))
  })
  // Conversations that already exist in the local AX store are listed next to the
  // Crew ones; they are read in place and only adopted when the user continues them.
  const localId=params.get('local'),localMode=!!localId&&!id
  const localGroups=useMemo(()=>{
    const needle=search.trim().toLowerCase()
    return (localAx.data?.projects??[]).map(project=>({project,sessions:project.sessions.filter(session=>!needle||`${session.title} ${session.preview}`.toLowerCase().includes(needle))})).filter(group=>!!group.sessions.length||(!!group.project.error&&!needle))
  },[localAx.data,search])
  const localMatch=localGroups.flatMap(group=>group.sessions.map(session=>({session,project:group.project}))).find(item=>item.session.id===localId)
  // Paired machines other than this one: their own AX projects and sessions.
  const remoteDevices=(devices.data??[]).filter(device=>device.id!=='local')
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
    return items
  },[localAx.data,projectDirs])
  // A project owns every session that ran in its directory: AX history first, then
  // the Crew conversations that are not already one of those AX sessions.
  const projectSessions=(project:{root:string;sessions:LocalAxSession[]})=>{
    const known=new Set(project.sessions.map(session=>session.id))
    const crew=rows.filter(row=>{
      if(known.has(row.binding.ax_session_id))return false
      const member=members.data?.find(item=>item.id===row.binding.member_id)
      return !!member&&normalizePath(member.cwd)===normalizePath(project.root)
    })
    return [
      ...project.sessions.map(session=>({key:`local:${session.id}`,title:session.title||'未命名会话',at:session.updated_at,active:false,attached:!!session.task_id,open:()=>openLocal(session)})),
      ...crew.map(row=>({key:`crew:${row.binding.ax_session_id}`,title:row.task?.title??'会话',at:row.latestAt,active:isActiveTask(row.latest),attached:true,open:()=>navigate(`/sessions/${row.binding.task_id}`)})),
    ].sort((a,b)=>b.at-a.at)
  }
  const persistProjects=(next:string[])=>{setProjectDirs(next);try{localStorage.setItem(PROJECT_KEY,JSON.stringify(next))}catch{/* a local convenience only */}}
  const startInProject=(root:string)=>{ui.setSelectedCwd(root);newSession()}
  const addProject=async()=>{
    if(!axAvailable){setSendError('请在 AX Crew 桌面应用中选择项目目录。');return}
    try{
      const selected=await open({directory:true,multiple:false,defaultPath:workspace})
      if(typeof selected!=='string')return
      if(!projectDirs.some(directory=>normalizePath(directory)===normalizePath(selected)))persistProjects([...projectDirs,selected])
      setOpenProject(normalizePath(selected))
    }catch(error){setSendError(String(error))}
  }
  const openLocal=(session:LocalAxSession)=>navigate(session.task_id?`/sessions/${session.task_id}`:`/sessions?local=${encodeURIComponent(session.id)}`)
  const adoptLocal=async()=>{
    if(!localMatch)return
    const task=await api<Task>('/api/sessions/attach','POST',{ax_session_id:localMatch.session.id,cwd:localMatch.project.root,title:localMatch.session.title})
    queryClient.setQueryData<Task[]>(['tasks'],old=>[...(old??[]).filter(entry=>entry.id!==task.id),task])
    navigate(`/sessions/${task.id}`)
  }
  const canSend=(!!draft.trim()||images.length>0)&&!sending&&(!id||!!selectedBinding&&!busy)
  const addImages=async(files:File[])=>{try{if(images.length+files.length>4)throw new Error('最多添加 4 张图片');const added=await Promise.all(files.map(imageFromFile));setImagesByDraft(state=>({...state,[draftKey]:[...(state[draftKey]??[]),...added]}));setSendError('')}catch(error){setSendError(String(error))}}

  useEffect(()=>{setSendError('');followScroll.current=true;requestAnimationFrame(()=>inputRef.current?.focus())},[draftKey])
  useEffect(()=>{if(followScroll.current&&scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight},[lines,draftKey])
  useEffect(()=>{const close=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape')setRightOpen(false);if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='b'){event.preventDefault();setListOpen(!listOpen)}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[listOpen,setListOpen,setRightOpen])

  const newSession=()=>{useSessionUi.getState().setDraft('new','');useSessionUi.getState().setPermissionMode('new',ui.defaultPermission);setSendError('');navigate('/sessions');requestAnimationFrame(()=>inputRef.current?.focus())}
  const chooseSuggestion=(value:string)=>{setDraft(value);inputRef.current?.focus()}
  const showDetails=()=>{setRightTab('details');setRightOpen(true)}
  const send=async()=>{
    const text=draft.trim()
    if(!canSend||sendLock.current)return
    sendLock.current=true;setSending(true);setSendError('')
    const origin=locationRef.current,sourceKey=draftKey,binding=selectedBinding,attached=imagesByDraft[draftKey]??[]
    try{
      const created=id
        ?await api<Task>(`/api/sessions/${encodeURIComponent(task!.id)}/message`,'POST',{text,images:attached,permission_profile:permissionMode})
        :await api<Task>('/api/sessions','POST',{title:text.slice(0,60)||'图片',text,images:attached,cwd:ui.selectedCwd??settings.data?.default_cwd,provider:ax.data?.selected_model?.provider,model:ax.data?.selected_model?.id,permission_profile:permissionMode,...(thinkingEffort?{reasoning_effort:thinkingEffort}:{})})
      queryClient.setQueryData<Task[]>(['tasks'],old=>[...(old??[]).filter(item=>item.id!==created.id),created])
      if(binding)queryClient.setQueryData<Session[]>(['sessions'],old=>[...(old??[]).filter(item=>item.task_id!==created.id),{...binding,task_id:created.id}])
      else {useSessionUi.getState().addStarting(created.id);useSessionUi.getState().setPermissionMode(created.id,permissionMode)}
      if(useSessionUi.getState().drafts[sourceKey]===draft)useSessionUi.getState().setDraft(sourceKey,'')
      setImagesByDraft(state=>({...state,[sourceKey]:[]}))
      if(mounted.current&&locationRef.current===origin){
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
  const title=localMode?(localMatch?.session.title||'本地 AX 会话'):id?(current?.root.title??task?.title??'加载会话…'):'新会话'
  const permissionLabel=({ask:'常规',read:'读取',trust:'信任',yolo:'YOLO'} as const)[permissionMode]
  const thinkingLabel=({low:'快速',medium:'标准',high:'深度'} as const)[thinkingEffort]??'自动'
  const thinkingOptions=[['','自动'],['low','快速'],['medium','标准'],['high','深度']] as const
  const workspace=member?.cwd??ui.selectedCwd??settings.data?.default_cwd
  const models=ax.data?.providers.filter(provider=>provider.configured).flatMap(provider=>provider.models)??[]
  const selectedModel=ax.data?.selected_model
  const slashToken=draft.slice(0,cursor).match(/(?:^|\n)\/([^\s]*)$/)?.[1]
  const referenceToken=draft.slice(0,cursor).match(/(?:^|\s)@([^\s]*)$/)?.[1]
  const debouncedReference=useDebouncedValue(referenceToken??'',180)
  const fileMatches=useQuery({queryKey:['workspace-file-search',workspace,debouncedReference],queryFn:()=>invoke<string[]>('search_workspace_files',{root:workspace,query:debouncedReference}),enabled:axAvailable&&!!workspace&&referenceToken!==undefined,retry:false})
  const completions=referenceToken!==undefined?(fileMatches.data??[]).map(path=>({kind:'file' as const,value:path,label:path,description:'引用工作区文件'}))
    :slashToken!==undefined?slashCommands.filter(item=>item.name.slice(1).includes(slashToken.toLowerCase())).map(item=>({kind:'slash' as const,value:item.name,label:item.name,description:item.description})):[]
  const runAxSlash=(command:string)=>{
    if(!axAvailable||!workspace||!ax.data?.active_path){setSendError('请在桌面应用中连接 AX 后使用该命令。');return}
    const escaped=ax.data.active_path.replaceAll("'","''")
    useTerminalDock.getState().addTab(workspace,`& '${escaped}' tui`)
    setSendError(`AX 终端已打开，请在终端输入 ${command}。`)
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
    if(!axAvailable){setSendError('请在 AX Crew 桌面应用中选择工作目录。');return}
    try{
      const selected=await open({directory:true,multiple:false,defaultPath:workspace})
      if(typeof selected==='string')ui.setSelectedCwd(selected)
    }catch(error){setSendError(String(error))}
  }
  const chooseModel=async(provider:string,model:string)=>{
    try{queryClient.setQueryData(['ax-local'],await axSelectModel(provider,model));setSendError('')}
    catch(error){setSendError(String(error))}
  }
  const startLoop=(config:LoopStart)=>{
    if(!workspace){setSendError('请先选择工作目录再启动循环。');return}
    const key=loopKey??draftKey
    const run:LoopRun={...config,taskId:id??null,cwd:workspace,provider:ax.data?.selected_model?.provider??null,model:ax.data?.selected_model?.id??null,reasoningEffort:thinkingEffort||undefined,permissionProfile:permissionMode,stopFile:stopFileRelative,rounds:0,errors:0,startedAt:Date.now(),status:'running',detail:''}
    setSendError('');setGoalOpen(false)
    startGoalLoop(key,run,task=>{useSessionUi.getState().addStarting(task.id);navigate(`/sessions/${task.id}`)})
  }
  const stopLoop=()=>stopGoalLoop(loopKey??draftKey)
  const clearLoop=()=>useGoalLoop.getState().clear(loopKey??draftKey)

  return <div className={`sessions-workspace ${listOpen?'has-session-list':''} ${rightOpen?'has-right-panel':''}`}>
    <aside className={`session-list-panel ${listOpen?'':'is-closed'}`} aria-label={listOpen?'会话列表':'会话列表已收起'}>
      <div className="session-list-rail" aria-hidden={listOpen}>
        <button className="session-rail-button is-current" aria-label="展开会话列表" title="展开会话列表" onClick={()=>setListOpen(true)}><MessageSquare size={18}/></button>
      </div>
      <div className="session-list-heading"><button className="session-list-toggle" aria-label="收起会话列表" aria-expanded={listOpen} title="收起会话列表" onClick={()=>setListOpen(false)}><MessageSquare size={18}/><strong>会话</strong></button></div>
      <div className="session-list-body" aria-hidden={!listOpen}>
      <button className="session-new-chat" aria-label="新聊天" title="新聊天" tabIndex={listOpen?0:-1} onClick={newSession}><SquarePen size={17}/><span>新聊天</span></button>
      <div className="session-list-search"><Search size={17}/><input aria-label="搜索会话" value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索会话…"/><button className={onlyActive?'is-filtered':''} aria-label="筛选活动会话" title={onlyActive?'显示所有会话':'仅显示活动会话'} onClick={()=>setOnlyActive(value=>!value)}><SlidersHorizontal size={17}/></button></div>
      <div className="session-list-scroll">
        <section className="session-section" aria-label="项目">
          <button className="session-section-head" aria-label="项目" aria-expanded={projectsOpen} onClick={()=>setProjectsOpen(value=>!value)}><strong>项目</strong><ChevronRight size={16} className={projectsOpen?'rotate-90':''}/></button>
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
                  <button className="session-project-action" aria-label={`在 ${project.name} 中新建会话`} title="在此项目中新会话" onClick={()=>startInProject(project.root)}><SquarePen size={15}/></button>
                  <Menu trigger={<button className="session-project-action" type="button" aria-label={`${project.name} 的更多操作`} title="更多操作"><MoreHorizontal size={15}/></button>} items={[
                    {label:'在此项目中新会话',action:()=>startInProject(project.root)},
                    {label:'设为当前工作目录',action:()=>ui.setSelectedCwd(project.root)},
                    ...(project.picked?[{label:'从项目列表移除',action:()=>persistProjects(projectDirs.filter(directory=>normalizePath(directory)!==project.key))}]:[]),
                  ]}/>
                </div>
                {opened&&<div className="session-project-sessions">
                  {sessions.map(item=><button key={item.key} className={`session-project-session ${item.active?'is-active':''}`} onClick={item.open}>
                    <span className="session-project-title">{item.title}</span>
                    {item.active?<span className="session-project-flag">正在回复…</span>:<small>{timeLabel(item.at)}</small>}
                  </button>)}
                  {!sessions.length&&<div className="session-local-note">这个项目还没有会话</div>}
                </div>}
              </div>
            })}
            {!projects.length&&<div className="session-list-empty">{localAx.isLoading?'正在读取本地 AX…':'还没有项目，先选一个目录。'}</div>}
            <button className="session-add-project" onClick={()=>void addProject()}><FolderPlus size={15}/><span>选择目录…</span></button>
          </div>}
        </section>
        <section className="session-section" aria-label="最近">
          <button className="session-section-head" aria-label="最近" aria-expanded={recentOpen} onClick={()=>setRecentOpen(value=>!value)}><strong>最近</strong><ChevronRight size={16} className={recentOpen?'rotate-90':''}/></button>
          {recentOpen&&<div className="session-section-body">
            {visibleRows.map(row=><button key={row.binding.ax_session_id} className={`session-recent-row ${current?.key===row.key?'is-selected':''}`} onClick={()=>navigate(`/sessions/${row.binding.task_id}`)}>
              {isActiveTask(row.latest)&&<span className="session-recent-dot"/>}
              <span className="session-project-title">{row.task?.title||'未命名会话'}</span>
              <small>{timeLabel(row.latestAt)}</small>
            </button>)}
            {!visibleRows.length&&<div className="session-list-empty">{sessions.isLoading?'正在加载会话…':search||onlyActive?'没有匹配的会话':'还没有会话。输入消息开始。'}</div>}
          </div>}
        </section>
        <section className="session-section is-remote" aria-label="远程 AX 项目">
          <button className="session-section-head" aria-label="远程项目" aria-expanded={remoteOpen} onClick={()=>setRemoteOpen(value=>!value)}><Laptop size={16}/><strong>远程项目</strong><span className="session-section-count">{remoteDevices.length||''}</span><ChevronRight size={16} className={remoteOpen?'rotate-90':''}/></button>
          {remoteOpen&&<div className="session-section-body">
            {remoteDevices.map(device=>{
              const deviceRows=rows.filter(row=>row.binding.device_id===device.id)
              return <div key={device.id} className="session-local-project">
                <div className="session-remote-device"><span className={`session-remote-dot is-${device.status}`}/><strong>{device.name}</strong><small>{device.hostname||device.platform}</small><em>{device.status==='online'||device.status==='busy'?'在线':'离线'}</em></div>
                {deviceRows.map(row=><button key={row.binding.ax_session_id} className={`session-list-row session-local-row ${current?.key===row.key?'is-selected':''}`} onClick={()=>navigate(`/sessions/${row.binding.task_id}`)}>
                  <span className="session-row-top"><small>远程 AX</small><small>{timeLabel(row.latestAt)}</small></span>
                  <strong>{row.task?.title??'会话'}</strong>
                  <span className="session-row-preview">{isActiveTask(row.latest)?'正在回复…':row.task?.description||'AX Session'}</span>
                </button>)}
                {!deviceRows.length&&<div className="session-local-note">{device.status==='online'||device.status==='busy'?'这个设备还没有 AX 会话':'设备离线'}</div>}
              </div>
            })}
            {!remoteDevices.length&&<div className="session-local-note">还没有配对的远程 AX 设备。<Link className="session-local-link" to="/devices?pair=1">去配对</Link></div>}
          </div>}
        </section>
      </div>
      </div>
    </aside>

    <section className="session-chat-panel">
      <div className="session-chat-header"><Menu trigger={<button className="session-title-menu" aria-label="会话菜单"><strong title={title}>{title}</strong><ChevronDown size={15}/></button>} items={[{label:'新建会话',action:newSession},{label:'会话详情',action:showDetails},...(id?[{label:'打开关联任务',action:()=>navigate(`/tasks/${task?.id??id}`)}]:[])]}/><div className="session-header-spacer"/>{id&&<Link className="session-header-icon" to={`/tasks/${task?.id??id}`} aria-label="查看关联任务" title="查看关联任务"><ExternalLink size={17}/></Link>}</div>
      <div className="session-chat-scroll" ref={scrollRef} onScroll={event=>{const node=event.currentTarget;followScroll.current=node.scrollHeight-node.scrollTop-node.clientHeight<80}}>
        {localMode?<LocalThread session={localMatch?.session} project={localMatch?.project}/>:id&&!task&&!tasks.isPending?<div className="session-thread-waiting">{tasks.error?'加载会话失败，请重试':'会话不存在或已被删除'}<button onClick={()=>void tasks.refetch()}>重新加载</button></div>:!id?<div className="session-welcome"><div className="session-welcome-title"><h1>我能帮你做什么？</h1></div><div className="session-suggestions">{(suggestionPage%2?['检查项目的测试情况','帮我阅读项目文档','查找重复的代码','整理当前工作区文件','分析最近的错误','列出可执行的下一步']:suggestions).map(item=><button key={item} onClick={()=>chooseSuggestion(item)}>{item}</button>)}<button className="session-refresh-suggestions" aria-label="换一组建议" title="换一组建议" onClick={()=>setSuggestionPage(value=>value+1)}><RotateCcw size={16}/></button></div></div>
        :<div className="session-transcript"><div className="session-transcript-meta">{selectedBinding?`AX Session · ${selectedBinding.ax_session_id}`:task?.status==='failed'?'会话启动失败':'正在连接 AX Session…'}</div>{history.error&&<div className="session-inline-error">读取会话历史失败：{String(history.error)} <button onClick={()=>void history.refetch()}>重试</button></div>}{lines.length?lines.map(line=><div className={`session-transcript-line is-${line.type}`} key={line.key}><div className="session-transcript-avatar">{line.type==='user'?'你':line.type==='tool'?'⚙':'AX'}</div><div className="session-transcript-body"><div className="session-transcript-author">{line.type==='user'?'你':line.type==='tool'?'工具':line.type==='thought'?'思考':'AX Crew'}{line.status&&<small>{line.status}</small>}</div><MessageMarkdown text={line.text}/></div></div>):<div className="session-thread-waiting">{task?.status==='failed'?`会话启动失败：${task.output?.error??'请查看关联任务'}`:task?.status==='cancelled'?'已停止':selectedBinding?'正在加载消息…':'正在启动会话…'}</div>}</div>}
      </div>
      {localMode?<div className="session-local-bar" role="status"><span>只读查看本地 AX 中的这段对话</span><div className="session-local-bar-actions">{localMatch?.session.task_id?<Link className="session-local-link" to={`/sessions/${localMatch.session.task_id}`}>已在 Crew 中打开 <ExternalLink size={13}/></Link>:<Action variant="default" run={adoptLocal} disabled={!localMatch}>在 Crew 中继续</Action>}</div></div>:<div className="session-composer-wrap">
        {!id&&members.isSuccess&&!members.data.length&&<div className="session-inline-error" role="status">本地 AX 运行环境未就绪。<Link to="/settings">查看设置</Link></div>}        {!id&&members.isError&&<div className="session-inline-error" role="alert">读取运行环境失败：{String(members.error)} <button onClick={()=>void members.refetch()}>重试</button></div>}
        {permissions.data?.filter(permission=>permission.request.sessionId===selectedBinding?.ax_session_id).map(permission=><div className="session-permission-request" key={permission.request_id}><strong>{permission.request.toolCall.title}</strong><span>此操作需要你的确认</span><div>{permission.request.options.map(option=><Action key={option.optionId} run={()=>api(`/api/permissions/${permission.request_id}/resolve`,'POST',{option_id:option.optionId})}>{option.name}</Action>)}</div></div>)}
        {task&&<div className="session-run-status" role="status">{task.status==='waiting_permission'?'等待操作授权':busy?'正在回复…':task.status==='failed'?`执行失败：${task.output?.error??'查看关联任务了解详情'}`:task.status==='cancelled'?'已停止，可以继续发送消息':task.status==='waiting_user'?'等待你的回复':''}</div>}
        {loopRun&&<div className={`session-loop-status is-${loopRun.status}`} role="status"><span className="session-loop-dot"/><strong>{loopRun.kind==='goal'?'目标循环':'拉取请求监控'}</strong><span>{loopRun.status==='running'?`第 ${loopRun.rounds} 轮 · 每 ${loopRun.intervalSeconds} 秒`:(loopRun.detail||'已停止')}</span>{loopRun.status==='running'?<button type="button" onClick={stopLoop}>停止</button>:<button type="button" aria-label="清除循环状态" title="清除循环状态" onClick={clearLoop}><X size={13}/></button>}</div>}
        {completions.length>0&&!completionClosed&&<div className="session-completions" role="listbox" aria-label={referenceToken!==undefined?"文件引用建议":"AX 命令建议"}>{completions.map((item,index)=><button type="button" role="option" aria-selected={index===completionIndex} className={index===completionIndex?"is-active":""} key={item.value} onMouseDown={event=>event.preventDefault()} onClick={()=>selectCompletion(item)}><strong>{item.label}</strong><small>{item.description}</small></button>)}</div>}<form className="session-composer" onSubmit={onSubmit} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void addImages([...event.dataTransfer.files])}}><input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event=>{void addImages([...event.target.files??[]]);event.target.value=""}}/>{images.length>0&&<div className="session-image-previews">{images.map((image,index)=><div key={`${image.name}-${index}`} className="session-image-preview"><img src={`data:${image.mime};base64,${image.data}`} alt={image.name}/><button type="button" aria-label={`移除图片 ${index+1}`} onClick={()=>setImagesByDraft(state=>({...state,[draftKey]:(state[draftKey]??[]).filter((_,position)=>position!==index)}))}><X size={13}/></button></div>)}</div>}<textarea ref={inputRef} aria-label="发送消息" value={draft} disabled={sending} onChange={event=>{setDraft(event.target.value);setCursor(event.target.selectionStart);setCompletionClosed(false);setCompletionIndex(0)}} onClick={event=>setCursor(event.currentTarget.selectionStart)} onKeyUp={event=>setCursor(event.currentTarget.selectionStart)} onPaste={event=>{const pasted=[...event.clipboardData.files].filter(file=>file.type.startsWith("image/"));if(pasted.length)void addImages(pasted)}} onKeyDown={onComposerKeyDown} placeholder="给 AX Crew 发消息…" rows={2}/><div className="session-composer-actions"><Menu trigger={<button type="button" className="session-composer-icon" title="添加上下文" aria-label="添加上下文"><Plus size={20}/></button>} items={[{label:'添加图片',action:()=>imageInputRef.current?.click()},{label:'引用工作区文件',action:()=>{setRightTab('files');setRightOpen(true)}},{label:'会话详情',action:showDetails}]}/><button type="button" className="session-composer-icon" aria-label="设定目标" title="设定目标" onClick={()=>setGoalOpen(true)}><Target size={19}/></button><Menu trigger={<button type="button" className="session-composer-permission" aria-label="安全模式" title="选择会话访问权限"><ShieldCheck size={16}/>{permissionLabel}<ChevronDown size={13}/></button>} items={[{label:<><strong>常规</strong><small>执行可能改变内容的操作前询问</small></>,action:()=>ui.setPermissionMode(draftKey,"ask")},{label:<><strong>读取</strong><small>可读取信息，修改前需要确认</small></>,action:()=>ui.setPermissionMode(draftKey,"read")},{label:<><strong>信任</strong><small>当前会话无需逐项确认</small></>,action:()=>ui.setPermissionMode(draftKey,"trust")},{label:<><strong>YOLO</strong><small>默认自动授权后续会话</small></>,action:()=>ui.setPermissionMode(draftKey,"yolo")}]}/><div className="session-composer-spacer"/>{busy?<Action variant="danger" run={async()=>{await api(`/api/tasks/${task!.id}/cancel`,'POST',{});void queryClient.invalidateQueries({queryKey:['history',task!.id]})}}><Square size={15}/> 停止</Action>:<button className="session-send-button" type="submit" aria-label="发送消息" title={busy?'会话正在运行':'发送消息'} disabled={!canSend}><ArrowUp size={20}/></button>}</div></form>{sendError&&<div className="session-inline-error" role="alert">操作失败（消息内容已保留）：{sendError}</div>}<div className="session-composer-footer"><button className="session-footer-path" type="button" aria-label="选择工作目录" title={id?'当前会话的工作目录固定；新会话可选择':workspace??'选择工作目录'} disabled={!!id} onClick={()=>void chooseWorkspace()}><Folder size={14}/><span>{workspace??'选择工作目录'}</span></button><Menu trigger={<button className="session-footer-thinking" type="button" aria-label="思考程度" title="选择模型思考程度">{thinkingLabel}<ChevronDown size={13}/></button>} items={thinkingOptions.map(([value,label])=>({label,action:()=>setThinkingEffort(value)}))}/><Menu trigger={<button className="session-footer-auto" type="button" aria-label="选择 AX 模型" title="选择 AX 已登录的模型">{selectedModel?.id??'auto'}<ChevronDown size={13}/></button>} items={models.length?models.map(model=>({label:`${model.display_name} · ${model.provider}`,action:()=>{void chooseModel(model.provider,model.id)}})):[{label:'前往设置连接模型',action:()=>navigate('/settings')}]}/></div></div>}
    </section>

    {rightOpen&&<button className="session-right-backdrop" aria-label="关闭右侧面板遮罩" onClick={()=>setRightOpen(false)}/>}
    <aside className={`session-right-panel ${rightOpen?'':'is-closed'}`} aria-label={rightOpen?'会话侧栏':'会话侧栏已收起'}>
      <div className="session-right-tabs">
        {rightOpen&&<><button className={rightTab==='files'?'active':''} onClick={()=>setRightTab('files')}><Folder size={17}/> 文件</button><button className={rightTab==='details'?'active':''} onClick={()=>setRightTab('details')}><SlidersHorizontal size={17}/> 详情</button></>}
        <button className="session-right-toggle" aria-label={rightOpen?'关闭右侧面板':'打开右侧面板'} title={rightOpen?'收起右侧面板':'展开右侧面板'} aria-expanded={rightOpen} onClick={()=>setRightOpen(!rightOpen)}><PanelRight size={18}/></button>
      </div>
      {rightOpen&&(rightTab==='files'?<WorkspaceFiles key={member?.id} member={member} onReference={path=>{setDraft(`${draft}${draft?'\n':''}@file ${path}`);inputRef.current?.focus()}}/>:<div className="session-right-details"><div><span>设备</span><strong>{device?.name??member?.device_id??'—'}</strong></div><div><span>任务状态</span><strong>{task?.status??'新会话'}</strong></div><div><span>AX Session</span><strong className="session-detail-id">{selectedBinding?.ax_session_id??'—'}</strong></div>{id&&<Link to={`/tasks/${task?.id??id}`}>查看关联任务 <ExternalLink size={14}/></Link>}</div>)}
    </aside>
    <GoalLoopDialog open={goalOpen} onOpenChange={setGoalOpen} storeKey={loopKey??draftKey} run={loopRun} workspace={workspace} disabled={!axAvailable||!workspace} onStart={startLoop} onStop={stopLoop}/>
  </div>
}
