import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { open, save } from '@tauri-apps/plugin-dialog'
import { Activity, Archive, ArrowRight, Bot, Check, Download, Folder, Mic, Monitor, Palette, RefreshCw, Search, ShieldCheck, Smartphone, Upload } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { endpoints } from '../lib/api'
import { axAvailable, axExport, axImport, axLocalState, axRemoveCredential, axSelectModel, axStoreApiKey } from '../lib/ax'
import { useSessions, useTasks } from '../lib/query'
import { useLive } from '../lib/live'
import { useUi, type Theme } from '../store/ui'
import { useSessionUi } from '../store/sessions'
import { useTerminalDock } from '../store/terminal'
import './settings.css'
import { AndroidConnection } from '../components/AndroidConnection'

type Section = 'overview' | 'ax' | 'models' | 'backup' | 'appearance' | 'speech' | 'connections'
const sections: {id:Section;label:string;group:string;icon:typeof Activity}[] = [
  {id:'overview',label:'概览',group:'',icon:Activity}, {id:'ax',label:'本地 AX',group:'',icon:Monitor},
  {id:'models',label:'模型与登录',group:'偏好设置',icon:Bot}, {id:'backup',label:'导入 / 导出',group:'偏好设置',icon:Archive},
  {id:'appearance',label:'显示',group:'偏好设置',icon:Palette}, {id:'speech',label:'语音识别',group:'偏好设置',icon:Mic}, {id:'connections',label:'连接与系统',group:'系统',icon:Smartphone},
]
function Panel({title,children}:{title:string;children:ReactNode}){return <section className="settings-card"><h2>{title}</h2>{children}</section>}
function Metric({label,value}:{label:string;value:string|number}){return <div className="settings-metric"><span>{label}</span><strong>{value}</strong></div>}
function Report({value}:{value:string}){let rendered=value;try{rendered=JSON.stringify(JSON.parse(value),null,2)}catch{/* AX may return plain text */}return <pre className="settings-report">{rendered}</pre>}

