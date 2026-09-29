import { useEffect, useMemo, useRef, useState } from 'react'
import { HashRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { Activity, CalendarDays, Cpu, House, ListTodo, Monitor, Settings2, ShieldCheck, Users, MessagesSquare, Plus, PanelLeftClose, PanelLeftOpen, SquareTerminal, Smartphone, Sparkles, Package } from 'lucide-react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Dialog } from './components/ui/dialog'
import { Input } from './components/ui/input'
import { Titlebar } from './components/Titlebar'
import { TerminalDock, terminalDockClass } from './components/TerminalDock'
import { queryClient } from './lib/runtime'
import { endpoints } from './lib/api'
import { startLive, useLive } from './lib/live'
import { startWindowScale } from './lib/scale'
import { useCrews, useDevices, usePermissions, useSessions, useTasks } from './lib/query'
import { useUi } from './store/ui'
import { useTerminalDock } from './store/terminal'
import { useSessionUi } from './store/sessions'
import { Home } from './pages/Home'
import { Crews, CrewDetail, MemberWorkspace } from './pages/Crews'
import { Tasks, TaskDetail } from './pages/Tasks'
import { Devices, DeviceDetail } from './pages/Devices'
import { ConnectPhone } from './pages/ConnectPhone'
import { SessionsWorkspace } from './pages/SessionsWorkspace'
import { conversations } from './lib/conversations'
import { ActivityPage } from './pages/Activity'
import { Settings } from './pages/Settings'
import { Schedule } from './pages/Schedule'
import { Artifacts } from './pages/Artifacts'
import './styles.css'

const primaryNav=[['/sessions','会话',MessagesSquare],['/schedule','计划',CalendarDays],['/artifacts','产物',Package]] as const
const utilityNav=[['/connect','连接手机',Smartphone],['/devices/local','代理能力',Sparkles],['/settings','设置',Settings2]] as const
const nav=[...primaryNav,...utilityNav,['/overview','概览',House],['/crews','团队',Users],['/tasks','任务',ListTodo],['/devices','设备',Monitor],['/activity','动态',Activity]] as const
function Shell(){
  const {sidebar,setSidebar,palette,setPalette,theme,focus,setFocus}=useUi(),status=useLive(s=>s.status)
  const terminal=useTerminalDock()
  const terminalCwd=useSessionUi(state=>state.selectedCwd)
  const crews=useCrews(),sessions=useSessions(),tasks=useTasks(),devices=useDevices(),permissions=usePermissions(),backend=useQuery({queryKey:['settings'],queryFn:endpoints.settings,retry:1})
  const navigate=useNavigate(),location=useLocation(),sessionView=location.pathname.startsWith('/sessions')
  // Utility entries share the /devices path, so they match on the exact path plus
  // their query flag. Plain links are used because NavLink would also append its own
  // prefix-based `active` class to the first /devices entry.
  const utilityActive=(path:string)=>{
    const [target,query]=path.split('?')
    const wanted=new URLSearchParams(query??'')
    const current=new URLSearchParams(location.search)
    return location.pathname===target&&[...wanted.keys()].every(key=>current.has(key))
  }
  const navigationType=useNavigationType(),historyIndex=Number(window.history.state?.idx??0),maxHistory=useRef(historyIndex)
  if(navigationType==='PUSH')maxHistory.current=historyIndex
  else maxHistory.current=Math.max(maxHistory.current,historyIndex)
  const sessionRows=useMemo(()=>conversations(sessions.data??[],tasks.data??[]),[sessions.data,tasks.data])
  useEffect(()=>startLive(),[])
  useEffect(()=>startWindowScale(),[])
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setPalette(true)}if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='b'){e.preventDefault();useUi.getState().setSidebar(!useUi.getState().sidebar)}if((e.ctrlKey||e.metaKey)&&e.code==='Backquote'){e.preventDefault();useTerminalDock.getState().setOpen(!useTerminalDock.getState().open,terminalCwd??backend.data?.default_cwd)}if(e.altKey&&e.key.toLowerCase()==='c'){e.preventDefault();navigate('/sessions')}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[setPalette,navigate,backend.data?.default_cwd,terminalCwd])
  useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)');const apply=()=>{document.documentElement.dataset.theme=(theme==='system'?media.matches:theme==='dark')?'dark':'light'};apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply)},[theme])
  const [search,setSearch]=useState(''),[commandIndex,setCommandIndex]=useState(0),[focusReveal,setFocusReveal]=useState(false)
  useEffect(()=>{
    if(!focus){setFocusReveal(false);return}
    const onMove=(event:MouseEvent)=>setFocusReveal(revealed=>event.clientY<=12?true:event.clientY>42?false:revealed)
    window.addEventListener('mousemove',onMove)
    return()=>window.removeEventListener('mousemove',onMove)
  },[focus])
  useEffect(()=>{if(!palette){setSearch('');setCommandIndex(0)}},[palette])
  const commands=useMemo(()=>[
    ...nav.map(([path,label,icon])=>({path,label,icon})),
    ...(crews.data??[]).map(c=>({path:`/crews/${c.id}`,label:`Crew · ${c.name}`,icon:Users})),
    ...(devices.data??[]).map(d=>({path:`/devices/${d.id}`,label:`Device · ${d.name}`,icon:Monitor})),
    ...(tasks.data??[]).map(t=>({path:`/tasks/${t.id}`,label:`Task · ${t.title}`,icon:ListTodo})),
    ...sessionRows.map(s=>({path:`/sessions/${s.root.id}`,label:`会话 · ${s.root.title}`,icon:MessagesSquare})),
    {path:'/sessions',label:'新建会话',icon:Plus},
    {path:'/crews?create=1',label:'Create Crew',icon:Plus},{path:'/tasks?create=1',label:'Create Task',icon:Plus},{path:'/devices?pair=1',label:'Add Device',icon:Plus},{path:'/tasks?status=running',label:'Show Running Tasks',icon:Cpu},{path:'/overview?permissions=1',label:'Show Permissions',icon:ShieldCheck},
  ],[crews.data,devices.data,tasks.data,sessionRows])
  const filteredCommands=commands.filter(c=>c.label.toLowerCase().includes(search.toLowerCase())).slice(0,35)
  const runCommand=(index:number)=>{const command=filteredCommands[index];if(command){navigate(command.path);setPalette(false)}}
  return <div className={`app ${focus?'is-focus':''} ${focus&&focusReveal?'is-focus-reveal':''}`}>
    <Titlebar connection={status} backendUnavailable={backend.isError} permissionCount={permissions.data?.length??0}
      sidebarExpanded={sidebar} canGoBack={historyIndex>0} canGoForward={historyIndex<maxHistory.current} focus={focus} hidden={focus&&!focusReveal} onFocus={()=>setFocus(!focus)} onMenu={()=>setSidebar(!sidebar)} onBack={()=>{if(historyIndex>0)navigate(-1)}} onForward={()=>{if(historyIndex<maxHistory.current)navigate(1)}} onCommand={()=>setPalette(true)}
      onRunningTasks={()=>navigate('/tasks?status=running')} onDevices={()=>navigate('/devices')}
      onPermissions={()=>navigate('/overview?permissions=1')} onNotifications={()=>navigate('/activity')}/>
    {backend.isError&&<div className="backend-error" role="alert">本地服务连接失败：{String(backend.error)} <button onClick={()=>void queryClient.invalidateQueries()}>重试连接</button></div>}
    <div className="workspace">
    <aside className={`sidebar ${sidebar?'':'is-compact'}`}>
      <button className="brand" type="button" aria-label={sidebar?'收起主导航':'展开主导航'} aria-expanded={sidebar} title={sidebar?'收起主导航':'展开主导航'} onClick={()=>setSidebar(!sidebar)}><span className="brand-mark" aria-hidden="true">AX</span><span className="brand-name" aria-hidden="true">AX <b>CREW</b></span><span className="sidebar-collapse" aria-hidden="true">{sidebar?<PanelLeftClose size={18}/>:<PanelLeftOpen size={18}/>}</span></button>
      <nav className="sidebar-nav sidebar-primary" aria-label="主要导航">{primaryNav.map(([path,label,Icon])=><NavLink key={path} to={path} title={label} className={({isActive})=>`nav-item ${isActive?'active':''}`}><Icon size={18}/><span className="nav-label">{label}</span></NavLink>)}</nav>
      <nav className="sidebar-nav sidebar-utilities" aria-label="工具导航">
        <button className={`nav-item ${terminal.open?'active':''}`} type="button" aria-label="终端" aria-pressed={terminal.open} title="终端" onClick={()=>terminal.setOpen(!terminal.open,terminalCwd??backend.data?.default_cwd)}><SquareTerminal size={18}/><span className="nav-label">终端</span></button>
        {utilityNav.map(([path,label,Icon])=><Link key={path} to={path} title={label} aria-current={utilityActive(path)?'page':undefined} className={`nav-item ${utilityActive(path)?'active':''}`}><Icon size={18}/><span className="nav-label">{label}</span></Link>)}
      </nav>
    </aside>
    <div className={`main ${terminalDockClass(terminal.position)}`}>
      <main className={`content ${sessionView?'content-session':''}`}><Routes><Route path="/" element={<Navigate to="/sessions" replace/>}/><Route path="/overview" element={<Home/>}/><Route path="/crews" element={<Crews/>}/><Route path="/crews/:id" element={<CrewDetail/>}/><Route path="/crews/:id/members/:memberId" element={<MemberWorkspace/>}/><Route path="/tasks" element={<Tasks/>}/><Route path="/tasks/:id" element={<TaskDetail/>}/><Route path="/devices" element={<Devices/>}/><Route path="/devices/:id" element={<DeviceDetail/>}/><Route path="/connect" element={<ConnectPhone/>}/><Route path="/sessions/:id?" element={<SessionsWorkspace/>}/><Route path="/schedule" element={<Schedule/>}/><Route path="/artifacts" element={<Artifacts/>}/><Route path="/activity" element={<ActivityPage/>}/><Route path="/settings" element={<Settings/>}/></Routes></main>
      <TerminalDock cwd={terminalCwd??backend.data?.default_cwd} theme={theme==='light'||theme==='system'&&!window.matchMedia('(prefers-color-scheme: dark)').matches?'light':'dark'}/>
    </div>
    </div>
    <Dialog open={palette} onOpenChange={setPalette} title="运行命令"><Input autoFocus aria-label="搜索命令" placeholder="搜索页面、会话、团队或任务…" value={search} onChange={e=>{setSearch(e.target.value);setCommandIndex(0)}} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setCommandIndex(index=>Math.max(0,Math.min(filteredCommands.length-1,index+(e.key==='ArrowDown'?1:-1))))}if(e.key==='Enter'){e.preventDefault();runCommand(commandIndex)}}}/><div className="mt-3 max-h-[52vh] overflow-auto" role="listbox" aria-label="命令">{filteredCommands.map(({path,label,icon:Icon},index)=><button role="option" aria-selected={index===commandIndex} key={`${path}${label}`} className={`row w-full text-left command-option ${index===commandIndex?'is-selected':''}`} onMouseEnter={()=>setCommandIndex(index)} onClick={()=>runCommand(index)}><Icon size={15} className="text-muted"/>{label}</button>)}{!filteredCommands.length&&<p className="p-4 text-sm text-muted">没有匹配的命令</p>}</div></Dialog>
  </div>
}
export default function App(){return <QueryClientProvider client={queryClient}><HashRouter><Shell/></HashRouter></QueryClientProvider>}
