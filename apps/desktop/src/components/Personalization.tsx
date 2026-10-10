import { SettingsToggle } from './ui/settings-toggle'
import { useState, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { open } from '@tauri-apps/plugin-dialog'
import { Trash2, FolderOpen, ChevronRight, AlertCircle } from 'lucide-react'
import { call as invoke } from '../lib/errors'
import { translate, useLang } from '../lib/i18n'
import { axAvailable, axLocalState } from '../lib/ax'
import { Dialog } from './ui/dialog'

type PersonalizationState = {
  memory_enabled: boolean
  tool_memory: boolean
  writing_enabled: boolean
  writing_folder: string | null
  instructions_path: string
  instructions: string
  cleared_memories?: number
}

async function axPersonalize(args: {
  memory?: boolean
  toolMemory?: boolean
  writing?: boolean
  writingFolder?: string
  clearWritingFolder?: boolean
  instructionsFile?: string
  expectedInstructionsFile?: string
  clearMemories?: boolean
}): Promise<PersonalizationState> {
  const home = (await axLocalState()).home
  const cmdArgs: Record<string, unknown> = { cwd: home }
  const axArgs = ['personalize']
  if (args.memory !== undefined) axArgs.push('--memory', String(args.memory))
  if (args.toolMemory !== undefined) axArgs.push('--tool-memory', String(args.toolMemory))
  if (args.writing !== undefined) axArgs.push('--writing', String(args.writing))
  if (args.writingFolder) axArgs.push('--writing-folder', args.writingFolder)
  if (args.clearWritingFolder) axArgs.push('--clear-writing-folder')
  if (args.instructionsFile) {
    axArgs.push('--instructions-file', args.instructionsFile)
    if (args.expectedInstructionsFile) axArgs.push('--expected-instructions-file', args.expectedInstructionsFile)
  }
  if (args.clearMemories) axArgs.push('--clear-memories')
  cmdArgs.args = axArgs
  const output = await invoke<string>('ax_tui_command', cmdArgs)
  return JSON.parse(output) as PersonalizationState
}

type DialogState = null | {
  type: 'edit_instructions'
} | {
  type: 'confirm_delete_memories'
}

export function Personalization() {
  const lang = useLang(state => state.lang)
  const query = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeError, setNoticeError] = useState(false)
  const [draftInstructions, setDraftInstructions] = useState('')
  const [dialogState, setDialogState] = useState<DialogState>(null)
  const [deletingMemory, setDeletingMemory] = useState(false)

  const state = useQuery({
    queryKey: ['personalization'],
    queryFn: () => axPersonalize({}),
    enabled: axAvailable,
    retry: false,
  })

  useEffect(() => {
    if (state.data?.instructions !== undefined) {
      setDraftInstructions(state.data.instructions)
    }
  }, [state.data?.instructions])

  const save = useCallback(async (updates: Parameters<typeof axPersonalize>[0]) => {
    setBusy(true)
    setNotice('')
    setNoticeError(false)
    try {
      await axPersonalize(updates)
      await query.invalidateQueries({ queryKey: ['personalization'] })
      setNotice(translate(lang === 'zh' ? '已保存' : 'Saved'))
    } catch (reason) {
      setNotice(String(reason))
      setNoticeError(true)
    } finally {
      setBusy(false)
    }
  }, [query, lang])

  const saveInstructions = useCallback(async () => {
    if (!state.data) return
    try {
      const temp = `${state.data.instructions_path}.tmp`
      await invoke('write_file', { path: temp, content: draftInstructions })
      await save({ instructionsFile: temp, expectedInstructionsFile: state.data.instructions_path })
      setDialogState(null)
    } catch (error) {
      setNotice(String(error))
      setNoticeError(true)
    }
  }, [draftInstructions, state.data, save])

  const selectFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false })
      if (typeof selected === 'string') {
        await save({ writingFolder: selected, writing: true })
      }
    } catch (reason) {
      setNotice(String(reason))
      setNoticeError(true)
    }
  }, [save])

  const confirmDeleteMemories = useCallback(async () => {
    setDeletingMemory(true)
    try {
      await save({ clearMemories: true })
      setDialogState(null)
    } catch (error) {
      setNotice(String(error))
      setNoticeError(true)
    } finally {
      setDeletingMemory(false)
    }
  }, [save])

  const data = state.data
  const hasChanges = draftInstructions !== (data?.instructions ?? '')

  return (
    <>
      <div className="settings-stack">
        {/* 记忆部分 */}
        <section className="settings-card">
          <h2>{lang === 'zh' ? '记忆' : 'Memory'}</h2>
          <SettingsToggle label={lang === 'zh' ? '启用记忆' : 'Enable memory'} description={lang === 'zh' ? '保存和检索个人偏好、项目事实和会话临时记录' : 'Store and retrieve personal preferences, project facts, and session notes'} checked={data?.memory_enabled ?? true} disabled={busy || !data} onChange={e => void save({ memory: e.target.checked })}/>
          <SettingsToggle label={lang === 'zh' ? '允许工具使用记忆' : 'Allow tool-driven memory'} description={lang === 'zh' ? '让 AX 可以通过工具主动创建记忆并从完成的工作中学习' : 'Let AX create memories through tools and learn from completed work'} checked={data?.tool_memory ?? true} disabled={busy || !data} onChange={e => void save({ toolMemory: e.target.checked })}/>
          <div className="settings-action-row">
            <div className="settings-toggle-copy">
              <strong>{lang === 'zh' ? '删除所有记忆' : 'Delete all memories'}</strong>
              <div className="settings-toggle-description">{lang === 'zh' ? '删除 Local 的所有 AX 记忆' : 'Delete all local AX memories'}</div>
            </div>
            <button 
              className="settings-danger" 
              disabled={busy || !data} 
              onClick={() => setDialogState({ type: 'confirm_delete_memories' })}
            >
              <Trash2 size={16} /> {lang === 'zh' ? '删除' : 'Delete'}
            </button>
          </div>
        </section>

        {/* 自定义指令部分 */}
        <section className="settings-card">
          <h2>{lang === 'zh' ? '自定义指令' : 'Custom instructions'}</h2>
          <p>{lang === 'zh' ? '对所有 AX 会话生效的全局指令' : 'Global instructions applied to every AX session'}</p>
          
          <button
            type="button"
            className="personalization-entry-button"
            onClick={() => setDialogState({ type: 'edit_instructions' })}
            disabled={busy || !data}
          >
            <div className="entry-content">
              <div className="entry-title">{lang === 'zh' ? '编辑自定义指令' : 'Edit Custom Instructions'}</div>
              <div className="entry-desc">{lang === 'zh' ? '编辑全局 AGENTS.md 文件' : 'Edit global AGENTS.md file'}</div>
            </div>
            <ChevronRight size={20} className="entry-icon" />
          </button>
        </section>

        {/* 写作部分 */}
        <section className="settings-card">
          <h2>{lang === 'zh' ? '写作' : 'Writing'}</h2>
          <p>{lang === 'zh' ? 'AX 写作时参考你自己文档的语气和风格' : 'AX matches the tone and style of your own documents when writing'}</p>
          <SettingsToggle label={lang === 'zh' ? '参考我的写作风格' : 'Reference my writing style'} checked={data?.writing_enabled ?? false} disabled={busy || !data} onChange={e => void save({ writing: e.target.checked })}/>
          {data?.writing_folder && (
            <div className="settings-field-row">
              <span>{lang === 'zh' ? '参考文件夹' : 'Reference folder'}</span>
              <code>{data.writing_folder}</code>
            </div>
          )}
          <div className="settings-actions">
            <button disabled={busy || !data} onClick={selectFolder}>
              <FolderOpen size={16} /> {lang === 'zh' ? '选择文件夹' : 'Select folder'}
            </button>
            {data?.writing_folder && (
              <button className="settings-secondary" disabled={busy} onClick={() => void save({ clearWritingFolder: true })}>
                {lang === 'zh' ? '清除' : 'Clear'}
              </button>
            )}
          </div>
        </section>

        {state.error && <div className="settings-notice is-error" role="alert">
          <AlertCircle size={16} />
          <span>{lang === 'zh' ? '无法读取个性化设置：' : 'Could not load personalization settings: '}{String(state.error)}</span>
        </div>}
        {notice && <div className={`settings-notice${noticeError ? ' is-error' : ''}`} role={noticeError ? 'alert' : 'status'}>
          <AlertCircle size={16} />
          <span>{notice}</span>
        </div>}
      </div>

      {/* 编辑指令对话框 */}
      <Dialog
        open={dialogState?.type === 'edit_instructions'}
        onOpenChange={(open) => !open && setDialogState(null)}
        title={lang === 'zh' ? '自定义指令' : 'Custom Instructions'}
        wide
      >
        <div className="instructions-editor-dialog">
          <textarea
            className="instructions-editor-textarea"
            value={draftInstructions}
            disabled={busy || !data}
            placeholder={lang === 'zh' ? '输入全局指令...' : 'Enter global instructions...'}
            onChange={e => setDraftInstructions(e.target.value)}
            spellCheck={false}
            autoFocus
          />
          
          {hasChanges && (
            <div className="unsaved-warning">
              {lang === 'zh' ? '⚠️ 有未保存的更改' : '⚠️ Unsaved changes'}
            </div>
          )}

          <div className="dialog-actions">
            <button 
              type="button"
              className="settings-secondary" 
              onClick={() => setDialogState(null)}
              disabled={busy}
            >
              {lang === 'zh' ? '取消' : 'Cancel'}
            </button>
            <button 
              type="button"
              className="settings-primary" 
              disabled={busy || !data || !hasChanges} 
              onClick={saveInstructions}
            >
              {lang === 'zh' ? '保存' : 'Save'}
            </button>
          </div>
        </div>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog
        open={dialogState?.type === 'confirm_delete_memories'}
        onOpenChange={(open) => !open && setDialogState(null)}
        title={lang === 'zh' ? '删除所有记忆' : 'Delete All Memories'}
      >
        <div className="delete-confirmation-dialog">
          <div className="confirmation-icon">
            <Trash2 size={32} />
          </div>
          <div className="confirmation-content">
            <p className="confirmation-text">
              {lang === 'zh' 
                ? '此操作将删除 Local 的所有 AX 记忆。原始会话历史会保留，无法撤销。'
                : 'This will delete all local AX memories. Raw session history will be kept. This action cannot be undone.'}
            </p>
          </div>

          <div className="dialog-actions">
            <button 
              type="button"
              className="settings-secondary" 
              onClick={() => setDialogState(null)}
              disabled={deletingMemory}
            >
              {lang === 'zh' ? '取消' : 'Cancel'}
            </button>
            <button 
              type="button"
              className="settings-danger" 
              onClick={confirmDeleteMemories}
              disabled={deletingMemory}
            >
              {deletingMemory ? (
                lang === 'zh' ? '删除中...' : 'Deleting...'
              ) : (
                <>
                  <Trash2 size={16} />
                  {lang === 'zh' ? '确认删除' : 'Confirm Delete'}
                </>
              )}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
