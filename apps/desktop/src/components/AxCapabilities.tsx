import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Tabs from '@radix-ui/react-tabs'
import { Blocks, Bot, ChevronDown, FileText, FolderOpen, MoreHorizontal, Plus, Puzzle, RefreshCw, Search, Server, Settings2, X } from 'lucide-react'
import { open } from '@tauri-apps/plugin-dialog'
import { axAvailable, axCatalog, axManageCapability, type CapabilityScope, type ScopedCapability } from '../lib/ax'
import { useLang } from '../lib/i18n'
import { useSessionUi } from '../store/sessions'
import { Dialog } from './ui/dialog'
import { Menu } from './ui/menu'
import { SettingsSelect } from './ui/settings-select'
import { readableSettingsPath, SettingsLocation } from './ui/settings-location'
import { AgentDelegationSettings } from './AgentDelegationSettings'

type Kind = 'mods' | 'mcp' | 'skills' | 'agents'
type Item = ScopedCapability & { name: string; description: string; missing_tools?: string[]; capabilities?: string[]; version?: string }
/** `edited` stops a later source pick from overwriting a name the user typed. */
type Draft = { source: string; name: string; edited: boolean }
const emptyDraft: Draft = { source: '', name: '', edited: false }
const isDirectoryKind = (kind: Kind) => kind === 'skills' || kind === 'mods'
const baseName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

export function AxCapabilities({ workspace }: { workspace?: string; home?: string }) {
  const [scope, setScope] = useState<CapabilityScope>('project')
  const [tab, setTab] = useState<Kind>('skills')
  // A late native dialog / mutation must never populate a different project or view.
  return <CapabilityView key={JSON.stringify([workspace, scope])} workspace={workspace} scope={scope} onScopeChange={setScope} tab={tab} onTabChange={setTab}/>
}

