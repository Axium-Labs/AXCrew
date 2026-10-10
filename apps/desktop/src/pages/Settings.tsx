import { SettingsToggle } from '../components/ui/settings-toggle'
import { Personalization } from '../components/Personalization'
import { Usage } from './Usage'
import { ProviderLogin } from '../components/ProviderLogin'
import { translate, useLang } from '../lib/i18n'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { open, save } from '@tauri-apps/plugin-dialog'
import { Activity, Archive, ArrowRight, Bot, Check, ChevronDown, Download, Folder, Mic, Monitor, Palette, RefreshCw, Eye, EyeOff, Search, ShieldCheck, Upload, Wrench, Globe, Keyboard } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { endpoints } from '../lib/api'
import { axAvailable, axExport, axImport, axLocalState, axRefreshModels, axRemoveCredential, axSelectModel, axStoreApiKey, axSelectExecution, axTuiCommand } from '../lib/ax'
import type { AxLocalState } from '../lib/ax'
import { useSessions, useTasks } from '../lib/query'
import { useLive } from '../lib/live'
import { useUi } from '../store/ui'
import { useSessionUi } from '../store/sessions'
import { useTerminalDock } from '../store/terminal'
import './settings.css'
import { AxUpdater } from '../components/AxUpdater'
import { CrewUpdater } from '../components/CrewUpdater'
import { DesktopBehavior } from '../components/DesktopBehavior'
import { SystemMetrics } from '../components/SystemMetrics'
import { CapabilityImports } from '../components/CapabilityImports'
import { SettingsSelect } from '../components/ui/settings-select'
import { SettingsLocation, readableSettingsPath } from '../components/ui/settings-location'
import { AxCapabilities } from '../components/AxCapabilities'
import { ExecutionSettings } from '../components/ExecutionSettings'
import { Menu } from '../components/ui/menu'
import { AxDesktopControl } from '../components/AxDesktopControl'
import { AxBrowserControl } from '../components/AxBrowserControl'
import { useSettingsWorkspace } from '../lib/useSettingsWorkspace'
import { resolveSendWorkspace } from '../lib/workspace'

type Section = 'usage' | 'overview' | 'ax' | 'capabilities' | 'models' | 'personalization' | 'backup' | 'appearance' | 'speech' | 'system' | 'desktop' | 'browser'

const getSections = (): {id:Section;label:string;group:string;icon:typeof Activity}[] => [
  {id:'overview',label:translate("copy.0"),group:'',icon:Activity}, {id:'ax',label:translate("copy.1"),group:'',icon:Monitor},
  {id:'usage',label:translate('settings.usage'),group:'',icon:Activity},
  {id:'personalization',label:translate('settings.personalization'),group:'',icon:Activity},
  {id:'capabilities',label:translate("copy.2"),group:'',icon:Wrench},
  {id:'desktop',label:translate("copy.desktop"),group:translate("copy.4"),icon:Keyboard},
  {id:'browser',label:translate("copy.browser"),group:translate("copy.4"),icon:Globe},
  {id:'models',label:translate("copy.3"),group:translate("copy.4"),icon:Bot}, {id:'backup',label:translate("copy.5"),group:translate("copy.4"),icon:Archive},
  {id:'appearance',label:translate("copy.6"),group:translate("copy.4"),icon:Palette}, {id:'speech',label:translate("copy.7"),group:translate("copy.4"),icon:Mic}, {id:'system',label:translate("copy.9"),group:translate("copy.9"),icon:Monitor},
]
function Panel({title,children}:{title:string;children:ReactNode}){
  useLang(state=>state.lang);
return <section className="settings-card"><h2>{title}</h2>{children}</section>}
function Metric({label,value}:{label:string;value:string|number}){
  useLang(state=>state.lang);
return <div className="settings-metric"><span>{label}</span><strong>{value}</strong></div>}
function Report({value}:{value:string}){
  useLang(state=>state.lang);
let rendered=value;try{rendered=JSON.stringify(JSON.parse(value),null,2)}catch{/* AX may return plain text */}return <pre className="settings-report">{rendered}</pre>}

