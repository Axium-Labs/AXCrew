import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { open } from '@tauri-apps/plugin-dialog'
import { Trash2, FolderOpen } from 'lucide-react'
import { call as invoke } from '../lib/errors'
import { translate, useLang } from '../lib/i18n'
import { axAvailable, axLocalState } from '../lib/ax'

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

export function Personalization() {
  const lang = useLang(state => state.lang)
  const query = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeError, setNoticeError] = useState(false)

  const state = useQuery({
    queryKey: ['personalization'],
    queryFn: () => axPersonalize({}),
    enabled: axAvailable,
    retry: false,
  })

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

  const clearMemories = useCallback(async () => {
    if (!confirm(lang === 'zh' ? '删除所有本机 AX 记忆？原始会话历史会保留。' : 'Delete all local AX memories? Raw session history will be kept.')) return
    await save({ clearMemories: true })
  }, [save, lang])

  const data = state.data

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <h2>{lang === 'zh' ? '记忆' : 'Memory'}</h2>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={data?.memory_enabled ?? true}
            disabled={busy || !data}
            onChange={e => void save({ memory: e.target.checked })}
          />
          {lang === 'zh' ? '启用记忆' : 'Enable memory'}
          <small>{lang === 'zh' ? '保存和检索个人偏好、项目事实和会话临时记录' : 'Store and retrieve personal preferences, project facts, and session notes'}</small>
        </label>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={data?.tool_memory ?? true}
            disabled={busy || !data}
            onChange={e => void save({ toolMemory: e.target.checked })}
          />
          {lang === 'zh' ? '允许工具使用记忆' : 'Allow tool-driven memory'}
          <small>{lang === 'zh' ? '让 AX 可以通过工具主动创建记忆并从完成的工作中学习' : 'Let AX create memories through tools and learn from completed work'}</small>
        </label>
        <div className="settings-actions">
          <button className="settings-danger" disabled={busy || !data} onClick={clearMemories}>
            <Trash2 size={16} /> {lang === 'zh' ? '删除所有记忆' : 'Delete all memories'}
          </button>
          {data?.cleared_memories !== undefined && <span className="settings-provider-status">{lang === 'zh' ? `已删除 ${data.cleared_memories} 条记录` : `Deleted ${data.cleared_memories} records`}</span>}
        </div>
      </section>

      <section className="settings-card">
        <h2>{lang === 'zh' ? '自定义指令' : 'Custom instructions'}</h2>
        <p>{lang === 'zh' ? '对所有 AX 会话生效的全局指令' : 'Global instructions applied to every AX session'}</p>
        <textarea
          className="settings-textarea"
          value={data?.instructions ?? ''}
          disabled={busy || !data}
          placeholder={lang === 'zh' ? '例如：用中文回答；解释要简洁；代码保持英文注释' : 'Example: Answer in English; keep explanations brief; use English comments in code'}
          rows={6}
          onChange={async e => {
            const text = e.target.value
            const temp = `${data?.instructions_path ?? ''}.tmp`
            await invoke('write_file', { path: temp, content: text })
            await save({ instructionsFile: temp, expectedInstructionsFile: data?.instructions_path })
          }}
        />
      </section>

      <section className="settings-card">
        <h2>{lang === 'zh' ? '写作' : 'Writing'}</h2>
        <p>{lang === 'zh' ? 'AX 写作时参考你自己文档的语气和风格' : 'AX matches the tone and style of your own documents when writing'}</p>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={data?.writing_enabled ?? false}
            disabled={busy || !data}
            onChange={e => void save({ writing: e.target.checked })}
          />
          {lang === 'zh' ? '参考我的写作风格' : 'Reference my writing style'}
        </label>
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

      {state.error && <div className="settings-notice is-error" role="alert">{lang === 'zh' ? '无法读取个性化设置：' : 'Could not load personalization settings: '}{String(state.error)}</div>}
      {notice && <div className={`settings-notice${noticeError ? ' is-error' : ''}`} role={noticeError ? 'alert' : 'status'}>{notice}</div>}
    </div>
  )
}
