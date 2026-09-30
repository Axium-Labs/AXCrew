import { translate, useLang } from '../lib/i18n'
import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Puzzle, RefreshCw, Server, ShieldAlert, Wrench } from 'lucide-react'
import { open } from '@tauri-apps/plugin-dialog'
import { axImportCapability, axAvailable, axCatalog } from '../lib/ax'

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

    <section className="settings-card"><h2>{translate("copy.363")}</h2><p>{translate("copy.364")}</p><label className="settings-checkbox"><input type="checkbox" checked={global} onChange={event=>setGlobal(event.target.checked)}/> {translate("copy.365")}</label><div className="settings-actions"><button disabled={!axAvailable||busy||!workspace} onClick={()=>void importCapability('skill')}>{translate("copy.366")}</button><button disabled={!axAvailable||busy||!workspace} onClick={()=>void importCapability('mcp')}>{translate("copy.367")}</button></div>{notice&&<div className="settings-notice" role="status">{notice}</div>}</section>
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