export function Settings(){
  const navigate=useNavigate(),query=useQueryClient(),status=useLive(state=>state.status)
  const settings=useQuery({queryKey:['settings'],queryFn:endpoints.settings})
  const health=useQuery({queryKey:['health'],queryFn:endpoints.health})
  const sessions=useSessions(),tasks=useTasks()
  const ax=useQuery({queryKey:['ax-local'],queryFn:axLocalState,enabled:axAvailable,retry:false})
  const {theme,setTheme,developer,setDeveloper,gatewayUrl,setGatewayUrl,xfyAppid,xfyApiKey,xfyApiSecret,setXfy}=useUi()
  const selectedCwd=useSessionUi(state=>state.selectedCwd)
  const [section,setSection]=useState<Section>('overview'),[search,setSearch]=useState('')
  const [providerId,setProviderId]=useState('deepseek'),[apiKey,setApiKey]=useState('')
  const [xfyAppidDraft,setXfyAppidDraft]=useState(xfyAppid),[xfyApiKeyDraft,setXfyApiKeyDraft]=useState(xfyApiKey),[xfyApiSecretDraft,setXfyApiSecretDraft]=useState(xfyApiSecret)
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const [importPath,setImportPath]=useState(''),[preview,setPreview]=useState('')
  const [exportScope,setExportScope]=useState<'all'|'memory'|'sessions'>('all')
  const workspace=selectedCwd??settings.data?.default_cwd
  const chosenProvider=ax.data?.providers.find(provider=>provider.id===providerId)
  const configured=ax.data?.providers.filter(provider=>provider.configured)??[]
  const models=configured.flatMap(provider=>provider.models)
  const current=ax.data?.selected_model
  const updateAx=async(run:()=>Promise<unknown>)=>{setBusy(true);setNotice('');try{await run();await query.invalidateQueries({queryKey:['ax-local']});setNotice('已保存到本地 AX。')}catch(error){setNotice(String(error))}finally{setBusy(false)}}
  const saveKey=()=>void updateAx(async()=>{await axStoreApiKey(providerId,apiKey);setApiKey('')})
  const removeKey=()=>void updateAx(()=>axRemoveCredential(providerId))
  const selectModel=(value:string)=>{const [provider,id]=value.split('::');if(provider&&id)void updateAx(()=>axSelectModel(provider,id))}
  const saveXfy=async()=>{if(!xfyAppidDraft.trim()||!xfyApiKeyDraft.trim()||!xfyApiSecretDraft.trim()){setNotice('请填写完整的 APPID / APIKey / APISecret。');return}setBusy(true);setNotice('');try{const saved=await endpoints.setXfy({appid:xfyAppidDraft.trim(),api_key:xfyApiKeyDraft.trim(),api_secret:xfyApiSecretDraft.trim()});setXfy(xfyAppidDraft.trim(),xfyApiKeyDraft.trim(),xfyApiSecretDraft.trim());setNotice(saved.configured?'已保存，手机端将使用讯飞识别。':'已保存到本机（网关未确认）。')}catch(error){setXfy(xfyAppidDraft.trim(),xfyApiKeyDraft.trim(),xfyApiSecretDraft.trim());setNotice(`本地已保存；网关暂不可用（${String(error)}），连接后请重新保存以同步到手机。`)}finally{setBusy(false)}}
  const openAxTui=(command:'/login'|'/model')=>{
    if(!ax.data?.active_path||!workspace){setNotice('AX 或工作目录尚未就绪。');return}
    if(useTerminalDock.getState().tabs.length>=8){setNotice('请先关闭一个终端标签。');return}
    useTerminalDock.getState().addTab(workspace,`& '${ax.data.active_path.replaceAll("'","''")}' tui`)
    setNotice(`已打开 AX 终端。输入 ${command}，完成后返回设置刷新状态。`)
  }
  const openAxLogin=()=>openAxTui('/login')
  const exportData=async()=>{
    if(!workspace){setNotice('请先选择工作目录。');return}
    const path=await save({defaultPath:'ax-backup.axpack',filters:[{name:'AX 备份',extensions:['axpack']}]})
    if(!path)return
    setBusy(true);setNotice('')
    try{const result=await axExport(workspace,path,exportScope);setNotice(`已导出到 ${path}${result?`\n${result}`:''}`)}catch(error){setNotice(String(error))}finally{setBusy(false)}
  }
  const previewImport=async()=>{
    if(!workspace){setNotice('请先选择工作目录。');return}
    const path=await open({multiple:false,directory:false,filters:[{name:'AX 备份',extensions:['axpack']}]})
    if(typeof path!=='string')return
    setBusy(true);setNotice('');setPreview('');setImportPath('')
    try{setPreview(await axImport(workspace,path,true));setImportPath(path)}catch(error){setNotice(String(error))}finally{setBusy(false)}
  }
  const confirmImport=async()=>{
    if(!workspace||!importPath)return
    setBusy(true);setNotice('')
    try{const result=await axImport(workspace,importPath,false);setNotice(`导入完成。${result?`\n${result}`:''}`);setImportPath('');setPreview('')}
    catch(error){setNotice(String(error))}finally{setBusy(false)}
  }

  return <div className="settings-workspace">
    <aside className="settings-sidebar" aria-label="设置分类"><h1>设置</h1><nav>{sections.filter(item=>item.label.includes(search)).map((item,index,list)=>{const Icon=item.icon;return <div key={item.id}>{item.group&&list.findIndex(other=>other.group===item.group)===index&&<span className="settings-nav-heading">{item.group}</span>}<button className={section===item.id?'is-active':''} onClick={()=>setSection(item.id)}><Icon size={18}/>{item.label}</button></div>})}</nav></aside>
    <div className="settings-main"><div className="settings-page-top"><div><h1>{sections.find(item=>item.id===section)?.label}</h1><p>{section==='overview'?'系统状态、会话与本地 AX 一览':section==='models'?'使用 AX 已登录的提供商与模型':section==='speech'?'配置讯飞实时语音听写，用于手机语音输入':'AX Crew 与本地 AX 设置'}</p></div><label className="settings-search"><Search size={17}/><input aria-label="搜索设置" placeholder="搜索设置…" value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
      {section==='overview'&&<><div className="settings-health"><span className={status==='Connected'?'is-online':''}/><strong>{status==='Connected'?'本地服务运行中':'正在连接本地服务'}</strong><small>{health.data?.version&&`v${health.data.version}`}</small></div><div className="settings-metrics"><Metric label="会话" value={sessions.data?.length??0}/><Metric label="任务" value={tasks.data?.length??0}/><Metric label="已登录提供商" value={configured.length}/><Metric label="AX 模型" value={current?.id??'auto'}/></div><div className="settings-overview-grid"><Panel title="本地 AX"><p>{axAvailable?ax.data?.active_path??'正在检测…':'仅桌面应用可检测 AX'}</p><button onClick={()=>setSection('ax')}>查看详情 <ArrowRight size={15}/></button></Panel><Panel title="模型与登录"><p>{current?`${current.provider} · ${current.id}`:'使用 AX 的自动模型选择'}</p><button onClick={()=>setSection('models')}>管理模型 <ArrowRight size={15}/></button></Panel><Panel title="记忆与会话备份"><p>使用 AX 的 .axpack 格式导入或导出工作目录中的记忆和会话。</p><button onClick={()=>setSection('backup')}>导入 / 导出 <ArrowRight size={15}/></button></Panel></div></>}
      {section==='ax'&&<div className="settings-stack"><Panel title="安装检测"><div className="settings-field-row"><span>系统中安装的 AX</span><strong>{ax.data?.installed_path??'未在 PATH 中找到'}</strong></div><div className="settings-field-row"><span>安装版本</span><strong>{ax.data?.installed_version??'—'}</strong></div><div className="settings-field-row"><span>Crew 协议</span><strong>{ax.data?.installed_path?(ax.data.installed_compatible?'可直接使用':'当前安装不支持 ACP，已使用兼容版本'):'—'}</strong></div><button className="settings-secondary" disabled={!axAvailable||ax.isFetching} onClick={()=>void ax.refetch()}><RefreshCw size={15}/> 重新检测</button></Panel><Panel title="当前运行环境"><div className="settings-field-row"><span>AX 可执行文件</span><strong>{ax.data?.active_path??'—'}</strong></div><div className="settings-field-row"><span>版本</span><strong>{ax.data?.active_version??'—'}</strong></div><div className="settings-field-row"><span>默认工作目录</span><strong>{workspace??'—'}</strong></div><button className="settings-secondary" onClick={()=>navigate('/sessions')}><Folder size={15}/> 前往会话选择目录</button></Panel></div>}
      {section==='models'&&<div className="settings-stack"><Panel title="AX 默认模型"><p>会话中的 auto 使用 AX 已保存的默认模型。选择模型会更新 AX 的本地配置。</p><select aria-label="AX 默认模型" value={current?`${current.provider}::${current.id}`:''} disabled={!models.length||busy} onChange={event=>selectModel(event.target.value)}><option value="">{models.length?'选择已登录的模型':'尚无可选模型'}</option>{models.map(model=><option key={`${model.provider}::${model.id}`} value={`${model.provider}::${model.id}`}>{model.display_name} · {model.provider}</option>)}</select></Panel><Panel title="连接模型提供商"><p>API Key 保存到 AX 自己的凭据文件；界面不读取或显示密钥内容。</p><div className="settings-login-row"><select aria-label="模型提供商" value={providerId} onChange={event=>{setProviderId(event.target.value);setApiKey('')}}>{ax.data?.providers.map(provider=><option key={provider.id} value={provider.id}>{provider.name}{provider.configured?' · 已连接':''}</option>)??<option value="deepseek">DeepSeek</option>}</select></div>{providerId==='openai-codex'?<div className="settings-actions"><button className="settings-primary" disabled={!axAvailable} onClick={openAxLogin}><Bot size={16}/> 打开 AX 登录终端</button><span>在终端输入 /login，使用 AX 的 OAuth 登录流程。</span></div>:<div className="settings-login-row"><input aria-label="API Key" type="password" autoComplete="off" placeholder={`${chosenProvider?.name??'提供商'} API Key`} value={apiKey} onChange={event=>setApiKey(event.target.value)}/><button className="settings-primary" disabled={!axAvailable||!apiKey.trim()||busy} onClick={saveKey}><Check size={16}/> 保存密钥</button></div>}{chosenProvider?.configured&&<div className="settings-provider-status"><ShieldCheck size={16}/> 已通过{chosenProvider.source}连接 <button disabled={busy||chosenProvider.source!=='AX'} onClick={removeKey}>移除 AX 凭据</button></div>}</Panel><Panel title="已连接的提供商"><div className="settings-provider-list">{configured.length?configured.map(provider=><div key={provider.id}><strong>{provider.name}</strong><span>{provider.source} · {provider.models.length} 个已缓存模型</span></div>):<p>尚未检测到 AX 的登录凭据。可以保存 API Key，或在 AX 登录终端中连接 OAuth 模型。</p>}</div></Panel></div>}
      {section==='backup'&&<div className="settings-stack"><Panel title="工作目录"><p>AX 的项目记忆与会话按工作目录保存；当前操作目标：</p><strong className="settings-workspace-path">{workspace??'未选择'}</strong><button className="settings-secondary" onClick={()=>navigate('/sessions')}><Folder size={15}/> 在会话中选择工作目录</button></Panel><Panel title="导出 AX 数据"><p>创建新的 .axpack 文件。AX 不会覆盖已有备份。</p><div className="settings-actions"><select aria-label="导出内容" value={exportScope} onChange={event=>setExportScope(event.target.value as typeof exportScope)}><option value="all">记忆与会话</option><option value="memory">仅记忆</option><option value="sessions">仅会话</option></select><button className="settings-primary" disabled={!axAvailable||!workspace||busy} onClick={()=>void exportData()}><Download size={16}/> 导出</button></div></Panel><Panel title="导入 AX 数据"><p>先让 AX 检查存档并显示合并计划，再确认导入。</p><button className="settings-secondary" disabled={!axAvailable||!workspace||busy} onClick={()=>void previewImport()}><Upload size={16}/> 选择 .axpack 并预览</button>{preview&&<><Report value={preview}/><button className="settings-primary" disabled={busy} onClick={()=>void confirmImport()}>确认导入到当前工作目录</button></>}</Panel></div>}
      {section==='appearance'&&<div className="settings-stack"><Panel title="外观"><label className="settings-field"><span>主题</span><select aria-label="主题" value={theme} onChange={event=>setTheme(event.target.value as Theme)}><option value="dark">深色</option><option value="light">浅色</option><option value="system">跟随系统</option></select></label><label className="settings-checkbox"><input type="checkbox" checked={developer} onChange={event=>setDeveloper(event.target.checked)}/> 开发者模式 <small>在动态页面显示原始 CrewEvent</small></label></Panel></div>}
      {section==='speech'&&<div className="settings-stack"><Panel title="讯飞语音识别"><p>手机端「按住说话」将使用讯飞实时语音听写 API 识别，密钥保存在本机，不会发送给第三方。在讯飞开放平台（www.xfyun.cn）创建应用后，在「语音听写（流式版）」服务中获取以下三项。</p><div className="settings-field"><span>APPID</span><input aria-label="APPID" value={xfyAppidDraft} onChange={event=>setXfyAppidDraft(event.target.value)} placeholder="在讯飞控制台「我的应用」中查看"/></div><div className="settings-field"><span>APIKey</span><input aria-label="APIKey" type="password" autoComplete="off" value={xfyApiKeyDraft} onChange={event=>setXfyApiKeyDraft(event.target.value)} placeholder="讯飞「语音听写」服务密钥"/></div><div className="settings-field"><span>APISecret</span><input aria-label="APISecret" type="password" autoComplete="off" value={xfyApiSecretDraft} onChange={event=>setXfyApiSecretDraft(event.target.value)} placeholder="讯飞「语音听写」服务密钥"/></div><div className="settings-actions"><button className="settings-primary" disabled={busy} onClick={saveXfy}><Check size={16}/> 保存密钥</button>{xfyAppid&&<span className="settings-provider-status"><ShieldCheck size={16}/> 已保存（{xfyAppid}）</span>}</div></Panel></div>}
      {section==='connections'&&<div className="settings-stack"><Panel title="本地服务"><div className="settings-field-row"><span>后端</span><strong>{health.data?.status??'未连接'} · v{health.data?.version??'—'}</strong></div><div className="settings-field-row"><span>事件流</span><strong>{status}</strong></div><div className="settings-field-row"><span>协议版本</span><strong>{settings.data?.protocol_version??'—'}</strong></div></Panel><Panel title="配对远程 AX 设备"><label className="settings-field"><span>公共网关 URL</span><input value={gatewayUrl} onChange={event=>setGatewayUrl(event.target.value)} placeholder="https://crew.example.com"/></label><p>此地址仅用于生成把另一台 AX 电脑加入 Crew 的配对命令，与手机连接无关。</p></Panel><Panel title="桌面行为"><p>关闭窗口会隐藏到系统托盘；本地服务继续运行。可从托盘重新打开或退出。</p></Panel></div>}
      {section==='models'&&<div className="settings-model-tools"><button disabled={!axAvailable} onClick={()=>openAxTui('/model')}>在 AX 中发现更多模型</button><button disabled={!axAvailable||ax.isFetching} onClick={()=>void ax.refetch()}><RefreshCw size={15}/> 刷新模型列表</button></div>}
      {section==='connections'&&<AndroidConnection/>}
      {ax.error&&section!=='appearance'&&<div className="settings-notice is-error" role="alert">AX 状态读取失败：{String(ax.error)}</div>}
      {notice&&<div className="settings-notice" role="status">{notice}</div>}
    </div>
  </div>
}
