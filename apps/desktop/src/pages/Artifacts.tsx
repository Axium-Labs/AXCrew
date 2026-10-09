import { translate, useLang } from '../lib/i18n'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Blocks, Bookmark, ChevronDown, FileText, FolderPlus, Image, LayoutGrid, MoreHorizontal,
  Plus, Rows3, Search, Table,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Menu } from '../components/ui/menu'
import { Select } from '../components/shared'
import { useCrews, useTasks } from '../lib/query'
import type { Task } from '../lib/types'
import './artifacts.css'

const STORE_KEY = 'ax-crew.artifacts'
type Stored = { folders: string[]; filing: Record<string, string> }
type Kind = 'doc' | 'code' | 'table' | 'image'
type View = 'gallery' | 'table'
const KINDS: Record<Kind, { label: string; Icon: typeof FileText }> = {
  doc: { get label() { return translate("copy.297") }, Icon: FileText },
  code: { get label() { return translate("copy.298") }, Icon: Blocks },
  table: { get label() { return translate("copy.299") }, Icon: Table },
  image: { get label() { return translate("copy.300") }, Icon: Image },
}
function load(): Stored {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
    return { folders: Array.isArray(value.folders) ? value.folders : [], filing: value.filing && typeof value.filing === 'object' ? value.filing : {} }
  } catch { return { folders: [], filing: {} } }
}
function classify(text: string): Kind {
  if (/!\[[^\]]*\]\(|<img\b/i.test(text)) return 'image'
  if (/```/.test(text)) return 'code'
  if (/^\s*\|.*\|\s*$/m.test(text)) return 'table'
  return 'doc'
}
function timeLabel(value: number) {
  return new Date(value * 1000).toLocaleString(useLang.getState().lang==='en'?'en-US':'zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
export function Artifacts() {
  const lang=useLang(state=>state.lang);

  const tasks = useTasks(), crews = useCrews(), navigate = useNavigate()
  const [store, setStore] = useState<Stored>(load)
  const [search, setSearch] = useState(''), [kind, setKind] = useState('all'), [tag, setTag] = useState('all')
  const [view, setView] = useState<View>('gallery')
  const [folderOpen, setFolderOpen] = useState(false), [folderName, setFolderName] = useState('')
  const persist = (next: Stored) => { setStore(next); try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* local convenience only */ } }
  const items = useMemo(() => (tasks.data ?? [])
    .filter((task): task is Task & { output: { text: string } } => typeof task.output?.text === 'string' && !!task.output.text.trim())
    .map(task => ({
      task,
      kind: classify(task.output.text),
      crew: crews.data?.find(item => item.id === task.crew_id)?.name ?? translate("copy.301"),
      at: task.finished_at ?? task.created_at,
      excerpt: task.output.text.trim(),
    }))
    .sort((a, b) => b.at - a.at), [tasks.data, crews.data, lang])
  const tags = useMemo(() => [...new Set(items.map(item => item.crew))], [items])
  const needle = search.trim().toLowerCase()
  const filtered = items.filter(item => (!needle || `${item.task.title} ${item.excerpt}`.toLowerCase().includes(needle)) && (kind === 'all' || item.kind === kind) && (tag === 'all' || item.crew === tag))
  const grouped = useMemo(() => {
    const folders = store.folders.map(name => ({ name, items: filtered.filter(item => store.filing[item.task.id] === name) }))
    return [...folders, { name: '', items: filtered.filter(item => !store.filing[item.task.id] || !store.folders.includes(store.filing[item.task.id])) }]
  }, [filtered, store])
  const file = (taskId: string, folder: string) => persist({ ...store, filing: { ...store.filing, [taskId]: folder } })
  const cardMenu = (item: (typeof items)[number]) => [
    { get label() { return translate("copy.302") }, action: () => navigate(`/tasks/${item.task.id}`) },
    ...store.folders.map(folder => ({ label: translate("copy.303", {v0:folder}), action: () => file(item.task.id, folder) })),
    ...(store.filing[item.task.id] ? [{ get label() { return translate("copy.304") }, action: () => file(item.task.id, '') }] : []),
  ]
  return <div className="page artifacts-page">
    <header className="artifacts-head"><div><span className="eyebrow">{translate("english.12")}</span><h1>{translate("copy.305")}</h1><p>{translate("copy.306")}</p></div></header>
    <div className="artifacts-toolbar">
      <h2>{translate("copy.307")}</h2>
      <div className="artifacts-toolbar-actions">
        <Menu trigger={<Button>{translate("copy.308")}<ChevronDown size={14}/></Button>} items={[{ get label() { return translate("copy.309") }, action: () => navigate('/sessions') }, { get label() { return translate("copy.310") }, action: () => navigate('/tasks') }]}/>
        <Button variant="secondary" onClick={() => { setFolderName(''); setFolderOpen(true) }}><FolderPlus size={14}/> {translate("copy.269")}</Button>
        <div className="ax-segmented artifacts-views" role="tablist" aria-label={translate("copy.311")}>
          <button role="tab" aria-selected={view === 'gallery'} className={view === 'gallery' ? 'is-active' : ''} onClick={() => setView('gallery')}><LayoutGrid size={14}/> {translate("copy.312")}</button>
          <button role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'is-active' : ''} onClick={() => setView('table')}><Rows3 size={14}/> {translate("copy.299")}</button>
        </div>
      </div>
    </div>
    <div className="artifacts-filters">
      <div className="artifacts-search"><Search size={16}/><input aria-label={translate("copy.313")} placeholder={translate("copy.314")} value={search} onChange={event => setSearch(event.target.value)}/></div>
      <div className="artifacts-select"><Select value={kind} onChange={setKind}><option value="all">{translate("copy.315")}</option>{Object.entries(KINDS).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</Select></div>
      <div className="artifacts-select"><Select value={tag} onChange={setTag}><option value="all">{translate("copy.316")}</option>{tags.map(value => <option key={value} value={value}>{value}</option>)}</Select></div>
    </div>
    {tasks.isError ? <div role="alert" className="panel artifacts-empty is-error">{translate("copy.317")}{String(tasks.error)} <Button variant="secondary" onClick={() => void tasks.refetch()}>{translate("copy.259")}</Button></div>
      : !filtered.length ? <div className="artifacts-empty">
        <Bookmark size={26}/>
        <strong>{items.length ? translate("copy.318") : translate("copy.319")}</strong>
        <p>{items.length ? translate("copy.320") : translate("copy.321")}</p>
      </div>
      : grouped.filter(group => group.items.length > 0).map(group => <section key={group.name || 'unsorted'} className="artifacts-group">
        {!!group.name && <h3 className="artifacts-folder"><FolderPlus size={14}/>{group.name}<small>{group.items.length}</small></h3>}
        {view === 'gallery'
          ? <div className="artifacts-gallery">{group.items.map(item => {
            const meta = KINDS[item.kind]
            return <article key={item.task.id} className="artifact-card">
              <header><span className={`artifact-kind is-${item.kind}`}><meta.Icon size={15}/></span><strong>{item.task.title}</strong>
                <Menu trigger={<button type="button" className="artifact-more" aria-label={translate("copy.291", {v0:item.task.title})}><MoreHorizontal size={15}/></button>} items={cardMenu(item)}/>
              </header>
              <Link className="artifact-body" to={`/tasks/${item.task.id}`}><pre>{item.excerpt}</pre></Link>
              <footer><span>{meta.label}</span><span>{item.crew}</span><time>{timeLabel(item.at)}</time></footer>
            </article>
          })}</div>
          : <div className="panel artifacts-table" role="table" aria-label={translate("copy.305")}>
            <div className="artifacts-row is-head" role="row">{[translate("copy.199"), translate("copy.272"), translate("copy.322"), translate("copy.323"), translate("copy.276")].map(label => <span key={label} role="columnheader">{label}</span>)}</div>
            {group.items.map(item => <div key={item.task.id} className="artifacts-row" role="row">
              <span className="artifact-name"><strong>{item.task.title}</strong><small>{item.excerpt.slice(0, 80)}</small></span>
              <span>{KINDS[item.kind].label}</span>
              <span className="artifact-tag">{item.crew}</span>
              <time>{timeLabel(item.at)}</time>
              <span className="artifacts-row-actions"><Link className="link" to={`/tasks/${item.task.id}`}>{translate("copy.324")}</Link><Menu trigger={<button type="button" className="artifact-more" aria-label={translate("copy.291", {v0:item.task.title})}><MoreHorizontal size={15}/></button>} items={cardMenu(item)}/></span>
            </div>)}
          </div>}
      </section>)}
    <Dialog open={folderOpen} onOpenChange={setFolderOpen} title={translate("copy.269")}>
      <div className="stack"><label className="block text-xs text-muted"><span className="mb-1.5 block font-medium text-foreground">{translate("copy.282")}</span><Input autoFocus value={folderName} onChange={event => setFolderName(event.target.value)}/></label>
        <div className="schedule-form-actions"><Button variant="secondary" onClick={() => setFolderOpen(false)}>{translate("copy.239")}</Button><Button disabled={!folderName.trim()} onClick={() => { persist({ ...store, folders: [...new Set([...store.folders, folderName.trim()])] }); setFolderOpen(false) }}><Plus size={14}/> {translate("copy.241")}</Button></div></div>
    </Dialog>
  </div>
}
