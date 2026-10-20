import { applyTheme } from './lib/themes'
import { usePanelDrawer } from './lib/usePanelDrawer'
import { WorkspaceLayoutContext, useWorkspaceLayoutManager } from './lib/workspaceLayoutContext'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { HashRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { Activity, CalendarDays, Cpu, House, ListTodo, Monitor, Settings2, ShieldCheck, Users, MessagesSquare, Plus, PanelLeftClose, PanelLeftOpen, SquareTerminal, Globe, Package } from 'lucide-react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { CommandPalette, type CommandGroup } from './components/CommandPalette'
import { Titlebar } from './components/Titlebar'
import { TerminalDock, terminalDockClass } from './components/TerminalDock'
import { queryClient } from './lib/runtime'
import { endpoints } from './lib/api'
import { startLive } from './lib/live'
import { startCompletionNotifications } from './lib/completionNotifications'
import { CompletionDot } from './components/CompletionDot'
import { startWindowScale } from './lib/scale'
import { useCrews, useDevices, useSessions, useTasks } from './lib/query'
import { useUi } from './store/ui'
import { useTerminalDock } from './store/terminal'
import { useSessionUi } from './store/sessions'
import { useLang, useT } from './lib/i18n'
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
import { Distributed } from './pages/Distributed'
import './styles.css'

const primaryNav=[['/sessions','nav.sessions',MessagesSquare],['/schedule','nav.schedule',CalendarDays],['/artifacts','nav.artifacts',Package],['/distributed','nav.distributed',Users]] as const
const utilityNav=[['/connect','nav.connect',Globe],['/settings','nav.settings',Settings2]] as const
const nav=[...primaryNav,...utilityNav,['/overview','nav.overview',House],['/crews','nav.crews',Users],['/tasks','nav.tasks',ListTodo],['/devices','nav.devices',Monitor],['/activity','nav.activity',Activity]] as const
function Shell(){
  const {setSidebar:saveSidebar,palette,setPalette,theme,themePreset,focus,setFocus}=useUi()
  const navigationRef=useRef<HTMLElement>(null),workspaceRef=useRef<HTMLDivElement>(null),[compactNavOpen,setCompactNavOpen]=useState(false)
  const t=useT()
  const lang=useLang(state=>state.lang)
  useEffect(()=>{document.documentElement.lang=lang==='zh'?'zh-CN':'en'},[lang])
  const terminal=useTerminalDock()
  const terminalCwd=useSessionUi(state=>state.selectedCwd),layoutReset=useSessionUi(state=>state.layoutReset)
  useEffect(()=>setCompactNavOpen(false),[layoutReset])
  usePanelDrawer(navigationRef,compactNavOpen)
  const crews=useCrews(),sessions=useSessions(),tasks=useTasks(),devices=useDevices(),backend=useQuery({queryKey:['settings'],queryFn:endpoints.settings,retry:1})
  const navigate=useNavigate(),location=useLocation(),sessionView=location.pathname.startsWith('/sessions')
  const terminalContext=useMemo(()=>sessionView?(terminal.sessionContext??{deviceId:'local',blocked:'loading' as const}):{deviceId:'local',cwd:terminalCwd??backend.data?.default_cwd},[sessionView,terminal.sessionContext,terminalCwd,backend.data?.default_cwd])
  useLayoutEffect(()=>useTerminalDock.getState().setContext(terminalContext),[terminalContext])
  const layout=useWorkspaceLayoutManager(workspaceRef,sessionView,terminal.open&&terminal.position==='right')
  const sidebar=layout.navigation==='expanded'||compactNavOpen
  const setSidebar=(value:boolean)=>{saveSidebar(value);setCompactNavOpen(value&&layout.navigation!=='expanded')}
  useEffect(()=>{if(layout.navigation==='expanded')setCompactNavOpen(false)},[layout.navigation])
  // Utility entries share the /devices path, so they match on the exact path plus
  // their query flag. Plain links are used because NavLink would also append its own
  // prefix-based `active` class to the first /devices entry.
  const utilityActive=(path:string)=>{
    const [target,query]=path.split('?')
    const wanted=new URLSearchParams(query??'')
    const current=new URLSearchParams(location.search)
    return (location.pathname===target||(target==='/settings'&&location.pathname.startsWith('/settings/')))&&[...wanted.keys()].every(key=>current.has(key))
  }
  useEffect(()=>{if(!compactNavOpen)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented)setCompactNavOpen(false)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[compactNavOpen])
  const navigationType=useNavigationType(),historyIndex=Number(window.history.state?.idx??0),maxHistory=useRef(historyIndex)
  if(navigationType==='PUSH')maxHistory.current=historyIndex
  else maxHistory.current=Math.max(maxHistory.current,historyIndex)
  const sessionRows=useMemo(()=>conversations(sessions.data??[],tasks.data??[]),[sessions.data,tasks.data])
  useEffect(()=>startLive(),[])
  useEffect(()=>startCompletionNotifications(),[])
  useEffect(()=>startWindowScale(),[])
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setPalette(true)}if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='b'){e.preventDefault();setSidebar(!sidebar)}if((e.ctrlKey||e.metaKey)&&e.code==='Backquote'){e.preventDefault();useTerminalDock.getState().setOpen(!useTerminalDock.getState().open,terminalCwd??backend.data?.default_cwd,terminalContext)}if(e.altKey&&e.key.toLowerCase()==='c'){e.preventDefault();navigate('/sessions')}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[setPalette,navigate,backend.data?.default_cwd,terminalCwd,terminalContext,sidebar,layout.navigation])
  const [systemDark,setSystemDark]=useState(()=>window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)');const update=()=>setSystemDark(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[])
  const resolvedTheme=theme==='system'?(systemDark?'dark':'light'):theme
  useLayoutEffect(()=>applyTheme(document.documentElement,resolvedTheme,themePreset),[resolvedTheme,themePreset])
  const [focusReveal,setFocusReveal]=useState(false)
  useEffect(()=>{
    if(!focus){setFocusReveal(false);return}
    const onMove=(event:MouseEvent)=>setFocusReveal(revealed=>event.clientY<=12?true:event.clientY>42?false:revealed)
    window.addEventListener('mousemove',onMove)
    return()=>window.removeEventListener('mousemove',onMove)
  },[focus])
  const commandGroups=useMemo<CommandGroup[]>(()=>[
    {id:'sessions',label:t('shell.recentSessions'),kind:t('shell.recentSession'),limit:5,items:sessionRows.map(s=>({path:`/sessions/${s.root.id}`,label:s.root.title,icon:MessagesSquare}))},
    {id:'commands',label:t('shell.commandList'),kind:t('shell.commandKind'),items:[
      {path:'/sessions',label:t('shell.newSession'),description:t('shell.newSessionHint'),icon:Plus},
      {path:'/crews?create=1',label:t('shell.createCrew'),icon:Plus},{path:'/tasks?create=1',label:t('shell.createTask'),icon:Plus},{path:'/devices?pair=1',label:t('shell.addDevice'),icon:Plus},{path:'/tasks?status=running',label:t('shell.showRunningTasks'),icon:Cpu},{path:'/overview?permissions=1',label:t('shell.showPermissions'),icon:ShieldCheck},
    ]},
    {id:'pages',label:t('shell.pages'),kind:t('shell.pageKind'),items:nav.map(([path,key,icon])=>({path,label:t(key),icon}))},
    {id:'crews',label:t('nav.crews'),kind:t('shell.recentCrew'),items:(crews.data??[]).map(c=>({path:`/crews/${c.id}`,label:c.name,icon:Users}))},
    {id:'devices',label:t('nav.devices'),kind:t('shell.recentDevice'),items:(devices.data??[]).map(d=>({path:`/devices/${d.id}`,label:d.name,icon:Monitor}))},
    {id:'tasks',label:t('nav.tasks'),kind:t('shell.recentTask'),items:(tasks.data??[]).map(task=>({path:`/tasks/${task.id}`,label:task.title,icon:ListTodo}))},
  ],[crews.data,devices.data,tasks.data,sessionRows,t])
  return <WorkspaceLayoutContext.Provider value={layout}><div className={`app ${focus?'is-focus':''} ${focus&&focusReveal?'is-focus-reveal':''}`}>
    <Titlebar sidebarExpanded={sidebar} showNavigationToggle={layout.navigation==='hidden'} canGoBack={historyIndex>0} canGoForward={historyIndex<maxHistory.current} focus={focus} hidden={focus&&!focusReveal} onFocus={()=>setFocus(!focus)} onMenu={()=>setSidebar(!sidebar)} onBack={()=>{if(historyIndex>0)navigate(-1)}} onForward={()=>{if(historyIndex<maxHistory.current)navigate(1)}} onCommand={()=>setPalette(true)}/>
    {backend.isError&&<div className="backend-error" role="alert">{t('shell.backendFailed')}{String(backend.error)} <button onClick={()=>void queryClient.invalidateQueries()}>{t('shell.retryConnect')}</button></div>}
    <div ref={workspaceRef} className={`workspace managed-workspace ${compactNavOpen?'has-nav-drawer':''}`} style={{'--navigation-width':`${layout.navigationWidth}px`} as React.CSSProperties}>
    {compactNavOpen&&<button className="workspace-nav-backdrop" aria-label={lang==='zh'?'关闭导航抽屉':'Close navigation drawer'} onClick={()=>setCompactNavOpen(false)}/>}
    <aside ref={navigationRef} role={compactNavOpen?'dialog':undefined} aria-modal={compactNavOpen||undefined} aria-label={lang==='zh'?'主导航':'Main navigation'} className={`sidebar ${sidebar?'':'is-compact'} ${compactNavOpen?'is-drawer':''} ${layout.navigation==='hidden'&&!compactNavOpen?'is-hidden':''}`}>
      <button className="brand" type="button" aria-label={sidebar?t('titlebar.collapseNav'):t('titlebar.expandNav')} aria-expanded={sidebar} title={sidebar?t('titlebar.collapseNav'):t('titlebar.expandNav')} onClick={()=>setSidebar(!sidebar)}><span className="brand-mark" aria-hidden="true">AX</span><span className="brand-name" aria-hidden="true">AX <b>CREW</b></span><span className="sidebar-collapse" aria-hidden="true">{sidebar?<PanelLeftClose size={18}/>:<PanelLeftOpen size={18}/>}</span></button>
      <nav className="sidebar-nav sidebar-primary" aria-label={t('nav.primary')}>{primaryNav.map(([path,key,Icon])=>{const label=t(key);return <NavLink key={path} to={path} title={label} className={({isActive})=>`nav-item ${isActive?'active':''}`}><Icon size={18}/><span className="nav-label">{label}</span>{path==='/sessions'&&<CompletionDot/>}</NavLink>})}</nav>
      <nav className="sidebar-nav sidebar-utilities" aria-label={t('nav.utilities')}>
        <button className={`nav-item ${terminal.open?'active':''}`} type="button" aria-label={t('nav.terminal')} aria-pressed={terminal.open} title={t('nav.terminal')} onClick={()=>terminal.setOpen(!terminal.open,terminalCwd??backend.data?.default_cwd,terminalContext)}><SquareTerminal size={18}/><span className="nav-label">{t('nav.terminal')}</span></button>
        {utilityNav.map(([path,key,Icon])=>{const label=t(key);return <Link key={path} to={path} title={label} aria-current={utilityActive(path)?'page':undefined} className={`nav-item ${utilityActive(path)?'active':''}`}><Icon size={18}/><span className="nav-label">{label}</span></Link>})}
      </nav>
    </aside>
    <div className={`main ${terminalDockClass(terminal.position)}`}>
      <main className={`content ${sessionView?'content-session':''}`}><Routes><Route path="/" element={<Navigate to="/sessions" replace/>}/><Route path="/overview" element={<Home/>}/><Route path="/crews" element={<Crews/>}/><Route path="/crews/:id" element={<CrewDetail/>}/><Route path="/crews/:id/members/:memberId" element={<MemberWorkspace/>}/><Route path="/tasks" element={<Tasks/>}/><Route path="/tasks/:id" element={<TaskDetail/>}/><Route path="/devices" element={<Devices/>}/><Route path="/devices/:id" element={<DeviceDetail/>}/><Route path="/connect" element={<ConnectPhone/>}/><Route path="/sessions/:id?" element={<SessionsWorkspace/>}/><Route path="/schedule" element={<Schedule/>}/><Route path="/artifacts" element={<Artifacts/>}/><Route path="/distributed" element={<Distributed/>}/><Route path="/activity" element={<ActivityPage/>}/><Route path="/settings/:section?" element={<Settings/>}/></Routes></main>
      <TerminalDock context={terminalContext} theme={resolvedTheme} preset={themePreset}/>
    </div>
    </div>
    <CommandPalette open={palette} onOpenChange={setPalette} groups={commandGroups} onSelect={path=>navigate(path)}/>
  </div></WorkspaceLayoutContext.Provider>
}
export default function App(){return <QueryClientProvider client={queryClient}><HashRouter><Shell/></HashRouter></QueryClientProvider>}
