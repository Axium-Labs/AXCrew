import { translate, useLang } from '../lib/i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Laptop, Puzzle, RefreshCw, Server, ShieldAlert, Wrench } from 'lucide-react'
import { open } from '@tauri-apps/plugin-dialog'
import { axImportCapability, axAvailable, axCatalog, axScanCapabilitySources } from '../lib/ax'

/**
 * 设置 → AX 能力：技能 / MCP 服务器 / 内置工具。
 *
 * 三项都来自 AX 自己的只读目录扩展，所以看到的就是 AX 实际会用的那份清单：
 * 技能来自项目根的 `skills/` 与全局 `~/.ax/skills`，MCP 服务器来自项目根的
 * `.ax/mcp.toml`，工具是 AX 自带的那几个（MCP 提供的工具要等会话连上服务器
 * 才存在，因此按服务器列出）。
 */
export function AxCapabilities({ workspace, home }: { workspace?: string; home?: string }) {
  useLang(state=>state.lang);

  const catalog = useQuery({ queryKey: ['ax-catalog', workspace ?? ''], queryFn: () => axCatalog(workspace), enabled: axAvailable, retry: false })
  const [global,setGlobal] = useState(false),[busy,setBusy] = useState(false),[notice,setNotice] = useState('')
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
  const data = catalog.data
  const globalSkills = `${(home ?? '~/.ax').replaceAll('\\', '/')}/skills`

  return <div className="settings-stack">
    <section className="settings-card">
      <h2>{translate("copy.2")}</h2>
      <p>{translate("copy.353")}<code>skills/</code> {translate("copy.354")}<code>{globalSkills}</code>{translate("copy.355")}<code>.ax/mcp.toml</code>{translate("copy.356")}</p>
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
        {data.skills.length === 0
          ? <p>{translate("copy.372")}<code>{globalSkills}</code>{translate("copy.373")}<code>skills/</code>。</p>
          : <ul className="settings-capability-list">{data.skills.map((skill) => <li key={skill.name}>
              <div className="settings-capability-head">
                <strong>{skill.name}</strong>
                {skill.missing_tools.length > 0 && <em className="settings-capability-warning">{translate("copy.374")}{skill.missing_tools.join('、')}</em>}
              </div>
              {skill.description && <p>{skill.description}</p>}
            </li>)}</ul>}
      </CapabilityPanel>

      <CapabilityPanel icon={<Server size={16}/>} title={translate("copy.375")} count={data.mcp_servers.length}>
        {data.mcp_servers.length === 0
          ? <p>{translate("copy.376")}<code>.ax/mcp.toml</code> {translate("copy.377")}<code>mcp.example.toml</code>）。</p>
          : <ul className="settings-capability-list">{data.mcp_servers.map((server) => <li key={server.name}>
              <div className="settings-capability-head">
                <strong>{server.name}</strong>
                {!server.enabled && <em className="settings-capability-warning">{translate("copy.378")}</em>}
                {server.capabilities.map((capability) => <span key={capability} className="settings-capability-tag">{capability}</span>)}
              </div>
              {server.description && <p>{server.description}</p>}
            </li>)}</ul>}
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