export function Settings(){
  useLang(state=>state.lang);

  const sections=getSections()
  const navigate=useNavigate(),query=useQueryClient(),status=useLive(state=>state.status)
  const settings=useQuery({queryKey:['settings'],queryFn:endpoints.settings})
  const health=useQuery({queryKey:['health'],queryFn:endpoints.health})
  const sessions=useSessions(),tasks=useTasks()
  const ax=useQuery({queryKey:['ax-local'],queryFn:axLocalState,enabled:axAvailable,retry:false})
  const {theme,setTheme,developer,setDeveloper,xfyAppid,xfyApiKey,xfyApiSecret,setXfy}=useUi()
  const selectedCwd=useSessionUi(state=>state.selectedCwd)
  const routeSection=useParams().section
  const [section,setSectionState]=useState<Section>('overview'),[search,setSearch]=useState('')
  useEffect(()=>{if(routeSection==='connections'){navigate('/connect',{replace:true});return}setSectionState(sections.some(item=>item.id===routeSection)?routeSection as Section:'overview')},[routeSection])
  const setSection=(value:Section)=>{setSectionState(value);navigate(`/settings/${value}`)}
  const [loginProvider,setLoginProvider]=useState<{id:string;name:string}|null>(null)
  const loginSuccess=useCallback(()=>{void query.invalidateQueries({queryKey:['ax-local']})},[query])
  const [providerId,setProviderId]=useState('deepseek'),[apiKey,setApiKey]=useState('')
  const [xfyAppidDraft,setXfyAppidDraft]=useState(xfyAppid),[xfyApiKeyDraft,setXfyApiKeyDraft]=useState(xfyApiKey),[xfyApiSecretDraft,setXfyApiSecretDraft]=useState(xfyApiSecret)
  const [notice,setNoticeState]=useState(''),[noticeError,setNoticeError]=useState(false),[busy,setBusy]=useState(false)
  const noticeSection=useRef(section)
  noticeSection.current=section
  const setNotice=(value:string,error=false)=>{if(noticeSection.current!==section)return;setNoticeState(value);setNoticeError(error)}
  useEffect(()=>{setNoticeState('');setNoticeError(false)},[section])
  useEffect(()=>{if(!notice||noticeError)return;const timer=setTimeout(()=>setNoticeState(''),4000);return()=>clearTimeout(timer)},[notice,noticeError])
  const [importPath,setImportPath]=useState(''),[preview,setPreview]=useState('')
  const [exportScope,setExportScope]=useState<'all'|'memory'|'sessions'>('all')
  const workspaceCandidate=selectedCwd??settings.data?.default_cwd
  const needsWorkspace=['capabilities','backup','ax'].includes(section)
  const {workspace,error:workspaceError,checking:checkingWorkspace}=useSettingsWorkspace(workspaceCandidate,needsWorkspace)
  const chooseWorkspace=async()=>{
    try {
      const path=await resolveSendWorkspace()
      if(path){
        useSessionUi.getState().setSelectedCwd(path)
        void query.invalidateQueries({queryKey:['settings-workspace',path],exact:true})
      }
    }catch(error){setNotice(String(error),true)}
  }
  const sourceLabel=(source:string|null|undefined)=>['environment','环境变量'].includes(source??'')?translate('models.environment'):source?readableSettingsPath(source):''
  const chosenProvider=ax.data?.providers.find(provider=>provider.id===providerId)
  useEffect(()=>{const providers=ax.data?.providers;if(providers?.length&&!providers.some(provider=>provider.id===providerId))setProviderId(providers[0].id)},[ax.data?.providers,providerId])
  const configured=ax.data?.providers.filter(provider=>provider.configured)??[]
  const models=configured.filter(provider=>provider.supported).flatMap(provider=>provider.models)
  const current=ax.data?.selected_model
  const updateAx=async(run:()=>Promise<unknown>,message:(result:unknown)=>string=()=>translate("copy.10"))=>{setBusy(true);setNotice('');try{const result=await run();await query.invalidateQueries({queryKey:['ax-local']});setNotice(message(result))}catch(error){setNotice(String(error),true)}finally{setBusy(false)}}
  // 保存密钥后 AX 会立刻做一次模型发现；把结果说出来，否则模型列表为空时看不出原因。
  const discoveryNotice=(result:unknown)=>{const d=(result as AxLocalState|undefined)?.discovery;if(!d)return translate("copy.10");return d.warning?translate("copy.11", {v0:d.warning}):translate("copy.12", {v0:d.models})}
  const saveKey=()=>void updateAx(async()=>{const saved=await axStoreApiKey(providerId,apiKey);setApiKey('');return saved},discoveryNotice)
  const refreshModels=(provider?:string)=>void updateAx(()=>axRefreshModels(provider),result=>{const d=(result as AxLocalState).discovery;return d?.warning?translate("copy.13", {v0:d.warning}):translate("copy.14", {v0:d?.models??0})})
  const removeKey=(id=providerId)=>void updateAx(()=>axRemoveCredential(id),()=>useLang.getState().lang==='zh'?'提供商已移除。':'Provider removed.')
  const selectModel=(value:string)=>{const [provider,id]=value.split('::');if(provider&&id)void updateAx(()=>axSelectModel(provider,id))}
  const saveXfy=async()=>{if(!xfyAppidDraft.trim()||!xfyApiKeyDraft.trim()||!xfyApiSecretDraft.trim()){setNotice(translate("copy.15"));return}setBusy(true);setNotice('');try{const saved=await endpoints.setXfy({appid:xfyAppidDraft.trim(),api_key:xfyApiKeyDraft.trim(),api_secret:xfyApiSecretDraft.trim()});setXfy(xfyAppidDraft.trim(),xfyApiKeyDraft.trim(),xfyApiSecretDraft.trim());setNotice(saved.configured?translate("copy.16"):translate("copy.17"))}catch(error){setXfy(xfyAppidDraft.trim(),xfyApiKeyDraft.trim(),xfyApiSecretDraft.trim());setNotice(translate("copy.18", {v0:String(error)}))}finally{setBusy(false)}}
  const openAxTui=(command:'/login'|'/model')=>{
    if(!ax.data?.active_path||!workspace){setNotice(translate("copy.19"));return}
    if(useTerminalDock.getState().tabs.length>=8){setNotice(translate("copy.20"));return}
    useTerminalDock.getState().addTab(workspace,axTuiCommand(ax.data.active_path, ax.data.terminal_shell))
    setNotice(translate("copy.21", {v0:command}))
  }
  const authKind = chosenProvider?.auth_kind || (['openai-codex','workbuddy','workbuddy-cn'].includes(providerId)?'oauth':'api_key')
  const openAxLogin=()=>setLoginProvider({id:providerId,name:providerId==='workbuddy'?translate('models.workbuddyIntl'):providerId==='workbuddy-cn'?translate('models.workbuddyCn'):chosenProvider?.name??providerId})
  const exportData=async()=>{
    if(!workspace){setNotice(translate("copy.23"));return}
    const path=await save({defaultPath:'ax-backup.axpack',filters:[{name:translate("copy.24"),extensions:['axpack']}]})
    if(!path)return
    setBusy(true);setNotice('')
    try{const result=await axExport(workspace,path,exportScope);setNotice(translate("copy.25", {v0:readableSettingsPath(path),v1:result?`\n${result}`:''}))}catch(error){setNotice(String(error))}finally{setBusy(false)}
  }
  const previewImport=async()=>{
    if(!workspace){setNotice(translate("copy.23"));return}
    const path=await open({multiple:false,directory:false,filters:[{name:translate("copy.24"),extensions:['axpack']}]})
    if(typeof path!=='string')return
    setBusy(true);setNotice('');setPreview('');setImportPath('')
    try{setPreview(await axImport(workspace,path,true));setImportPath(path)}catch(error){setNotice(String(error))}finally{setBusy(false)}
  }
  const confirmImport=async()=>{
    if(!workspace||!importPath)return
    setBusy(true);setNotice('')
    try{const result=await axImport(workspace,importPath,false);setNotice(translate("copy.26", {v0:result?`\n${result}`:''}));setImportPath('');setPreview('')}
    catch(error){setNotice(String(error))}finally{setBusy(false)}
  }

  return <div className="settings-workspace">
    <aside className="settings-sidebar" aria-label={translate("copy.27")}><h1>{translate("copy.28")}</h1><nav>{sections.filter(item=>item.label.toLowerCase().includes(search.toLowerCase())).map((item,index,list)=>{const Icon=item.icon;return <div key={item.id}>{item.group&&list.findIndex(other=>other.group===item.group)===index&&<span className="settings-nav-heading">{item.group}</span>}<button className={section===item.id?'is-active':''} onClick={()=>setSection(item.id)}><Icon size={18}/>{item.label}</button></div>})}</nav></aside>
    <div className="settings-main"><div className="settings-page-top"><div><h1>{sections.find(item=>item.id===section)?.label}</h1><p>{section==='overview'?translate("copy.29"):section==='models'?translate("copy.30"):section==='speech'?translate("copy.31"):section==='capabilities'?translate("copy.32"):translate("copy.33")}</p></div><label className="settings-search"><Search size={17}/><input aria-label={translate("copy.34")} placeholder={translate("copy.35")} value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
      {needsWorkspace&&checkingWorkspace&&<p role="status">{useLang.getState().lang==='zh'?'正在检查工作目录…':'Checking workspace…'}</p>}
      {needsWorkspace&&workspaceError&&<section className="settings-card" role="alert"><p>{String(workspaceError)}</p>{workspaceCandidate&&<SettingsLocation path={workspaceCandidate}/>}<button type="button" className="settings-secondary" onClick={()=>void chooseWorkspace()}><Folder size={15}/>{useLang.getState().lang==='zh'?'选择工作目录':'Choose workspace'}</button></section>}
      {section==='overview'&&<><div className="settings-health"><span className={status==='Connected'?'is-online':''}/><strong>{status==='Connected'?translate("copy.36"):translate("copy.37")}</strong><small>{health.data?.version&&`v${health.data.version}`}</small></div><div className="settings-metrics"><Metric label={translate("copy.38")} value={sessions.data?.length??0}/><Metric label={translate("copy.39")} value={tasks.data?.length??0}/><Metric label={translate("copy.40")} value={configured.length}/><Metric label={translate("copy.41")} value={current?.id??'auto'}/></div><div className="settings-overview-grid"><Panel title={translate("copy.1")}><p>{axAvailable?ax.data?.active_path?<SettingsLocation path={ax.data.active_path} kind="file"/>:translate("copy.42"):translate("copy.43")}</p><button onClick={()=>setSection('ax')}>{translate("copy.44")}<ArrowRight size={15}/></button></Panel><Panel title={translate("copy.3")}><p>{current?`${current.provider} · ${current.id}`:translate("copy.45")}</p><button onClick={()=>setSection('models')}>{translate("copy.46")}<ArrowRight size={15}/></button></Panel><Panel title={translate("copy.47")}><p>{translate("copy.48")}</p><button onClick={()=>setSection('backup')}>{translate("copy.5")}<ArrowRight size={15}/></button></Panel></div></>}
      {section==='ax'&&<div className="settings-stack"><ExecutionSettings value={ax.data} disabled={!axAvailable||busy} onChange={(environment,shell)=>void updateAx(()=>axSelectExecution(environment,shell))}/><Panel title={translate("copy.49")}><div className="settings-field-row"><span>{translate("copy.50")}</span><strong>{ax.data?.installed_path?<SettingsLocation path={ax.data.installed_path} kind="file"/>:translate("copy.51")}</strong></div><div className="settings-field-row"><span>{translate("copy.52")}</span><strong>{ax.data?.installed_version??'—'}</strong></div><div className="settings-field-row"><span>{translate("copy.53")}</span><strong>{ax.data?.installed_path?(ax.data.installed_compatible?translate("copy.54"):translate("copy.55")):'—'}</strong></div><button className="settings-secondary" disabled={!axAvailable||ax.isFetching} onClick={()=>void ax.refetch()}><RefreshCw size={15}/> {translate("copy.56")}</button></Panel><Panel title={translate("copy.57")}><div className="settings-field-row"><span>{translate("copy.58")}</span><strong>{ax.data?.active_version?<SettingsLocation path={ax.data.active_path} kind="file"/>:translate("copy.59")}</strong></div><div className="settings-field-row"><span>{translate("copy.60")}</span><strong>{ax.data?.active_version??'—'}</strong></div><div className="settings-field-row"><span>{translate("copy.61")}</span><strong>{workspace?<SettingsLocation path={workspace}/>: '—'}</strong></div><button className="settings-secondary" onClick={()=>navigate('/sessions')}><Folder size={15}/> {translate("copy.62")}</button></Panel><AxUpdater/></div>}
      {section==='models'&&<div className="settings-stack"><Panel title={translate("copy.63")}><p>{translate("copy.64")}</p><p>{translate("copy.65")}</p><SettingsSelect label={translate("copy.63")} value={current?`${current.provider}::${current.id}`:''} disabled={!models.length||busy} onChange={selectModel} options={[{value:'',label:models.length?translate("copy.66"):translate("copy.67")},...models.map(model=>({value:`${model.provider}::${model.id}`,label:`${model.display_name} · ${model.provider}`}))]}/></Panel><Panel title={translate("copy.68")}><p>{authKind==='oauth'?translate("login.instructions"):translate("copy.69")}</p><p>{translate("copy.70")}</p><div className="settings-login-row"><SettingsSelect label={translate("copy.71")} value={ax.data?.providers.length?providerId:''} disabled={!ax.data?.providers.length||busy} onChange={value=>{setProviderId(value);setApiKey('');setNotice('')}} options={ax.data?.providers.length?ax.data.providers.map(provider=>({value:provider.id,group:translate('models.auth.'+(provider.auth_kind||(['openai-codex','workbuddy','workbuddy-cn'].includes(provider.id)?'oauth':'api_key'))),label:(provider.id==='workbuddy'?translate('models.workbuddyIntl'):provider.id==='workbuddy-cn'?translate('models.workbuddyCn'):provider.name)+(provider.supported===false?translate('copy.72'):provider.configured?translate('copy.73'):'')})):[{value:'',label:translate(ax.isLoading?'models.loadingProviders':'models.noProviders')}]}/></div>{authKind==='oauth'?<div className="settings-actions"><button className="settings-primary" disabled={!axAvailable||chosenProvider?.supported===false} onClick={openAxLogin}><Bot size={16}/> {translate("login.title")}</button><span>{translate("login.instructions")}</span></div>:authKind==='ambient'?<p>{translate("copy.76")}</p>:<div className="settings-login-row"><input aria-label="API Key" type="password" autoComplete="off" placeholder={translate("copy.77", {v0:chosenProvider?.name??translate('copy.provider')})} value={apiKey} onChange={event=>setApiKey(event.target.value)}/><button className="settings-primary" disabled={!axAvailable||!apiKey.trim()||busy||chosenProvider?.supported===false} onClick={saveKey}><Check size={16}/> {translate("copy.78")}</button></div>}{chosenProvider?.supported===false?<div className="settings-provider-status is-warning"><ShieldCheck size={16}/> {translate("copy.79")}{chosenProvider.unsupported_reason}<button disabled={!axAvailable||busy} onClick={()=>removeKey()}>{translate("copy.80")}</button></div>:chosenProvider?.configured&&<div className="settings-provider-status"><ShieldCheck size={16}/> {translate("copy.81")}{sourceLabel(chosenProvider.source)}{translate("copy.82")}<button disabled={!axAvailable||busy} onClick={()=>removeKey()}>{translate("copy.80")}</button></div>}</Panel><Panel title={translate("copy.83")}><div className="settings-provider-list">{configured.length?configured.map(provider=><div key={provider.id}><strong>{provider.name}</strong><span>{provider.supported===false?translate("copy.84", {v0:provider.unsupported_reason}):translate("copy.85", {v0:sourceLabel(provider.source),v1:provider.models.length,v2:provider.model_source==='fallback'?translate('copy.builtin'):translate('copy.cached')})}</span><button disabled={busy||!provider.supported} onClick={()=>refreshModels(provider.id)}><RefreshCw size={14}/> {translate("copy.86")}</button><button disabled={!axAvailable||busy} onClick={()=>removeKey(provider.id)}>{translate('settings.removeProvider')}</button></div>):<p>{translate("copy.87")}</p>}</div></Panel></div>}
      {section==='backup'&&<div className="settings-stack"><CapabilityImports workspace={workspace}/><Panel title={translate("copy.88")}><p>{translate("copy.89")}</p><div className="settings-location-row">{workspace?<SettingsLocation path={workspace}/>:<span>{translate("copy.90")}</span>}<button className="settings-secondary" onClick={()=>navigate('/sessions')}><Folder size={15}/> {translate("copy.91")}</button></div></Panel><Panel title={translate("copy.92")}><p>{translate("copy.93")}</p><div className="settings-actions"><SettingsSelect label={translate("copy.94")} value={exportScope} onChange={value=>setExportScope(value as typeof exportScope)} options={[{value:'all',label:translate("copy.95")},{value:'memory',label:translate("copy.96")},{value:'sessions',label:translate("copy.97")}]}/><button className="settings-primary" disabled={!axAvailable||!workspace||busy} onClick={()=>void exportData()}><Download size={16}/> {translate("copy.98")}</button></div></Panel><Panel title={translate("copy.99")}><p>{translate("copy.100")}</p><button className="settings-secondary" disabled={!axAvailable||!workspace||busy} onClick={()=>void previewImport()}><Upload size={16}/> {translate("copy.101")}</button>{preview&&<><Report value={preview}/><button className="settings-primary" disabled={busy} onClick={()=>void confirmImport()}>{translate("copy.102")}</button></>}</Panel></div>}
      {section==='appearance'&&<div className="settings-stack"><Panel title={translate('settings.language')}><Menu trigger={<button type="button" className="settings-select-menu" aria-label={translate('settings.language')}><span>{useLang.getState().lang==='zh'?'简体中文':'English'}</span><ChevronDown size={15}/></button>} items={[{label:'English',action:()=>useLang.getState().setLang('en')},{label:'简体中文',action:()=>useLang.getState().setLang('zh')}]}/></Panel><Panel title={translate("copy.103")}><label className="settings-field"><span>{translate("copy.104")}</span><Menu trigger={<button type="button" className="settings-select-menu" aria-label={translate("copy.104")}><span>{theme==='dark'?translate("copy.105"):theme==='light'?translate("copy.106"):translate("copy.107")}</span><ChevronDown size={15}/></button>} items={[{label:translate("copy.105"),action:()=>setTheme('dark')},{label:translate("copy.106"),action:()=>setTheme('light')},{label:translate("copy.107"),action:()=>setTheme('system')}]}/></label><SettingsToggle label={translate("copy.108")} description={translate("copy.109")} checked={developer} onChange={event=>setDeveloper(event.target.checked)}/></Panel></div>}
      {section==='speech'&&<div className="settings-stack"><Panel title={translate("copy.110")}><p>{translate("copy.111")}</p><div className="settings-field"><span>APPID</span><input aria-label="APPID" value={xfyAppidDraft} onChange={event=>setXfyAppidDraft(event.target.value)} placeholder={translate("copy.112")}/></div><div className="settings-field"><span>APIKey</span><SecretInput aria-label="APIKey" autoComplete="off" value={xfyApiKeyDraft} onChange={event=>setXfyApiKeyDraft(event.target.value)} placeholder={translate("copy.113")}/></div><div className="settings-field"><span>APISecret</span><SecretInput aria-label="APISecret" autoComplete="off" value={xfyApiSecretDraft} onChange={event=>setXfyApiSecretDraft(event.target.value)} placeholder={translate("copy.113")}/></div><div className="settings-actions"><button className="settings-primary" disabled={busy} onClick={saveXfy}><Check size={16}/> {translate("copy.114")}</button>{xfyAppid&&<span className="settings-provider-status"><ShieldCheck size={16}/> {translate("copy.115")}{xfyAppid}）</span>}</div></Panel></div>}
      {section==='system'&&<div className="settings-stack">
        <Panel title={translate("copy.119")}>
          <div className="settings-field-row"><span>{translate("copy.120")}</span><strong>{health.data?.status??translate("copy.121")} · v{health.data?.version??'—'}</strong></div>
          <div className="settings-field-row"><span>{translate("copy.122")}</span><strong>{translate('status.'+status)}</strong></div>
          <div className="settings-field-row"><span>{translate("copy.123")}</span><strong>{settings.data?.protocol_version??'—'}</strong></div>
        </Panel>

        <SystemMetrics/>

        <DesktopBehavior/>

        <CrewUpdater/>
      </div>}
      {section==='models'&&<div className="settings-model-tools"><button disabled={!axAvailable} onClick={()=>openAxTui('/model')}>{translate("copy.126")}</button><button disabled={!axAvailable||busy} onClick={()=>refreshModels()}><RefreshCw size={15}/> {translate("copy.127")}</button></div>}
      {section==='usage'&&<Usage/>}
      {section==='personalization'&&<Personalization/>}
      {section==='capabilities'&&<AxCapabilities workspace={workspace} home={ax.data?.home}/>}
      {section==='desktop'&&<AxDesktopControl/>}
      {section==='browser'&&<AxBrowserControl/>}
      {(section==='ax'||section==='models')&&ax.data?.runtime_warning&&<div className="settings-notice is-error" role="alert">{ax.data.runtime_warning}</div>}
      {ax.error&&section!=='appearance'&&<div className="settings-notice is-error" role="alert">{translate("copy.128")}{String(ax.error)}</div>}
      {loginProvider&&<ProviderLogin provider={loginProvider.id} name={loginProvider.name} onClose={()=>{setLoginProvider(null);void query.invalidateQueries({queryKey:['ax-local']})}} onSuccess={loginSuccess}/>}
      {notice&&<div className={`settings-notice${noticeError?' is-error':''}`} role={noticeError?'alert':'status'}>{notice}</div>}
    </div>
  </div>
}

function SecretInput(props: React.ComponentProps<'input'>) {
  useLang(state=>state.lang);

  const [visible,setVisible] = useState(false)
  return <div className="settings-secret"><input {...props} type={visible?'text':'password'}/><button type="button" aria-label={visible?translate("copy.129"):translate("copy.130")} aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></div>
}