function CapabilityView({ workspace, scope, onScopeChange, tab, onTabChange }: {
  workspace?: string; scope: CapabilityScope; onScopeChange: (scope: CapabilityScope) => void
  tab: Kind; onTabChange: (tab: Kind) => void
}) {
  const lang = useLang(state => state.lang), copy = (zh: string, en: string) => lang === 'zh' ? zh : en
  const client = useQueryClient(), nameId = useId()
  const mounted = useRef(true), locked = useRef(false)
  const addTrigger = useRef<HTMLButtonElement>(null), detailTrigger = useRef<HTMLButtonElement | null>(null)
  const nameButtons = useRef(new Map<string, HTMLButtonElement>())
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const [search, setSearch] = useState(''), [addKind, setAddKind] = useState<Kind | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft), [picking, setPicking] = useState(false), [detail, setDetail] = useState<Item | null>(null)
  const canQuery = axAvailable && (scope === 'global' || !!workspace)
  const catalog = useQuery({ queryKey: ['ax-catalog', workspace ?? '', scope], queryFn: () => axCatalog(workspace, scope), enabled: canQuery, retry: false })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setSearch(''); setNotice(''); setError(''); setDetail(null); setAddKind(null) }, [tab])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const data = catalog.data
  const tabs: { kind: Kind; label: string; items: Item[]; icon: typeof Puzzle }[] = [
    { kind: 'mods', label: 'Mod', items: data?.mods ?? [], icon: Blocks },
    { kind: 'mcp', label: 'MCP', items: data?.mcp_servers ?? [], icon: Server },
    { kind: 'skills', label: copy('技能', 'Skills'), items: data?.skills ?? [], icon: Puzzle },
    { kind: 'agents', label: copy('智能体', 'Agents'), items: data?.agents ?? [], icon: Bot },
  ]
  const current = tabs.find(item => item.kind === tab)!, Icon = current.icon
  // Keep the last category while the dialog animates closed.
  const lastAddKind = useRef<Kind>('skills')
  if (addKind) lastAddKind.current = addKind
  const addTab = tabs.find(item => item.kind === lastAddKind.current)!
  const term = search.trim().toLowerCase()
  const items = current.items.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(term))
  // Built-in tools are not plugins, so their catalog failures are not shown here.
  const warnings = (data?.warnings ?? []).filter(warning => !warning.startsWith('工具：'))
  const sourceHint = (kind: Kind) => {
    switch (kind) {
      case 'mods': return copy('选择包含 mod.json 和 JavaScript 入口的 Mod 目录；名称须与清单一致。', 'Choose a Mod directory containing mod.json and a JavaScript entry; use the manifest name.')
      case 'mcp': return copy('选择 .ax/mcp.toml 等 TOML 配置文件，填写其中要添加的服务器名称。', 'Choose a TOML configuration such as .ax/mcp.toml and enter the server name to add.')
      case 'agents': return copy('选择智能体 TOML 配置文件，填写配置中的智能体名称。', 'Choose an Agent TOML configuration and enter its definition name.')
      default: return copy('选择包含 SKILL.md 的技能目录，填写技能名称。', 'Choose a skill directory containing SKILL.md and enter the skill name.')
    }
  }
  const addCopy = (kind: Kind) => {
    switch (kind) {
      case 'mods': return { source: copy('Mod 目录', 'Mod directory'), pick: copy('选择 Mod 目录', 'Choose Mod directory'), sourceHint: copy('目录内需包含 mod.json 和 JavaScript 入口。', 'The directory must contain mod.json and a JavaScript entry.'), name: copy('Mod 名称', 'Mod name'), nameHint: copy('须与 mod.json 中的 name 一致；默认使用目录名。', 'Must match the name in mod.json; defaults to the directory name.') }
      case 'mcp': return { source: copy('MCP 配置文件', 'MCP configuration file'), pick: copy('选择 TOML 文件', 'Choose TOML file'), sourceHint: copy('例如 .ax/mcp.toml，可包含多个服务器。', 'For example .ax/mcp.toml; it may define several servers.'), name: copy('服务器名称', 'Server name'), nameHint: copy('填写配置文件中要添加的服务器名称。', 'Enter the server to add from the file.') }
      case 'agents': return { source: copy('智能体配置文件', 'Agent configuration file'), pick: copy('选择 TOML 文件', 'Choose TOML file'), sourceHint: copy('包含智能体定义的 TOML 文件。', 'A TOML file containing Agent definitions.'), name: copy('智能体名称', 'Agent name'), nameHint: copy('填写配置文件中的智能体名称。', 'Enter the Agent name defined in the file.') }
      default: return { source: copy('技能目录', 'Skill directory'), pick: copy('选择技能目录', 'Choose skill directory'), sourceHint: copy('目录内需包含 SKILL.md。', 'The directory must contain SKILL.md.'), name: copy('技能名称', 'Skill name'), nameHint: copy('默认使用目录名，可修改。', 'Defaults to the directory name; you can change it.') }
    }
  }
  const beginAdd = (kind: Kind) => { setDraft(emptyDraft); setError(''); setNotice(''); setAddKind(kind) }
  const closeAdd = () => { if (!busy) { setAddKind(null); setError('') } }
  const showDetail = (item: Item) => { detailTrigger.current = nameButtons.current.get(item.name) ?? null; setDetail(item) }
  const restoreFocus = (event: Event, target: HTMLButtonElement | null) => { if (target?.isConnected) { event.preventDefault(); target.focus() } }
  const run = async (operation: () => Promise<void>) => {
    if (locked.current || !axAvailable) return
    locked.current = true
    setBusy(true); setError(''); setNotice('')
    try { await operation() }
    catch (reason) { if (mounted.current) setError(String(reason)) }
    finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  const manage = async (kind: Kind, action: 'enable' | 'disable' | 'remove' | 'add', itemName: string, source?: string) => {
    if (!workspace || !mounted.current) return
    await axManageCapability(workspace, kind, scope, action, itemName, source)
    // Global entries are inherited by every project; invalidate inactive views too.
    await client.invalidateQueries({ queryKey: ['ax-catalog'] })
    if (!mounted.current) return
    setNotice(copy('已保存，下一轮对话生效。', 'Saved; applies on the next turn.'))
    if (action === 'add') { setAddKind(null); setSearch('') }
  }
  const pickSource = () => {
    if (!addKind) return
    const kind = addKind
    void run(async () => {
      setPicking(true)
      try {
        const path = await open({ directory: isDirectoryKind(kind), multiple: false, defaultPath: workspace, ...(isDirectoryKind(kind) ? {} : { filters: [{ name: 'TOML', extensions: ['toml'] }] }) })
        // Directory names are a good default; a TOML file name rarely matches the entry inside it.
        if (typeof path === 'string' && mounted.current) setDraft(prev => ({ ...prev, source: path, name: prev.edited || !isDirectoryKind(kind) ? prev.name : baseName(path) }))
      } finally { if (mounted.current) setPicking(false) }
    })
  }
  const add = () => {
    if (!addKind || !draft.source || !draft.name.trim() || !workspace) return
    const kind = addKind
    void run(() => manage(kind, 'add', draft.name.trim(), draft.source))
  }
  const browse = () => void run(async () => {
    const path = await open({ directory: true, multiple: false, defaultPath: workspace })
    if (typeof path === 'string' && mounted.current) useSessionUi.getState().setSelectedCwd(path)
  })
  const mutable = axAvailable && !!workspace && !busy && !catalog.isFetching && !catalog.error

  return <div className="plugins-page">
    <div className="plugins-actions">
      <SettingsSelect label={copy('配置作用域', 'Configuration scope')} value={scope} disabled={busy} onChange={value => onScopeChange(value as CapabilityScope)} options={[{ value: 'project', label: copy('当前项目', 'Current project') }, { value: 'global', label: copy('全局配置', 'Global configuration') }]}/>
      <div className="plugins-action-buttons">
        <button type="button" className="plugins-button" disabled={!axAvailable || busy} onClick={browse}><FolderOpen size={16}/>{copy('浏览目录', 'Browse directory')}</button>
        <Menu trigger={<button ref={addTrigger} className="plugins-button is-primary" type="button" disabled={!axAvailable || !workspace || busy}><Plus size={16}/>{copy('添加', 'Add')}<ChevronDown size={14}/></button>} items={tabs.map(item => ({ label: item.label, action: () => beginAdd(item.kind) }))}/>
        <button type="button" className="plugins-button is-icon" aria-label={copy('刷新插件', 'Refresh plugins')} disabled={!canQuery || catalog.isFetching || busy} onClick={() => void client.invalidateQueries({ queryKey: ['ax-catalog'] })}><RefreshCw size={16} className={catalog.isFetching ? 'is-refreshing' : undefined}/></button>
      </div>
    </div>
    {!axAvailable && <p className="settings-notice">{copy('请在桌面应用中管理插件。', 'Manage plugins in the desktop app.')}</p>}
    {axAvailable && !workspace && <p className="settings-notice">{copy('请先浏览目录选择工作项目，再管理插件。', 'Choose a workspace using Browse directory before managing plugins.')}</p>}
    <Tabs.Root value={tab} onValueChange={value => onTabChange(value as Kind)}>
      <div className="plugins-toolbar">
        <Tabs.List className="plugins-tabs" aria-label={copy('插件类别', 'Plugin categories')}>
          {tabs.map(item => <Tabs.Trigger key={item.kind} value={item.kind} disabled={busy}>{item.label}<span>{data ? item.items.length : '—'}</span></Tabs.Trigger>)}
        </Tabs.List>
        <label className="plugins-search"><Search size={17}/><input aria-label={copy(`搜索${current.label}`, `Search ${current.label}`)} placeholder={copy(`搜索${current.label}`, `Search ${current.label}`)} value={search} onChange={event => setSearch(event.target.value)}/>{search && <button type="button" aria-label={copy('清除搜索', 'Clear search')} onClick={() => setSearch('')}><X size={15}/></button>}</label>
      </div>
      {error && !addKind && <p role="alert" className="settings-notice is-error">{error}</p>}
      {catalog.error && <div role="alert" className="settings-notice is-error"><strong>{copy('插件列表读取失败', 'Could not load plugins')}</strong><p>{String(catalog.error)}</p><button type="button" className="plugins-button" disabled={catalog.isFetching} onClick={() => void catalog.refetch()}>{copy('重试', 'Retry')}</button></div>}
      {notice && <p role="status" className="settings-notice">{notice}</p>}
      {!!warnings.length && <div role="alert" className="settings-notice is-error">{warnings.join('\n')}</div>}
      <Tabs.Content value={tab} className="plugins-panel" aria-busy={catalog.isFetching}>
        {catalog.isPending && canQuery && <div role="status" className="plugins-empty"><RefreshCw size={24} className="is-refreshing"/><strong>{copy('正在读取插件…', 'Loading plugins…')}</strong></div>}
        {tab === 'agents' && <AgentDelegationSettings workspace={workspace} scope={scope}/>}
        {data && <section className={`plugins-list ${tab === 'mcp' ? 'is-grouped' : ''}`} aria-label={current.label}>
          {items.map(item => <article className="plugin-row" key={item.name}>
            <span className="plugin-icon"><Icon size={20}/></span>
            <div className="plugin-copy">
              <button ref={node => { if (node) nameButtons.current.set(item.name, node); else nameButtons.current.delete(item.name) }} type="button" className="plugin-name" onClick={() => showDetail(item)}>{item.name}</button>
              {item.description && <p title={item.description}>{item.description}</p>}
              <div className="plugin-meta"><span className="plugin-scope">{copy(item.scope === 'project' ? '项目' : '个人', item.scope === 'project' ? 'Project' : 'Personal')}</span>
                <span>{item.status === 'disabled here' ? copy('已在此项目禁用', 'Disabled in this project') : item.enabled === false ? copy('已禁用', 'Disabled') : copy('已启用', 'Enabled')}</span>
                {item.version && <span>v{item.version}</span>}
              </div>
              {!!item.missing_tools?.length && <small className="settings-capability-warning">{copy('缺少工具：', 'Missing tools: ')}{item.missing_tools.join('、')}</small>}
              {!!item.capabilities?.length && <small>{item.capabilities.join(' · ')}</small>}
            </div>
            <div className="plugin-controls">
              <Menu trigger={<button type="button" className="plugin-menu" aria-label={copy(`配置 ${item.name}`, `Configure ${item.name}`)}>{tab === 'mcp' ? <Settings2 size={17}/> : <MoreHorizontal size={17}/>}</button>} items={[
                { label: copy('详情', 'Details'), action: () => showDetail(item) },
                { label: copy(scope === 'project' && item.scope === 'global' ? '在此屏蔽' : '移除', scope === 'project' && item.scope === 'global' ? 'Disable here' : 'Remove'), disabled: !mutable, action: () => void run(() => manage(tab, 'remove', item.name)) },
              ]}/>
              <button type="button" role="switch" className="plugin-switch" aria-label={copy(`启用 ${item.name}`, `Enable ${item.name}`)} aria-checked={item.enabled !== false} disabled={!mutable} onClick={() => void run(() => manage(tab, item.enabled === false ? 'enable' : 'disable', item.name))}><span/></button>
            </div>
          </article>)}
          {!items.length && !catalog.error && <div className="plugins-empty"><Icon size={27}/><strong>{copy(term ? '没有匹配的插件' : `暂无${current.label}`, term ? 'No matching plugins' : `No ${current.label} available`)}</strong>
            <p>{term ? copy('试试其他名称或描述关键词。', 'Try another name or description keyword.') : sourceHint(tab)}</p>
            {term ? <button type="button" className="plugins-button" onClick={() => setSearch('')}>{copy('清除搜索', 'Clear search')}</button> : <button type="button" className="plugins-button" disabled={!axAvailable || !workspace || busy} onClick={() => beginAdd(tab)}><Plus size={15}/>{copy(`添加${current.label}`, `Add ${current.label}`)}</button>}
          </div>}
        </section>}
      </Tabs.Content>
    </Tabs.Root>
    <AddDialog open={!!addKind} directory={isDirectoryKind(addTab.kind)} label={addTab.label} icon={addTab.icon} text={addCopy(addTab.kind)} copy={copy} scope={scope}
      draft={draft} busy={busy} picking={picking} error={error} ready={!!draft.source && !!draft.name.trim() && !!workspace && axAvailable}
      onName={value => setDraft(prev => ({ ...prev, name: value, edited: value.trim() !== '' }))} onPick={pickSource} onSubmit={add} onClose={closeAdd}
      onCloseAutoFocus={event => restoreFocus(event, addTrigger.current)} nameId={nameId}/>
    <Dialog open={!!detail} onCloseAutoFocus={event => restoreFocus(event, detailTrigger.current)} onOpenChange={value => { if (!value) setDetail(null) }} title={detail?.name ?? ''}>
      <div className="plugin-detail"><p>{detail?.description || copy('暂无描述。', 'No description available.')}</p>
        {detail?.source && <SettingsLocation path={detail.source} kind={tab === 'mcp' || tab === 'agents' ? 'file' : 'directory'}/>}
        {detail?.version && <p>v{detail.version}</p>}
        {!!detail?.missing_tools?.length && <p className="settings-capability-warning">{copy('缺少工具：', 'Missing tools: ')}{detail.missing_tools.join('、')}</p>}
      </div>
    </Dialog>
  </div>
}

