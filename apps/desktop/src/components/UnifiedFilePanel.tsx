import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isTauri } from '@tauri-apps/api/core'
import { ChevronDown, ChevronRight, Code2, Copy, FileText, Folder, FolderOpen, GitCompareArrows, PanelLeft, Plus, RefreshCw, Search, X } from 'lucide-react'
import { call as invoke } from '../lib/errors'
import { useLang } from '../lib/i18n'
import type { ChangedFile } from '../lib/sessionTranscript'
import type { Member } from '../lib/types'
import { DiffLines } from './SessionTranscript'
import { MessageMarkdown } from './MessageMarkdown'
import { Menu } from './ui/menu'
import './unified-file-panel.css'

type FileEntry = { name: string; is_dir: boolean; size: number }
type Listing = { path: string; entries: FileEntry[] }
type FileTab = { path: string; size?: number }
export type FileReviewRequest = { path?: string; id: number }
const slash = (path: string) => path.replace(/\\/g, '/')
const basename = (path: string) => slash(path).replace(/\/+$/, '').split('/').pop() || path
const markdown = (path: string) => /\.(md|markdown|mdown)$/i.test(path)
const join = (root: string, path: string) => /^(?:[a-z]:\/|\/)/i.test(slash(path)) ? path : `${root.replace(/[\\/]+$/, '')}/${path}`
const matches = (path: string, filter: string) => path.toLowerCase().includes(filter.trim().toLowerCase())
const sizeLabel = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} kB` : `${(size / 1024 / 1024).toFixed(1)} MB`

function FileIcon({ path }: { path: string }) {
  return markdown(path) ? <FileText size={15} /> : <Code2 size={15} />
}

function Directory({ root, relative = '', selected, filter, onOpen, depth = 0 }: {
  root: string; relative?: string; selected?: string; filter: string; onOpen: (tab: FileTab) => void; depth?: number
}) {
  const lang = useLang(s => s.lang)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const listing = useQuery({
    queryKey: ['file-panel-directory', root, relative],
    queryFn: () => invoke<Listing>('list_workspace_files', { root, relative }), retry: false,
  })
  if (listing.isPending) return <p className="unified-tree-message">{lang === 'zh' ? '读取中…' : 'Loading…'}</p>
  if (listing.error) return <div className="unified-tree-message is-error" role="alert">{String(listing.error)}<button onClick={() => void listing.refetch()}>{lang === 'zh' ? '重试' : 'Retry'}</button></div>
  const entries = [...listing.data.entries].sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name))
  // Keep directories navigable while filtering; load children only when expanded.
  const visible = entries.filter(entry => entry.is_dir || matches(relative ? `${relative}/${entry.name}` : entry.name, filter))
  return <>
    {!visible.length && <p className="unified-tree-message">{lang === 'zh' ? (filter ? '没有匹配的文件' : '目录为空') : (filter ? 'No matching files' : 'Empty directory')}</p>}
    {visible.map(entry => {
      const path = relative ? `${relative}/${entry.name}` : entry.name, open = expanded.has(path)
      return <div key={path}>
        <button type="button" className={`unified-tree-row ${!entry.is_dir && selected === path ? 'is-selected' : ''}`}
          style={{ paddingLeft: 12 + depth * 14 }} title={path} aria-expanded={entry.is_dir ? open : undefined} aria-current={!entry.is_dir && selected === path ? 'true' : undefined}
          onClick={() => entry.is_dir ? setExpanded(value => { const next = new Set(value); if (open) next.delete(path); else next.add(path); return next }) : onOpen({ path, size: entry.size })}>
          {entry.is_dir ? <>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{open ? <FolderOpen size={15} /> : <Folder size={15} />}</> : <><span className="unified-tree-spacer" /><FileIcon path={path} /></>}
          <span className="unified-tree-name">{entry.name}</span>
        </button>
        {entry.is_dir && open && <Directory root={root} relative={path} selected={selected} filter={filter} onOpen={onOpen} depth={depth + 1} />}
      </div>
    })}
  </>
}

function Empty({ title, description, review = false }: { title: string; description?: string; review?: boolean }) {
  return <div className="unified-empty-state">{review ? <GitCompareArrows size={28} strokeWidth={1.4} /> : <FileText size={28} strokeWidth={1.4} />}<strong>{title}</strong>{description && <p>{description}</p>}</div>
}

function TextDocument({ root, file, available, unavailable, onReference }: {
  root?: string; file: FileTab; available: boolean; unavailable: string; onReference?: (path: string) => void
}) {
  const lang = useLang(s => s.lang)
  const [mode, setMode] = useState<'source' | 'preview'>(markdown(file.path) ? 'preview' : 'source')
  const content = useQuery({
    queryKey: ['file-panel-content', root, file.path],
    queryFn: () => invoke<string>('read_workspace_file', { root, relative: file.path }), enabled: available, retry: false,
  })
  return <>
    <div className="unified-content-toolbar">
      <div className="unified-mode-switch" aria-label={lang === 'zh' ? '文件查看方式' : 'File view'}>
        {markdown(file.path) && <button aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>{lang === 'zh' ? '预览' : 'Preview'}</button>}
        <button aria-pressed={mode === 'source'} onClick={() => setMode('source')}>{lang === 'zh' ? '源码' : 'Source'}</button>
      </div>
      <span className="unified-content-size">{content.data !== undefined ? sizeLabel(new TextEncoder().encode(content.data).length) : file.size !== undefined ? sizeLabel(file.size) : ''}</span>
      {available && onReference && root && <button className="unified-reference" onClick={() => onReference(join(root, file.path))}>{lang === 'zh' ? '引用到消息' : 'Reference'}</button>}
    </div>
    <div className={`unified-document ${mode === 'preview' ? 'is-markdown' : 'is-source'}`}>
      {!available ? <Empty title={unavailable} /> : content.isPending ? <Empty title={lang === 'zh' ? '读取中…' : 'Loading…'} /> : content.error ? <div className="unified-read-error" role="alert"><p>{String(content.error)}</p><button onClick={() => void content.refetch()}>{lang === 'zh' ? '重试' : 'Retry'}</button></div>
        : mode === 'preview' ? <MessageMarkdown text={content.data} /> : <pre className="unified-code-view"><code>{content.data}</code></pre>}
    </div>
  </>
}

function ReviewDocument({ file, root, available, unavailable, onReference }: {
  file?: ChangedFile; root?: string; available: boolean; unavailable: string; onReference?: (path: string) => void
}) {
  const lang = useLang(s => s.lang)
  const [mode, setMode] = useState<'diff' | 'file'>('diff')
  if (!file) return <Empty review title={lang === 'zh' ? '暂无文件变更' : 'No file changes'} description={lang === 'zh' ? '此会话的文件修改会显示在这里，也可以打开工作目录浏览全部文件。' : 'Changes from this conversation appear here. Open the workspace to browse files.'} />
  return <>
    <div className="unified-review-heading"><span title={file.path}>{file.path}</span><span className="unified-file-stats"><b>+{file.additions}</b><em>−{file.deletions}</em></span></div>
    <div className="unified-review-switch"><button aria-pressed={mode === 'diff'} onClick={() => setMode('diff')}>{lang === 'zh' ? '差异' : 'Diff'}</button><button aria-pressed={mode === 'file'} onClick={() => setMode('file')}>{lang === 'zh' ? '当前文件' : 'Current file'}</button></div>
    {mode === 'diff' ? <div className="unified-document is-diff">{file.binary ? <Empty title={lang === 'zh' ? '二进制文件已更改，无法显示文本差异。' : 'Binary file changed; no text diff available.'} /> : file.diff ? <DiffLines diff={file.diff} /> : <Empty title={lang === 'zh' ? '此记录未保存文件差异。' : 'No diff was saved for this record.'} />}</div>
      : file.change === 'deleted' ? <Empty title={lang === 'zh' ? '此文件已删除，可在差异中查看删除的内容。' : 'This file was deleted. View its removed content in Diff.'} /> : file.binary ? <Empty title={lang === 'zh' ? '二进制文件无法以文本预览。' : 'Binary files cannot be previewed as text.'} /> : <TextDocument key={file.path} root={root} file={file} available={available} unavailable={unavailable} onReference={onReference} />}
  </>
}

export function UnifiedFilePanel({ changedFiles, reviewRequest, member, workspaceRoot, remote = false, onReference }: {
  changedFiles: ChangedFile[]; reviewRequest?: FileReviewRequest; member?: Member; workspaceRoot?: string; remote?: boolean; onReference?: (path: string) => void
}) {
  const lang = useLang(s => s.lang), queryClient = useQueryClient()
  const root = workspaceRoot ?? member?.cwd
  const local = !remote && (!member || member.device_id === 'local')
  const available = !!root && local && isTauri()
  const unavailable = !local ? (lang === 'zh' ? '远程工作区暂不支持文件浏览' : 'Remote file browsing is not available') : !root ? (lang === 'zh' ? '请先选择工作目录' : 'Choose a workspace first') : (lang === 'zh' ? '文件浏览仅在桌面版中可用' : 'File browsing is available in the desktop app')
  const [tabs, setTabs] = useState<FileTab[]>([]), [active, setActive] = useState<string | null>(null)
  const [reviewPath, setReviewPath] = useState<string>()
  const [tree, setTree] = useState<'review' | 'workspace'>('review'), [treeOpen, setTreeOpen] = useState(true)
  const [filter, setFilter] = useState(''), [notice, setNotice] = useState('')
  const panelRef = useRef<HTMLDivElement>(null), searchRef = useRef<HTMLInputElement>(null), tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const file = changedFiles.find(item => item.path === reviewPath) ?? changedFiles[0]
  const activeFile = tabs.find(tab => tab.path === active)

  useEffect(() => {
    if (!reviewRequest) return
    setActive(null); setReviewPath(reviewRequest.path); setTree('review'); setTreeOpen(true); setFilter('')
  }, [reviewRequest])
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3000); return () => window.clearTimeout(timer) }, [notice])

  const openFile = (tab: FileTab) => {
    setTabs(value => value.some(item => item.path === tab.path) ? value : [...value, tab]); setActive(tab.path)
    if ((panelRef.current?.getBoundingClientRect().width ?? 0) > 0 && panelRef.current!.getBoundingClientRect().width <= 410) setTreeOpen(false)
  }
  const openWorkspace = () => {
    setTree('workspace'); setTreeOpen(true); setFilter(''); requestAnimationFrame(() => searchRef.current?.focus())
  }
  const closeFile = (path: string) => {
    const index = tabs.findIndex(tab => tab.path === path), next = tabs.filter(tab => tab.path !== path)
    setTabs(next)
    if (active === path) {
      const nextPath = next[Math.min(index, next.length - 1)]?.path ?? null
      setActive(nextPath); requestAnimationFrame(() => tabRefs.current.get(nextPath === null ? 'review' : `file:${nextPath}`)?.focus())
    }
  }
  const tabKeys = ['review', ...tabs.map(tab => `file:${tab.path}`)]
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, key: string) => {
    const index = tabKeys.indexOf(key)
    const next = event.key === 'ArrowRight' ? (index + 1) % tabKeys.length : event.key === 'ArrowLeft' ? (index + tabKeys.length - 1) % tabKeys.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabKeys.length - 1 : -1
    if (next < 0) return
    event.preventDefault(); const keyNext = tabKeys[next]; setActive(keyNext === 'review' ? null : keyNext.slice(5)); tabRefs.current.get(keyNext)?.focus()
  }
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['file-panel-directory', root] }); void queryClient.invalidateQueries({ queryKey: ['file-panel-content', root] })
  }
  const copyPath = async () => {
    if (!root) return
    try { await navigator.clipboard.writeText(activeFile ? join(root, activeFile.path) : root); setNotice(lang === 'zh' ? '路径已复制' : 'Path copied') }
    catch { setNotice(lang === 'zh' ? '无法复制路径' : 'Could not copy path') }
  }

  return <div className="unified-file-panel" ref={panelRef} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); openWorkspace() } }}>
    <div className="unified-panel-header">
      <div className="unified-document-tabs" role="tablist" aria-label={lang === 'zh' ? '审查与打开的文件' : 'Review and open files'}>
        <button type="button" role="tab" id="file-panel-review-tab" aria-controls="file-panel-content" aria-selected={active === null} tabIndex={active === null ? 0 : -1} className={`unified-document-tab ${active === null ? 'is-active' : ''}`} ref={node => { if (node) tabRefs.current.set('review', node); else tabRefs.current.delete('review') }} onKeyDown={event => navigateTabs(event, 'review')} onClick={() => { setActive(null); setTree('review') }}>
          {lang === 'zh' ? '审查' : 'Review'}{changedFiles.length > 0 && <span className="unified-badge">{changedFiles.length}</span>}
        </button>
        {tabs.map((tab, index) => <div className={`unified-file-tab ${active === tab.path ? 'is-active' : ''}`} key={tab.path}>
          <button role="tab" id={`file-panel-tab-${index}`} aria-controls="file-panel-content" aria-selected={active === tab.path} tabIndex={active === tab.path ? 0 : -1} title={tab.path} ref={node => { if (node) tabRefs.current.set(`file:${tab.path}`, node); else tabRefs.current.delete(`file:${tab.path}`) }} onKeyDown={event => navigateTabs(event, `file:${tab.path}`)} onClick={() => setActive(tab.path)}><FileIcon path={tab.path} /><span>{basename(tab.path)}</span></button>
          <button className="unified-tab-close" aria-label={`${lang === 'zh' ? '关闭' : 'Close'} ${basename(tab.path)}`} onClick={() => closeFile(tab.path)}><X size={13} /></button>
        </div>)}
      </div>
      <Menu trigger={<button className="unified-icon-button" aria-label={lang === 'zh' ? '打开文件菜单' : 'Open file menu'}><Plus size={17} /></button>} items={[{ label: <><FolderOpen size={15} />{lang === 'zh' ? '打开文件' : 'Open file'}<kbd>Ctrl P</kbd></>, action: openWorkspace }]} />
      <div className="unified-header-actions">
        <button className="unified-icon-button" aria-label={lang === 'zh' ? '浏览工作目录' : 'Browse workspace'} title={root ?? ''} onClick={openWorkspace}><FolderOpen size={17} /></button>
        <Menu trigger={<button className="unified-icon-button unified-path-menu" aria-label={lang === 'zh' ? '工作目录操作' : 'Workspace actions'}><ChevronDown size={12} /></button>} items={[{ label: <><Copy size={15} />{lang === 'zh' ? '复制路径' : 'Copy path'}</>, action: () => void copyPath(), disabled: !root }, { label: <><RefreshCw size={15} />{lang === 'zh' ? '刷新文件' : 'Refresh files'}</>, action: refresh, disabled: !available }]} />
        <button className="unified-icon-button" aria-label={lang === 'zh' ? '切换文件树' : 'Toggle file tree'} aria-expanded={treeOpen} onClick={() => setTreeOpen(value => !value)}><PanelLeft size={17} /></button>
      </div>
    </div>
    <div className="unified-panel-body">
      {treeOpen && <aside className="unified-explorer" aria-label={tree === 'review' ? (lang === 'zh' ? '修改的文件' : 'Changed files') : (lang === 'zh' ? '工作目录文件' : 'Workspace files')}>
        <div className="unified-explorer-heading"><Folder size={16} /><strong title={root}>{root ? basename(root) : (lang === 'zh' ? '文件' : 'Files')}</strong><button className="unified-icon-button" onClick={refresh} disabled={!available} aria-label={lang === 'zh' ? '刷新文件' : 'Refresh files'}><RefreshCw size={13} /></button></div>
        <div className="unified-explorer-modes"><button aria-pressed={tree === 'review'} onClick={() => { setTree('review'); setFilter('') }}>{lang === 'zh' ? '修改' : 'Changes'}</button><button aria-pressed={tree === 'workspace'} onClick={openWorkspace}>{lang === 'zh' ? '全部文件' : 'All files'}</button></div>
        <label className="unified-search"><Search size={14} /><input ref={searchRef} aria-label={lang === 'zh' ? '筛选文件' : 'Filter files'} placeholder={lang === 'zh' ? '筛选文件' : 'Filter files'} value={filter} onChange={event => setFilter(event.target.value)} /></label>
        <div className="unified-explorer-files">
          {tree === 'workspace' ? available && root ? <Directory key={root} root={root} selected={active ?? undefined} filter={filter} onOpen={openFile} /> : <p className="unified-tree-message">{unavailable}</p>
            : changedFiles.length ? <>{changedFiles.filter(item => matches(item.path, filter)).map(item => <button key={item.path} className={`unified-tree-row unified-change-row ${active === null && file?.path === item.path ? 'is-selected' : ''}`} title={item.path} aria-current={active === null && file?.path === item.path ? 'true' : undefined} onClick={() => { setReviewPath(item.path); setActive(null) }}>
              <FileIcon path={item.path} /><span className="unified-tree-name"><span>{basename(item.path)}</span>{slash(item.path).includes('/') && <small>{slash(item.path).slice(0, slash(item.path).lastIndexOf('/'))}</small>}</span><span className="unified-file-stats"><b>+{item.additions}</b><em>−{item.deletions}</em></span>
            </button>)}{!changedFiles.some(item => matches(item.path, filter)) && <p className="unified-tree-message">{lang === 'zh' ? '没有匹配的文件' : 'No matching files'}</p>}</> : <p className="unified-tree-message">{lang === 'zh' ? '暂无文件变更' : 'No file changes'}</p>}
        </div>
      </aside>}
      <section className="unified-reader" id="file-panel-content" role="tabpanel" aria-labelledby={activeFile ? `file-panel-tab-${tabs.indexOf(activeFile)}` : 'file-panel-review-tab'} tabIndex={0}>
        {activeFile ? <TextDocument key={activeFile.path} root={root} file={activeFile} available={available} unavailable={unavailable} onReference={onReference} /> : <ReviewDocument key={`${file?.path}:${reviewRequest?.id ?? ''}`} file={file} root={root} available={available} unavailable={unavailable} onReference={onReference} />}
      </section>
    </div>
    {notice && <div className="unified-copy-notice" role="status">{notice}</div>}
  </div>
}
