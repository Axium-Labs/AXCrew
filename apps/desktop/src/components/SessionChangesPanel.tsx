import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isTauri } from '@tauri-apps/api/core'
import { call as invoke } from '../lib/errors'
import { DiffLines } from './SessionTranscript'
import { MessageMarkdown } from './MessageMarkdown'
import { useLang } from '../lib/i18n'
import { Code2, FileText, File, ChevronRight, ChevronDown, Folder } from 'lucide-react'
import type { ChangedFile } from '../lib/sessionTranscript'
import './session-changes-panel.css'

// 文件树节点类型
interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: FileTreeNode[]
  file?: ChangedFile
}

// 构建文件树
function buildFileTree(files: ChangedFile[]): FileTreeNode {
  const root: FileTreeNode = { name: '', path: '', type: 'folder', children: [] }

  for (const file of files) {
    const parts = file.path.split('/')
    let currentNode = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLastPart = i === parts.length - 1
      const currentPath = parts.slice(0, i + 1).join('/')

      if (!currentNode.children) {
        currentNode.children = []
      }

      let childNode = currentNode.children.find(child => child.name === part)

      if (!childNode) {
        childNode = {
          name: part,
          path: currentPath,
          type: isLastPart ? 'file' : 'folder',
          file: isLastPart ? file : undefined,
          children: isLastPart ? undefined : []
        }
        currentNode.children.push(childNode)
      }

      if (!isLastPart) {
        currentNode = childNode
      }
    }
  }

  return root
}

