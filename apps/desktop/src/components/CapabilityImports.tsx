import { useEffect, useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Download, Laptop, RefreshCw } from 'lucide-react'
import { open } from '@tauri-apps/plugin-dialog'
import { axImportCapability, axAvailable, axScanCapabilitySources } from '../lib/ax'
import { translate, useLang } from '../lib/i18n'
import { SettingsLocation } from './ui/settings-location'

export function CapabilityImports({workspace}:{workspace?:string}) {
  const query=useQueryClient(),lang=useLang(state=>state.lang)
  const copy=(zh:string,en:string)=>lang==='zh'?zh:en
  const [global,setGlobal]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
  const sources = useQuery({ queryKey: ['ax-import-sources', workspace ?? ''], queryFn: () => axScanCapabilitySources(workspace), enabled: axAvailable, retry: false, refetchOnWindowFocus: false })
  const [selected,setSelected] = useState<string[]>([])
  const [expanded,setExpanded] = useState<string[]>([])
  const importId = useId()
  useEffect(()=>{setSelected([]);setExpanded([]);setNotice('')},[workspace])
  const candidates = sources.data?.flatMap(source=>source.items) ?? []
  const chosen = candidates.filter(item=>selected.includes(item.path))
  const importSelected = async () => {
    if(!workspace || busy || !chosen.length)return
    setBusy(true);setNotice('')
    const results: string[] = []
    try {
      for(const item of chosen){
        try{
          await axImportCapability(workspace,item.path,item.kind,global)
          results.push(`${item.name}: ${copy('已导入','Imported')}`)
          setSelected(current=>current.filter(path=>path!==item.path))
        }catch(error){results.push(`${item.name}: ${String(error)}`)}
      }
      setNotice(results.join('\n'))
      await query.invalidateQueries({queryKey:['ax-catalog']})
    }finally{setBusy(false)}
  }
  const importCapability = async (kind: 'skill' | 'mcp') => {
    if(!workspace){setNotice(translate("copy.351"));return}
    try {
      const path=await open({directory:kind==='skill',multiple:false,...(kind==='mcp'?{filters:[{name:translate("copy.352"),extensions:['toml','json']}]}:{})})
      if(typeof path!=='string')return
      setBusy(true);setNotice('');setNotice(await axImportCapability(workspace,path,kind,global));await query.invalidateQueries({queryKey:['ax-catalog']})
    }catch(error){setNotice(String(error))}finally{setBusy(false)}
  }
  return <>
    <section className="settings-card">
      <div className="settings-import-heading"><h2><Download size={17}/>{copy('从其他 AI 应用导入','Import from other AI apps')}</h2><button disabled={!axAvailable||busy||sources.isFetching} onClick={()=>{setSelected([]);setExpanded([]);void sources.refetch()}}><RefreshCw size={15}/>{copy('重新扫描','Scan again')}</button></div>
      <p>{copy('自动查找本机及当前项目中的技能和 MCP 配置，选择你想带到 AX 的内容。','Find skills and MCP configurations on this computer and in the current project, then choose what to bring into AX.')}</p>
      {sources.isFetching&&<p role="status">{copy('正在扫描 AI 应用…','Scanning AI apps…')}</p>}
      {sources.error&&<div className="settings-notice is-error" role="alert">{copy('扫描失败：','Scan failed: ')}{String(sources.error)}</div>}
      {!sources.isFetching&&sources.data?.length===0&&<p>{copy('未找到可导入的配置。支持 Codex、Cursor、Claude Code、Windsurf 和共享 Agent Skills；也可在下方手动选择。','No importable configurations found. Supports Codex, Cursor, Claude Code, Windsurf and shared Agent Skills; you can also choose files manually below.')}</p>}
      <div className="settings-import-apps">{sources.data?.map(source=><div className="settings-import-app" key={source.id}>
        <button type="button" className="settings-import-toggle" aria-expanded={expanded.includes(source.id)} aria-controls={`${importId}-${source.id}`} onClick={()=>setExpanded(current=>current.includes(source.id)?current.filter(id=>id!==source.id):[...current,source.id])}><Laptop size={18}/><strong>{source.name}</strong><small>{source.items.length} {copy('项可导入','available')}</small><ChevronDown size={16} className="settings-import-chevron"/></button>
        <div id={`${importId}-${source.id}`} hidden={!expanded.includes(source.id)}>{expanded.includes(source.id)&&source.items.map(item=><label className="settings-import-item" key={item.path}><input type="checkbox" disabled={busy} checked={selected.includes(item.path)} onChange={event=>setSelected(current=>event.target.checked?[...current,item.path]:current.filter(path=>path!==item.path))}/><span><strong>{item.kind==='skill'?`Skill · ${item.name}`:item.name.replace('User',copy('用户配置','User')).replace('Project',copy('项目配置','Project'))}</strong><small><SettingsLocation path={item.path} kind={item.kind==='skill'?'directory':'file'}/></small></span></label>)}</div>
      </div>)}</div>
      <label className="settings-checkbox"><input type="checkbox" disabled={busy} checked={global} onChange={event=>setGlobal(event.target.checked)}/>{translate("copy.365")}</label>
      <div className="settings-actions"><button className="settings-primary" disabled={!axAvailable||busy||!workspace||!chosen.length} onClick={()=>void importSelected()}><Download size={15}/>{busy?copy('正在导入…','Importing…'):copy(`导入所选（${chosen.length}）`,`Import selected (${chosen.length})`)}</button><span>{copy(global?'目标：全局 AX':'目标：当前项目',global?'Destination: global AX':'Destination: current project')}</span></div>
      {!workspace&&<p>{copy('请先选择工作目录，再导入配置。','Choose a workspace before importing.')}</p>}
      <p>{copy('MCP 按配置文件导入；同名配置不会覆盖。导入后开启新会话生效。','MCP is imported per configuration file. Existing names are preserved. Start a new session after importing.')}</p>
      <details className="settings-import-manual"><summary>{copy('手动选择文件或目录','Choose a file or directory manually')}</summary><div className="settings-actions"><button disabled={!axAvailable||busy||!workspace} onClick={()=>void importCapability('skill')}>{translate("copy.366")}</button><button disabled={!axAvailable||busy||!workspace} onClick={()=>void importCapability('mcp')}>{translate("copy.367")}</button></div></details>
      {notice&&<div className="settings-notice" role="status">{notice}</div>}
    </section>
  </>
}
