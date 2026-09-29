import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Puzzle, RefreshCw, Server, ShieldAlert, Wrench } from 'lucide-react'
import { axAvailable, axCatalog } from '../lib/ax'

/**
 * 设置 → AX 能力：技能 / MCP 服务器 / 内置工具。
 *
 * 三项都来自 AX 自己的只读目录扩展，所以看到的就是 AX 实际会用的那份清单：
 * 技能来自项目根的 `skills/` 与全局 `~/.ax/skills`，MCP 服务器来自项目根的
 * `.ax/mcp.toml`，工具是 AX 自带的那几个（MCP 提供的工具要等会话连上服务器
 * 才存在，因此按服务器列出）。
 */
export function AxCapabilities({ workspace, home }: { workspace?: string; home?: string }) {
  const catalog = useQuery({ queryKey: ['ax-catalog', workspace ?? ''], queryFn: () => axCatalog(workspace), enabled: axAvailable, retry: false })
  const data = catalog.data
  const globalSkills = `${(home ?? '~/.ax').replaceAll('\\', '/')}/skills`

  return <div className="settings-stack">
    <section className="settings-card">
      <h2>AX 能力</h2>
      <p>直接读 AX 的只读目录扩展：技能来自项目根的 <code>skills/</code> 与全局 <code>{globalSkills}</code>，MCP 服务器来自项目根的 <code>.ax/mcp.toml</code>，工具是 AX 自带的内置工具。</p>
      <div className="settings-field-row"><span>查询目录</span><strong>{data?.cwd ?? workspace ?? '未选择工作目录'}</strong></div>
      <div className="settings-actions">
        <button className="settings-secondary" disabled={!axAvailable || catalog.isFetching} onClick={() => void catalog.refetch()}><RefreshCw size={15}/> 重新读取</button>
        {data && <span>{data.skills.length} 个技能 · {data.mcp_servers.length} 个 MCP 服务器 · {data.tools.length} 个内置工具</span>}
      </div>
    </section>

    {!axAvailable && <div className="settings-notice is-inline"><ShieldAlert size={15}/> 仅桌面应用可以读取 AX 能力。</div>}
    {catalog.error && <div className="settings-notice is-error" role="alert">AX 能力读取失败：{String(catalog.error)}</div>}
    {!data && !catalog.error && axAvailable && <div className="settings-notice">正在读取 AX 能力…</div>}

    {data && <>
      <CapabilityPanel icon={<Puzzle size={16}/>} title="技能" count={data.skills.length}>
        {data.skills.length === 0
          ? <p>AX 没有找到技能。把带 SKILL.md 的技能目录放进全局目录 <code>{globalSkills}</code>，或当前工作目录的 <code>skills/</code>。</p>
          : <ul className="settings-capability-list">{data.skills.map((skill) => <li key={skill.name}>
              <div className="settings-capability-head">
                <strong>{skill.name}</strong>
                {skill.missing_tools.length > 0 && <em className="settings-capability-warning">缺少工具：{skill.missing_tools.join('、')}</em>}
              </div>
              {skill.description && <p>{skill.description}</p>}
            </li>)}</ul>}
      </CapabilityPanel>

      <CapabilityPanel icon={<Server size={16}/>} title="MCP 服务器" count={data.mcp_servers.length}>
        {data.mcp_servers.length === 0
          ? <p>没有配置 MCP 服务器。在项目根的 <code>.ax/mcp.toml</code> 里添加（格式见 AX 仓库的 <code>mcp.example.toml</code>）。</p>
          : <ul className="settings-capability-list">{data.mcp_servers.map((server) => <li key={server.name}>
              <div className="settings-capability-head">
                <strong>{server.name}</strong>
                {!server.enabled && <em className="settings-capability-warning">已停用</em>}
                {server.capabilities.map((capability) => <span key={capability} className="settings-capability-tag">{capability}</span>)}
              </div>
              {server.description && <p>{server.description}</p>}
            </li>)}</ul>}
      </CapabilityPanel>

      <CapabilityPanel icon={<Wrench size={16}/>} title="内置工具" count={data.tools.length}>
        {data.tools.length === 0
          ? <p>AX 没有返回内置工具列表。</p>
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
  return <section className="settings-card"><h2>{icon}{title}<small>{count}</small></h2>{children}</section>
}