// 文件树组件
function FileTreeView({ node, selected, onSelect, level = 0 }: { node: FileTreeNode; selected?: string; onSelect: (path: string) => void; level?: number }) {
  const [expanded, setExpanded] = useState(true)
  const isSelected = node.type === 'file' && node.path === selected

  if (node.type === 'folder' && node.children && node.children.length > 0) {
    return (
      <div className="changes-tree-folder" style={{ paddingLeft: `${level * 12}px` }}>
        <button
          type="button"
          className="changes-tree-folder-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Folder size={14} />
          <span>{node.name || 'root'}</span>
        </button>
        {expanded && (
          <div className="changes-tree-children">
            {node.children.map(child => (
              <FileTreeView key={child.path} node={child} selected={selected} onSelect={onSelect} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  if (node.type === 'file' && node.file) {
    return (
      <button
        type="button"
        className={`changes-tree-file ${isSelected ? 'is-selected' : ''}`}
        style={{ paddingLeft: `${level * 12 + 24}px` }}
        onClick={() => onSelect(node.path)}
        aria-pressed={isSelected}
      >
        <span className="changes-file-icon">
          {node.name.endsWith('.md') ? <FileText size={14} /> : <Code2 size={14} />}
        </span>
        <span className="changes-file-name-only">{node.name}</span>
        <div className="changes-file-stats">
          <span className="changes-additions">+{node.file.additions}</span>
          <span className="changes-deletions">-{node.file.deletions}</span>
        </div>
      </button>
    )
  }

  return null
}

export function SessionChangesPanel({ files, selected, onSelect, root }: { files: ChangedFile[]; selected?: string; onSelect: (path: string) => void; root?: string }) {
  const lang = useLang(s => s.lang)
  const [choice, setChoice] = useState<{ path?: string; view: 'diff' | 'file' | 'preview' }>({ view: 'diff' })
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('tree')

  const file = files.find(file => file.path === selected) ?? files[0]
  const view = choice.path === file?.path ? choice.view : 'diff'
  const setView = (view: 'diff' | 'file' | 'preview') => setChoice({ path: file?.path, view })

  // 构建文件树
  const fileTree = useMemo(() => buildFileTree(files), [files])

  const content = useQuery({
    queryKey: ['changed-file', root, file?.path, file?.diff],
    queryFn: () => invoke<string>('read_workspace_file', { root, relative: file!.path }),
    enabled: !!root && !!file && isTauri() && (view === 'file' || view === 'preview') && file.change !== 'deleted' && !file.binary,
    retry: false
  })

  if (!file) return (
    <div className="changes-panel-empty">
      <FileText size={32} strokeWidth={1.5} />
      <strong>{lang === 'zh' ? '暂无文件变更' : 'No file changes'}</strong>
      <p>{lang === 'zh' ? '文件变更会显示在这里' : 'File changes will appear here'}</p>
    </div>
  )

  // 检查文件是否是 Markdown 文件
  const isMarkdown = file.path.endsWith('.md') || file.path.endsWith('.markdown')

  return (
    <div className="session-changes-panel-v2">
      {/* 文件列表/树形视图 */}
      <div className="changes-file-list" role="region" aria-label={lang === 'zh' ? '修改的文件' : 'Changed files'}>
        <div className="changes-list-header">
          <span className="changes-list-title">
            {lang === 'zh' ? `已更改 ${files.length} 个文件` : `${files.length} file${files.length > 1 ? 's' : ''} changed`}
          </span>
          <div className="changes-view-toggle">
            <button
              className={viewMode === 'list' ? 'is-active' : ''}
              onClick={() => setViewMode('list')}
              title={lang === 'zh' ? '列表视图' : 'List view'}
            >
              <File size={12} />
            </button>
            <button
              className={viewMode === 'tree' ? 'is-active' : ''}
              onClick={() => setViewMode('tree')}
              title={lang === 'zh' ? '树形视图' : 'Tree view'}
            >
              <Folder size={12} />
            </button>
          </div>
        </div>
        <div className="changes-list-body">
          {viewMode === 'tree' ? (
            fileTree.children && fileTree.children.map(node => (
              <FileTreeView key={node.path} node={node} selected={file.path} onSelect={(path) => { onSelect(path); setView('diff') }} />
            ))
          ) : (
            files.map(item => (
              <button
                type="button"
                key={item.path}
                className={`changes-file-item ${item.path === file.path ? 'is-selected' : ''}`}
                onClick={() => {
                  onSelect(item.path)
                  setView('diff')
                }}
                aria-pressed={item.path === file.path}
              >
                <div className="changes-file-name">
                  <span className="changes-file-icon">
                    {item.path.endsWith('.md') ? <FileText size={14} /> : <Code2 size={14} />}
                  </span>
                  <span className="changes-file-path" title={item.path}>{item.path}</span>
                </div>
                <div className="changes-file-stats">
                  <span className="changes-additions">+{item.additions}</span>
                  <span className="changes-deletions">-{item.deletions}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 顶部控制栏 */}
      <div className="changes-panel-header">
        <div className="changes-file-info">
          <strong title={file.path} className="changes-current-file">
            {file.path.split('/').pop()}
          </strong>
          <span className="changes-file-hint">{file.path}</span>
        </div>
        <div className="changes-view-tabs">
          <button
            className={`changes-view-tab ${view === 'diff' ? 'is-active' : ''}`}
            onClick={() => setView('diff')}
            title={lang === 'zh' ? '查看差异' : 'View diff'}
          >
            {lang === 'zh' ? '差异' : 'Diff'}
          </button>
          <button
            className={`changes-view-tab ${view === 'file' ? 'is-active' : ''}`}
            onClick={() => setView('file')}
            title={lang === 'zh' ? '查看完整文件' : 'View full file'}
          >
            {lang === 'zh' ? '源码' : 'Source'}
          </button>
          {isMarkdown && (
            <button
              className={`changes-view-tab ${view === 'preview' ? 'is-active' : ''}`}
              onClick={() => setView('preview')}
              title={lang === 'zh' ? '预览 Markdown' : 'Preview Markdown'}
            >
              {lang === 'zh' ? '预览' : 'Preview'}
            </button>
          )}
        </div>
      </div>

      {/* 内容区域 */}
      <div className="changes-panel-content">
        {view === 'diff' ? (
          file.diff ? (
            <DiffLines diff={file.diff} />
          ) : (
            <div className="changes-placeholder">
              <p>
                {file.binary
                  ? lang === 'zh'
                    ? '二进制文件已更改，无法显示文本差异。'
                    : 'Binary file changed; a text diff is unavailable.'
                  : lang === 'zh'
                  ? '此记录未保存文件差异。'
                  : 'No diff was saved for this record.'}
              </p>
            </div>
          )
        ) : view === 'file' ? (
          file.change === 'deleted' ? (
            <div className="changes-placeholder">
              <p>{lang === 'zh' ? '此文件已删除，可在差异中查看删除的内容。' : 'This file was deleted. View its removed contents in Diff.'}</p>
            </div>
          ) : file.binary ? (
            <div className="changes-placeholder">
              <p>{lang === 'zh' ? '二进制文件无法显示为文本。' : 'Binary files cannot be displayed as text.'}</p>
            </div>
          ) : content.isLoading ? (
            <div className="changes-placeholder">
              <p>{lang === 'zh' ? '读取中…' : 'Loading…'}</p>
            </div>
          ) : content.error ? (
            <div className="changes-placeholder error">
              <p role="alert">{String(content.error)}</p>
            </div>
          ) : content.data !== undefined ? (
            <pre className="changes-code-view">{content.data}</pre>
          ) : (
            <div className="changes-placeholder">
              <p>{lang === 'zh' ? '文件内容可在本地桌面端查看。' : 'File contents can be viewed in the local desktop app.'}</p>
            </div>
          )
        ) : isMarkdown && view === 'preview' ? (
          content.isLoading ? (
            <div className="changes-placeholder">
              <p>{lang === 'zh' ? '读取中…' : 'Loading…'}</p>
            </div>
          ) : content.error ? (
            <div className="changes-placeholder error">
              <p role="alert">{String(content.error)}</p>
            </div>
          ) : content.data !== undefined ? (
            <div className="changes-markdown-preview">
              <MessageMarkdown text={content.data} />
            </div>
          ) : (
            <div className="changes-placeholder">
              <p>{lang === 'zh' ? '预览不可用' : 'Preview not available'}</p>
            </div>
          )
        ) : (
          <div className="changes-placeholder">
            <p>{lang === 'zh' ? '预览不可用' : 'Preview not available'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
