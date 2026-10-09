import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { axAvailable, axSubagentSettings, type AxSubagentSettings, type CapabilityScope } from '../lib/ax'
import { useLang } from '../lib/i18n'

function integer(text: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(text)) return null
  const value = Number(text)
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null
}

export function AgentDelegationSettings({ workspace, scope }: { workspace?: string; scope: CapabilityScope }) {
  const lang = useLang(state => state.lang), copy = (zh: string, en: string) => lang === 'zh' ? zh : en
  const client = useQueryClient(), key = ['ax-subagent-settings', workspace, scope]
  const query = useQuery({ queryKey: key, queryFn: () => axSubagentSettings(workspace!, scope), enabled: axAvailable && !!workspace, retry: false })
  const [depth, setDepth] = useState(''), [concurrent, setConcurrent] = useState('')
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4000); return () => window.clearTimeout(timer) }, [notice])
  useEffect(() => { if (query.data) { setDepth(String(query.data.max_depth)); setConcurrent(String(query.data.max_concurrent)) } }, [query.data])
  const maxDepth = integer(depth, 0), maxConcurrent = integer(concurrent, 1, 64)
  const dirty = !!query.data && (depth !== String(query.data.max_depth) || concurrent !== String(query.data.max_concurrent))
  const invalid = maxDepth === null || maxConcurrent === null
  const save = async (reset = false) => {
    if (!workspace || saving || (!reset && invalid)) return
    setSaving(true); setError(''); setNotice('')
    try {
      const settings: Partial<AxSubagentSettings> | undefined = reset ? undefined : {
        ...(maxDepth !== query.data?.max_depth ? { max_depth: maxDepth! } : {}),
        ...(maxConcurrent !== query.data?.max_concurrent ? { max_concurrent: maxConcurrent! } : {}),
      }
      const result = await axSubagentSettings(workspace, scope, settings, reset)
      client.setQueryData(key, result)
      setDepth(String(result.max_depth)); setConcurrent(String(result.max_concurrent))
      void client.invalidateQueries({ queryKey: ['ax-catalog'] })
      setNotice(copy('已保存，下一轮对话生效；正在运行的子任务继续执行。', 'Saved; applies on the next turn. Running children continue.'))
    } catch (reason) { setError(String(reason)) } finally { setSaving(false) }
  }
  return <section className="settings-card agent-delegation-settings" aria-label={copy('子智能体设置', 'Subagent settings')}>
    <div className="agent-delegation-heading"><h2>{copy('子智能体委派', 'Subagent delegation')}</h2>
      {query.data && <span className="settings-capability-tag">{query.data.max_depth === 0 ? copy('已关闭', 'Disabled') : copy(`已开启 · 最多 ${query.data.max_depth} 层`, `Enabled · up to ${query.data.max_depth} levels`)}</span>}</div>
    <p>{copy('由主智能体根据任务决定是否委派。0 关闭；1 只允许主智能体创建子智能体；2 或更大值允许继续向下委派。', 'The main agent decides when to delegate. 0 disables delegation; 1 permits direct children; 2 or more permits nested delegation.')}</p>
    {!workspace && <p>{copy('请先选择工作目录。', 'Select a workspace first.')}</p>}
    {query.isPending && axAvailable && workspace && <p role="status">{copy('正在读取子智能体设置…', 'Loading subagent settings…')}</p>}
    {query.error && <p role="alert" className="settings-notice is-error">{String(query.error)}</p>}
    {query.data && <>
      <div className="agent-delegation-fields">
        <label>{copy('最大递归深度', 'Maximum recursion depth')}<input aria-label={copy('最大递归深度', 'Maximum recursion depth')} type="number" min="0" step="1" value={depth} disabled={saving} aria-invalid={maxDepth === null} onChange={event => { setDepth(event.target.value); setNotice('') }}/>
          {maxDepth === null && <small>{copy('请输入不小于 0 的整数。', 'Enter a whole number of 0 or more.')}</small>}</label>
        <label>{copy('子智能体并行数量上限', 'Subagent parallelism limit')}<input aria-label={copy('子智能体并行数量上限', 'Subagent parallelism limit')} type="number" min="1" max="64" step="1" value={concurrent} disabled={saving} aria-invalid={maxConcurrent === null} onChange={event => { setConcurrent(event.target.value); setNotice('') }}/>
          {maxConcurrent === null && <small>{copy('请输入 1 到 64 的整数。', 'Enter a whole number from 1 to 64.')}</small>}</label>
      </div>
      <p className="agent-delegation-help">{copy('并行上限由所有委派层级共享，等待下层结果的子智能体也占用名额。', 'All delegation levels share the limit; children waiting for descendants still occupy slots.')}</p>
      <div className="settings-actions"><button type="button" disabled={!dirty || invalid || saving} onClick={() => void save()}>{copy(saving ? '保存中…' : '保存', saving ? 'Saving…' : 'Save')}</button>
        <button type="button" disabled={saving} onClick={() => void save(true)}>{copy(scope === 'project' ? '继承全局设置' : '恢复默认', scope === 'project' ? 'Inherit global settings' : 'Reset to default')}</button></div>
    </>}
    {error && <p role="alert" className="settings-notice is-error">{error}</p>}
    {notice && <p role="status" className="settings-notice">{notice}</p>}
  </section>
}
