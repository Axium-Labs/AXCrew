import { translate, useLang } from '../lib/i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Laptop, Puzzle, RefreshCw, Server, ShieldAlert, Wrench } from 'lucide-react'
import { open } from '@tauri-apps/plugin-dialog'
import { axImportCapability, axAvailable, axCatalog, axScanCapabilitySources, axManageCapability, type ScopedCapability } from '../lib/ax'

/** Scoped capability management. All resolution and mutations are delegated to AX. */
export function AxCapabilities({ workspace }: { workspace?: string; home?: string }) {
  useLang(state=>state.lang);

  const [global,setGlobal] = useState(false),[busy,setBusy] = useState(false),[notice,setNotice] = useState('')
  const scope = global ? 'global' : 'project'
  const catalog = useQuery({ queryKey: ['ax-catalog', workspace ?? '', scope], queryFn: () => axCatalog(workspace, scope), enabled: axAvailable, retry: false })
  const [addKind,setAddKind] = useState<'skills' | 'mcp' | 'agents'>('skills'),[addName,setAddName] = useState('')
  const lang = useLang(state=>state.lang)
  const copy = (zh: string, en: string) => lang === 'zh' ? zh : en
  const sources = useQuery({ queryKey: ['ax-import-sources', workspace ?? ''], queryFn: () => axScanCapabilitySources(workspace), enabled: axAvailable, retry: false, refetchOnWindowFocus: false })
  const [selected,setSelected] = useState<string[]>([])
  useEffect(()=>{setSelected([]);setNotice('')},[workspace])
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
      await catalog.refetch()
    }finally{setBusy(false)}
  }
  const importCapability = async (kind: 'skill' | 'mcp') => {
    if(!workspace){setNotice(translate("copy.351"));return}
    try {
      const path=await open({directory:kind==='skill',multiple:false,...(kind==='mcp'?{filters:[{name:translate("copy.352"),extensions:['toml','json']}]}:{})})
      if(typeof path!=='string')return
      setBusy(true);setNotice('');setNotice(await axImportCapability(workspace,path,kind,global));await catalog.refetch()
    }catch(error){setNotice(String(error))}finally{setBusy(false)}
  }
  const manage = async (kind: 'skills' | 'mcp' | 'agents', action: 'enable' | 'disable' | 'remove' | 'add', name: string, source?: string) => {
    if (!workspace || busy) return
    setBusy(true);setNotice('')
    try { await axManageCapability(workspace, kind, scope, action, name, source); await catalog.refetch(); setNotice(copy('已保存，下一轮对话生效。','Saved; applies on the next agent turn.')) }
    catch (error) { setNotice(String(error)) } finally { setBusy(false) }
  }
  const add = async () => {
    if (!addName.trim()) return
    const path = await open({ directory: addKind === 'skills', multiple: false, ...(addKind !== 'skills' ? { filters: [{ name: 'TOML', extensions: ['toml'] }] } : {}) })
    if (typeof path === 'string') await manage(addKind, 'add', addName.trim(), path)
  }
  const rows = (kind: 'skills' | 'mcp' | 'agents', items: (ScopedCapability & { name: string; description: string; missing_tools?: string[]; capabilities?: string[] })[]) => <table className="settings-capability-table"><thead><tr><th>Name</th><th>Scope</th><th>Status</th><th>{copy('操作','Actions')}</th></tr></thead><tbody>{items.map(item => <tr key={item.name}>
    <td><strong>{item.name}</strong><p>{item.description}</p>{!!item.missing_tools?.length && <em className="settings-capability-warning">{translate("copy.374")}{item.missing_tools.join('、')}</em>}{item.capabilities?.map(capability=><span key={capability} className="settings-capability-tag">{capability}</span>)}</td><td>[{item.scope ?? 'global'}]</td><td>{item.status ?? (item.enabled === false ? 'disabled' : 'enabled')}</td>
    <td><button disabled={!axAvailable || busy || !workspace} onClick={() => void manage(kind, item.enabled === false ? 'enable' : 'disable', item.name)}>{item.enabled === false ? copy('启用','Enable') : copy('禁用','Disable')}</button><button disabled={!axAvailable || busy || !workspace} onClick={() => void manage(kind, 'remove', item.name)}>{copy(scope === 'project' && item.scope === 'global' ? '在此屏蔽' : '移除', scope === 'project' && item.scope === 'global' ? 'Disable here' : 'Remove')}</button></td>
  </tr>)}</tbody></table>
  const data = catalog.data

  return <div className="settings-stack">
    <section className="settings-card">
      <label>{copy('配置作用域','Configuration scope')}<select aria-label="Configuration scope" value={scope} onChange={event=>setGlobal(event.target.value==='global')}><option value="global">Global configuration</option><option value="project">Current project configuration</option></select></label>
      <p>{copy('当前有效能力由 Global + Project 合并，项目同名项覆盖全局项。','Effective capabilities combine Global + Project; project definitions override global names.')}</p>
      <div className="settings-actions"><select aria-label="Capability kind" value={addKind} onChange={event=>setAddKind(event.target.value as typeof addKind)}><option value="skills">Skill</option><option value="mcp">MCP</option><option value="agents">Agent</option></select><input aria-label="Capability name" value={addName} onChange={event=>setAddName(event.target.value)} placeholder={copy('名称 / ID','Name / ID')}/><button disabled={!axAvailable||busy||!workspace||!addName.trim()} onClick={()=>void add()}>{copy('添加','Add')}</button></div>
      <h2>{translate("copy.2")}</h2>
      <p>{copy('项目配置位于 .ax/skills、.ax/agents 和 .ax/mcp.toml；全局配置对所有项目可用。','Project configuration lives in .ax/skills, .ax/agents and .ax/mcp.toml; global configuration is available to all projects.')}</p>
      <div className="settings-field-row"><span>{translate("copy.357")}</span><strong>{data?.cwd ?? workspace ?? translate("copy.358")}</strong></div>
      <div className="settings-actions">
        <button className="settings-secondary" disabled={!axAvailable || catalog.isFetching} onClick={() => void catalog.refetch()}><RefreshCw size={15}/> {translate("copy.359")}</button>
        {data && <span>{data.skills.length} {translate("copy.360")} {data.mcp_servers.length} {translate("copy.361")} {data.tools.length} {translate("copy.362")}</span>}
      </div>
    </section>

    <section className="settings-card">
      <div className="settings-import-heading"><h2><Download size={17}/>{copy('从其他 AI 应用导入','Import from other AI apps')}</h2><button disabled={!axAvailable||busy||sources.isFetching} onClick={()=>{setSelected([]);void sources.refetch()}}><RefreshCw size={15}/>{copy('重新扫描','Scan again')}</button></div>
      <p>{copy('自动查找本机及当前项目中的技能和 MCP 配置，选择你想带到 AX 的内容。','Find skills and MCP configurations on this computer and in the current project, then choose what to bring into AX.')}</p>
      {sources.isFetching&&<p role="status">{copy('正在扫描 AI 应用…','Scanning AI apps…')}</p>}
      {sources.error&&<div className="settings-notice is-error" role="alert">{copy('扫描失败：','Scan failed: ')}{String(sources.error)}</div>}
      {!sources.isFetching&&sources.data?.length===0&&<p>{copy('未找到可导入的配置。支持 Codex、Cursor、Claude Code、Windsurf 和共享 Agent Skills；也可在下方手动选择。','No importable configurations found. Supports Codex, Cursor, Claude Code, Windsurf and shared Agent Skills; you can also choose files manually below.')}</p>}
      <div className="settings-import-apps">{sources.data?.map(source=><div className="settings-import-app" key={source.id}>
        <header><Laptop size={18}/><strong>{source.name}</strong><small>{source.items.length} {copy('项可导入','available')}</small></header>
        {source.items.map(item=><label className="settings-import-item" key={item.path}><input type="checkbox" disabled={busy} checked={selected.includes(item.path)} onChange={event=>setSelected(current=>event.target.checked?[...current,item.path]:current.filter(path=>path!==item.path))}/><span><strong>{item.kind==='skill'?`Skill · ${item.name}`:item.name.replace('User',copy('用户配置','User')).replace('Project',copy('项目配置','Project'))}</strong><small>{item.path}</small></span></label>)}
      </div>)}</div>
      <label className="settings-checkbox"><input type="checkbox" disabled={busy} checked={global} onChange={event=>setGlobal(event.target.checked)}/>{translate("copy.365")}</label>
      <div className="settings-actions"><button className="settings-primary" disabled={!axAvailable||busy||!workspace||!chosen.length} onClick={()=>void importSelected()}><Download size={15}/>{busy?copy('正在导入…','Importing…'):copy(`导入所选（${chosen.length}）`,`Import selected (${chosen.length})`)}</button><span>{copy(global?'目标：全局 AX':'目标：当前项目',global?'Destination: global AX':'Destination: current project')}</span></div>
      {!workspace&&<p>{copy('请先选择工作目录，再导入配置。','Choose a workspace before importing.')}</p>}
      <p>{copy('MCP 按配置文件导入；同名配置不会覆盖。导入后开启新会话生效。','MCP is imported per configuration file. Existing names are preserved. Start a new session after importing.')}</p>
      <details className="settings-import-manual"><summary>{copy('手动选择文件或目录','Choose a file or directory manually')}</summary><div className="settings-actions"><button disabled={!axAvailable||busy||!workspace} onClick={()=>void importCapability('skill')}>{translate("copy.366")}</button><button disabled={!axAvailable||busy||!workspace} onClick={()=>void importCapability('mcp')}>{translate("copy.367")}</button></div></details>
      {notice&&<div className="settings-notice" role="status">{notice}</div>}
    </section>
    {!axAvailable && <div className="settings-notice is-inline"><ShieldAlert size={15}/> {translate("copy.368")}</div>}
    {catalog.error && <div className="settings-notice is-error" role="alert">{translate("copy.369")}{String(catalog.error)}</div>}
    {!data && !catalog.error && axAvailable && <div className="settings-notice">{translate("copy.370")}</div>}

    {data && <>
      <CapabilityPanel icon={<Puzzle size={16}/>} title={translate("copy.371")} count={data.skills.length}>
        {rows('skills', data.skills)}
      </CapabilityPanel>
      <CapabilityPanel icon={<Server size={16}/>} title={translate("copy.375")} count={data.mcp_servers.length}>
        {rows('mcp', data.mcp_servers)}
      </CapabilityPanel>
      <CapabilityPanel icon={<Puzzle size={16}/>} title="Agents" count={data.agents?.length ?? 0}>
        {rows('agents', data.agents ?? [])}
      </CapabilityPanel>

      <CapabilityPanel icon={<Wrench size={16}/>} title={translate("copy.379")} count={data.tools.length}>
        {data.tools.length === 0
          ? <p>{translate("copy.380")}</p>
          : <ul className="settings-capability-list">{data.tools.map((tool) => <li key={tool.name}>
              <div className="settings-capability-head"><strong>{tool.name}</strong></div>
              {tool.description && <p>{tool.description}</p>}
            </li>)}</ul>}
      </CapabilityPanel>

      {data.warnings.length > 0 && <div className="settings-notice is-error" role="alert">{data.warnings.join('\n')}</div>}
    </>}
  </div>
}

function CapabilityPanel({ icon, title, count, children }: { icon: ReactNode; title: string; count: number; children: ReactNode }) {
  useLang(state=>state.lang);

  return <section className="settings-card"><h2>{icon}{title}<small>{count}</small></h2>{children}</section>
}