type AddText = { source: string; pick: string; sourceHint: string; name: string; nameHint: string }

/** Two visible steps: pick the source first, then confirm the name AX registers it under. */
function AddDialog({ open, directory, label, icon: Icon, text, copy, scope, draft, busy, picking, error, ready, nameId, onName, onPick, onSubmit, onClose, onCloseAutoFocus }: {
  open: boolean; directory: boolean; label: string; icon: typeof Puzzle; text: AddText; copy: (zh: string, en: string) => string
  scope: CapabilityScope; draft: Draft; busy: boolean; picking: boolean; error: string; ready: boolean; nameId: string
  onName: (value: string) => void; onPick: () => void; onSubmit: () => void; onClose: () => void; onCloseAutoFocus: (event: Event) => void
}) {
  const SourceIcon = directory ? FolderOpen : FileText
  const scopeLabel = scope === 'project' ? copy('当前项目', 'Current project') : copy('全局配置', 'Global configuration')
  return <Dialog open={open} className="plugin-add-dialog" onCloseAutoFocus={onCloseAutoFocus} onOpenChange={value => { if (!value) onClose() }} title={copy(`添加${label}`, `Add ${label}`)}>
    <form className="plugin-add" aria-busy={busy} onSubmit={event => { event.preventDefault(); onSubmit() }}>
      <div className="plugin-add-intro">
        <span className="plugin-icon" aria-hidden="true"><Icon size={20}/></span>
        <p>{copy(`添加到「${scopeLabel}」，下一轮对话生效。`, `Adds to ${scopeLabel}; applies on the next turn.`)}</p>
      </div>
      <section className="plugin-add-step" aria-labelledby={`${nameId}-source`}>
        <h3 id={`${nameId}-source`}><span aria-hidden="true">1</span>{text.source}</h3>
        {draft.source
          ? <div className="plugin-add-source is-chosen">
              <SourceIcon size={18} aria-hidden="true"/>
              <span className="plugin-add-path" title={readableSettingsPath(draft.source)}>{readableSettingsPath(draft.source)}</span>
              <button type="button" className="plugins-button" disabled={busy} onClick={onPick}>{picking ? copy('正在选择…', 'Choosing…') : copy('更换', 'Change')}</button>
            </div>
          : <button type="button" className="plugin-add-source" disabled={busy} onClick={onPick}>
              <SourceIcon size={22} aria-hidden="true"/>
              <strong>{picking ? copy('正在选择…', 'Choosing…') : text.pick}</strong>
              <small>{text.sourceHint}</small>
            </button>}
      </section>
      <section className="plugin-add-step" aria-labelledby={`${nameId}-name`}>
        <h3 id={`${nameId}-name`}><span aria-hidden="true">2</span><label htmlFor={nameId}>{text.name}</label></h3>
        <input id={nameId} className="ax-field" value={draft.name} disabled={busy} autoComplete="off" spellCheck={false} aria-describedby={`${nameId}-hint`} onChange={event => onName(event.target.value)}/>
        <small id={`${nameId}-hint`}>{text.nameHint}</small>
      </section>
      {error && <p role="alert" className="settings-notice is-error">{error}</p>}
      <div className="plugin-add-footer">
        <button type="button" className="plugins-button" disabled={busy} onClick={onClose}>{copy('取消', 'Cancel')}</button>
        <button type="submit" className="plugins-button is-primary" disabled={!ready || busy}>{busy && !picking ? copy('正在添加…', 'Adding…') : copy(`添加${label}`, `Add ${label}`)}</button>
      </div>
    </form>
  </Dialog>
}
