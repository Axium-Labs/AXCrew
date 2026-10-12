import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { axAvailable, axGoalSettings, type AxGoalSettings, type CapabilityScope, type GoalValidator } from '../lib/ax'
import { useLang } from '../lib/i18n'
import { dollarsToMicrousd, microusdToDollars } from '../lib/goalBudget'
import { SettingsSelect } from './ui/settings-select'
import { SettingsToggle } from './ui/settings-toggle'
import { Disclosure } from './ui/disclosure'
import './goal-settings.css'

type Numeric = 'max_rounds' | 'max_seconds' | 'max_tokens' | 'max_cost_microusd' | 'stagnant_seconds' | 'max_stagnant_checks' | 'max_unobserved_checks' | 'input_microusd_per_million' | 'output_microusd_per_million'
const numbers: Numeric[] = ['max_rounds', 'max_seconds', 'max_tokens', 'max_cost_microusd', 'stagnant_seconds', 'max_stagnant_checks', 'max_unobserved_checks', 'input_microusd_per_million', 'output_microusd_per_million']
const integer = (text: string) => /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null
const isMoney = (name: Numeric) => name === 'max_cost_microusd' || name === 'input_microusd_per_million' || name === 'output_microusd_per_million'
type ValidatorDraft = { value: GoalValidator; timeout: string; input: string }

export function GoalSettings({ workspace }: { workspace?: string }) {
  const lang = useLang(state => state.lang), copy = (zh: string, en: string) => lang === 'zh' ? zh : en
  const [scope, setScope] = useState<CapabilityScope>('global'), [busy, setBusy] = useState(false)
  return <div className="settings-stack goal-settings">
    <section className="settings-card"><h2>{copy('目标默认策略', 'Goal defaults')}</h2>
      <p>{copy('开启后，普通对话的新任务也会使用目标策略。已创建的目标保留自己的规则。', 'When enabled, new tasks in ordinary chats also use Goal policies. Existing Goals retain their own rules.')}</p>
      <SettingsSelect label={copy('设置范围', 'Settings scope')} value={scope} disabled={busy} onChange={value => setScope(value as CapabilityScope)} options={[{ value: 'global', label: copy('全局默认', 'Global defaults') }, { value: 'project', label: copy('当前项目', 'Current project') }]}/>
    </section>
    <GoalPolicy key={JSON.stringify([workspace, scope])} workspace={workspace} scope={scope} onBusy={setBusy}/>
  </div>
}

function GoalPolicy({ workspace, scope, onBusy }: { workspace?: string; scope: CapabilityScope; onBusy: (value: boolean) => void }) {
  const lang = useLang(state => state.lang), copy = (zh: string, en: string) => lang === 'zh' ? zh : en
  const client = useQueryClient(), key = ['ax-goal-settings', scope, scope === 'project' ? workspace : '']
  const query = useQuery({ queryKey: key, queryFn: () => axGoalSettings(workspace, scope), enabled: axAvailable && (scope === 'global' || !!workspace), retry: false })
  const [draft, setDraft] = useState<AxGoalSettings>(), [numeric, setNumeric] = useState<Partial<Record<Numeric, string>>>({}), [validators, setValidators] = useState<ValidatorDraft[]>([])
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const mounted = useRef(true), locked = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onBusy(false) } }, [onBusy])
  const populate = (value: AxGoalSettings) => {
    setDraft(value); setNumeric(Object.fromEntries(numbers.map(name => [name, value[name] == null ? '' : isMoney(name) ? microusdToDollars(value[name]) : String(value[name])])))
    setValidators(value.validators.map(value => ({ value, timeout: String(value.timeout_seconds), input: value.kind === 'host' ? JSON.stringify(value.input, null, 2) : '{}' })))
  }
  useEffect(() => { if (query.data) populate(query.data) }, [query.data])
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4000); return () => window.clearTimeout(timer) }, [notice])
  let candidate: AxGoalSettings | undefined, invalid = false
  if (draft) {
    candidate = { ...draft, acceptance: draft.acceptance.map(line => line.trim()).filter(Boolean), deliverables: draft.deliverables.map(line => line.trim()).filter(Boolean), required_successful_calls: draft.required_successful_calls.map(line => line.trim()).filter(Boolean), validators: [] }
    for (const name of numbers) {
      const optional = name === 'input_microusd_per_million' || name === 'output_microusd_per_million'
      const text = numeric[name] ?? '', value = optional && text === '' ? null : isMoney(name) ? dollarsToMicrousd(text) : integer(text)
      if (value === null && !(optional && text === '')) invalid = true
      if (optional) candidate[name] = value
      else candidate[name] = value ?? 0
    }
    const ids = new Set<string>()
    for (const row of validators) {
      const timeout = integer(row.timeout), value = { ...row.value, timeout_seconds: timeout ?? 0 }
      if (!value.id.trim() || !value.version.trim() || ids.has(value.id) || !timeout || timeout > 86400) invalid = true
      ids.add(value.id)
      if (value.kind === 'command' && (!value.command.trim() || !value.reference.trim())) invalid = true
      if (value.kind === 'http') { try { const url = new URL(value.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) invalid = true } catch { invalid = true } }
      if (value.kind === 'host') {
        try {
          const input: unknown = JSON.parse(row.input)
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(name => name.startsWith('_ax_') || name === '$tool_result' || name === 'ax_goal')) invalid = true
          else value.input = input as Record<string, unknown>
        } catch { invalid = true }
        if (!value.tool.trim()) invalid = true
      }
      candidate.validators.push(value)
    }
  }
  const dirty = candidate && query.data && JSON.stringify(candidate) !== JSON.stringify(query.data)
  const save = async (reset = false) => {
    if (locked.current || (!reset && (invalid || !candidate))) return
    locked.current = true; setSaving(true); onBusy(true); setError(''); setNotice('')
    try {
      const result = await axGoalSettings(workspace, scope, reset ? undefined : candidate, reset)
      client.setQueryData(key, result)
      if (scope === 'global') void client.invalidateQueries({ queryKey: ['ax-goal-settings', 'project'] })
      if (mounted.current) { populate(result); setNotice(copy('已保存，将应用于新任务和新创建的目标。', 'Saved; applies to new tasks and newly created Goals.')) }
    } catch (reason) { if (mounted.current) setError(String(reason)) }
    finally { locked.current = false; if (mounted.current) { setSaving(false); onBusy(false) } }
  }
  const edit = (patch: Partial<AxGoalSettings>) => { setDraft(value => value && ({ ...value, ...patch })); setNotice('') }
  const editValidator = (index: number, row: Partial<ValidatorDraft>) => { setValidators(values => values.map((value, i) => i === index ? { ...value, ...row } : value)); setNotice('') }
  const labels: Record<Numeric, string> = {
    max_rounds: copy('累计轮次上限', 'Cumulative round limit'), max_seconds: copy('累计执行秒数上限', 'Active time limit (seconds)'), max_tokens: copy('Token 上限', 'Token limit'), max_cost_microusd: copy('费用上限（美元）', 'Cost limit (USD)'),
    stagnant_seconds: copy('无进展观察秒数', 'Idle observation interval (seconds)'), max_stagnant_checks: copy('无进展观察次数', 'Unchanged observations'), max_unobserved_checks: copy('证据不明的观察次数上限', 'Unknown evidence observation limit'),
    input_microusd_per_million: copy('输入估算单价（美元 / 百万 Token）', 'Estimated input rate (USD / million tokens)'), output_microusd_per_million: copy('输出估算单价（美元 / 百万 Token）', 'Estimated output rate (USD / million tokens)'),
  }
  const numericField = (name: Numeric) => <label key={name}>{labels[name]}<input aria-label={labels[name]} type="text" inputMode={isMoney(name) ? 'decimal' : 'numeric'} value={numeric[name] ?? ''} disabled={saving} onChange={event => { setNumeric(values => ({ ...values, [name]: event.target.value })); setNotice('') }}/></label>
  if (!axAvailable) return <section className="settings-card"><p>{copy('请在 AXCrew 桌面应用中配置本机 AX。', 'Configure local AX in the AXCrew desktop app.')}</p></section>
  if (scope === 'project' && !workspace) return <section className="settings-card"><p>{copy('请选择工作目录后配置项目策略。', 'Choose a workspace to configure project policies.')}</p></section>
  return <>
    {query.isPending && <p role="status">{copy('正在读取目标策略…', 'Loading Goal policy…')}</p>}
    {query.error && <section className="settings-card" role="alert"><p>{String(query.error)}</p><button disabled={query.isFetching} onClick={() => void query.refetch()}>{copy('重试', 'Retry')}</button></section>}
    {draft && <>
      <section className="settings-card"><SettingsToggle label={copy('开启目标', 'Enable Goal')} description={copy('让普通对话自动使用当前范围的目标策略。关闭后恢复普通执行并保留规则；点击保存策略生效。', 'Automatically use this scope’s Goal policy in ordinary chats. Disabling restores ordinary execution and retains rules; save the policy to apply.')} checked={draft.enabled} disabled={saving} onChange={event => edit({ enabled: event.target.checked })}/></section>
      <section className="settings-card goal-policy-card"><Disclosure title={copy('验收规则', 'Acceptance rules')}><div className="goal-fields">
        <label>{copy('验证方式', 'Verification mode')}<SettingsSelect label={copy('验证方式', 'Verification mode')} value={draft.mode} disabled={saving} onChange={value => edit({ mode: value as AxGoalSettings['mode'] })} options={[{ value: 'off', label: copy('创建时默认模型验证', 'Model verification at creation') }, { value: 'deterministic', label: copy('确定性验证', 'Deterministic') }, { value: 'model', label: copy('模型验证', 'Model verification') }]}/></label>
        <label>{copy('条件组合', 'Condition combination')}<SettingsSelect label={copy('条件组合', 'Condition combination')} value={draft.validation_combination} disabled={saving} onChange={value => edit({ validation_combination: value as AxGoalSettings['validation_combination'] })} options={[{ value: 'all', label: copy('全部满足', 'All conditions') }, { value: 'any', label: copy('任意满足', 'Any condition') }]}/></label>
        {(['acceptance', 'deliverables', 'required_successful_calls'] as const).map((name, i) => { const title = [copy('验收要求（每行一项）', 'Acceptance criteria (one per line)'), copy('交付文件（可选，每行一个路径）', 'Deliverables (optional paths, one per line)'), copy('成功工具调用 ID（可选）', 'Successful tool call IDs (optional)')][i]; return <label key={name}>{title}<textarea aria-label={title} value={draft[name].join('\n')} disabled={saving} onChange={event => edit({ [name]: event.target.value.split('\n') })}/></label> })}
      </div><p>{copy('模型验证保留独立评估；自定义规则通过后还会应用所选方式和文件条件。权限拒绝、阻塞或失败不能被“任意满足”掩盖。', 'Model verification keeps its independent evaluation. The selected verifier and file conditions run after custom acceptance. Any condition cannot mask denied permissions, blockers or failures.')}</p></Disclosure></section>
      <section className="settings-card goal-policy-card"><Disclosure title={copy('自定义验证器', 'Custom validators')}><p>{copy('Command 使用现有终端沙箱，HTTP 使用现有 Web 权限，宿主验证器调用已注册工具。保存配置不会执行验证器。', 'Command uses the terminal sandbox, HTTP uses Web permissions, and host validators invoke registered tools. Saving does not execute validators.')}</p>
        {validators.map((row, index) => {
          const value = row.value, label = (zh: string, en: string) => `${copy(zh, en)} ${index + 1}`
          const field = (name: 'id' | 'version', title: string) => <label>{title}<input aria-label={title} value={value[name]} disabled={saving} onChange={event => editValidator(index, { value: { ...value, [name]: event.target.value } })}/></label>
          return <fieldset className="goal-validator" key={index} disabled={saving}><legend>{copy(`验证器 ${index + 1}`, `Validator ${index + 1}`)}</legend><div className="goal-fields">
            {field('id', label('标识', 'ID'))}{field('version', label('版本', 'Version'))}
            <label>{label('类型', 'Type')}<SettingsSelect label={label('类型', 'Type')} value={value.kind} disabled={saving} options={[{ value: 'command', label: 'Command' }, { value: 'http', label: 'HTTP GET' }, { value: 'host', label: copy('宿主工具 / MCP', 'Host tool / MCP') }]} onChange={kind => { const base = { id: value.id, version: value.version, timeout_seconds: value.timeout_seconds, replay_safe: false }; editValidator(index, { value: kind === 'command' ? { ...base, kind, command: '', reference: '' } : kind === 'http' ? { ...base, kind, url: '' } : { ...base, kind: 'host', tool: '', input: {} }, input: '{}' }) }}/></label>
            <label>{label('超时（秒）', 'Timeout (seconds)')}<input aria-label={label('超时（秒）', 'Timeout (seconds)')} inputMode="numeric" value={row.timeout} onChange={event => editValidator(index, { timeout: event.target.value })}/></label>
            {value.kind === 'command' && <><label>{label('命令', 'Command')}<textarea aria-label={label('命令', 'Command')} value={value.command} onChange={event => editValidator(index, { value: { ...value, command: event.target.value } })}/></label><label>{label('验证程序引用文件', 'Verifier reference file')}<input aria-label={label('验证程序引用文件', 'Verifier reference file')} value={value.reference} onChange={event => editValidator(index, { value: { ...value, reference: event.target.value } })}/></label></>}
            {value.kind === 'http' && <label>{label('服务地址', 'Endpoint')}<input aria-label={label('服务地址', 'Endpoint')} value={value.url} onChange={event => editValidator(index, { value: { ...value, url: event.target.value } })}/></label>}
            {value.kind === 'host' && <><label>{label('工具名称', 'Tool name')}<input aria-label={label('工具名称', 'Tool name')} value={value.tool} onChange={event => editValidator(index, { value: { ...value, tool: event.target.value } })}/></label><label>{label('工具参数 JSON', 'Tool input JSON')}<textarea aria-label={label('工具参数 JSON', 'Tool input JSON')} value={row.input} onChange={event => editValidator(index, { input: event.target.value })}/></label></>}
          </div>{value.kind !== 'http' && <SettingsToggle label={label('允许中断后重放', 'Allow replay after interruption')} description={copy('仅在此验证器重复执行不会产生重复副作用时开启。', 'Enable only when repeated execution cannot duplicate side effects.')} checked={value.replay_safe} onChange={event => editValidator(index, { value: { ...value, replay_safe: event.target.checked } })}/>}
            <button type="button" onClick={() => setValidators(values => values.filter((_, i) => i !== index))}>{copy('移除验证器', 'Remove validator')}</button></fieldset>
        })}
        <button disabled={saving} onClick={() => { let id = validators.length + 1; while (validators.some(row => row.value.id === `validator-${id}`)) id++; setValidators(values => [...values, { value: { id: `validator-${id}`, version: '1', timeout_seconds: 30, replay_safe: false, kind: 'command', command: '', reference: '' }, timeout: '30', input: '{}' }]) }}>{copy('添加验证器', 'Add validator')}</button>
      </Disclosure></section>
      <section className="settings-card goal-policy-card"><Disclosure title={copy('执行预算', 'Execution budget')}><p>{copy('上限填 0 表示不追加限制。运行时强制限制累计轮次和时间；Token 与费用上限仅在实测用量完整时生效，估算与不可用数据会如实标注。', 'A limit of 0 adds no cap. Runtime enforces cumulative rounds and time. Token and cost caps require complete measured usage; estimates and unavailable data remain labeled.')}</p><div className="goal-fields">{numbers.slice(0, 4).map(numericField)}{numbers.slice(7).map(numericField)}</div><p>{copy('费用以美元填写，例如 1.5 表示 1.5 美元；单价为每百万 Token 的美元费用，留空表示未配置，填 0 表示免费。金额最多支持 6 位小数。', 'Enter costs in USD: 1.5 means $1.50. Rates are USD per million tokens; leave blank if unknown, or enter 0 for free. Amounts support up to 6 decimal places.')}</p></Disclosure></section>
      <section className="settings-card goal-policy-card"><Disclosure title={copy('进展观察与恢复', 'Progress and recovery')}><div className="goal-fields">{numbers.slice(4, 7).map(numericField)}<label>{copy('无法确认进展时', 'When progress is unconfirmed')}<SettingsSelect label={copy('无法确认进展时', 'When progress is unconfirmed')} value={draft.stagnation_action} disabled={saving} onChange={value => edit({ stagnation_action: value as AxGoalSettings['stagnation_action'] })} options={[{ value: 'pause', label: copy('暂停并保留状态', 'Pause and retain state') }, { value: 'request_human', label: copy('请求人工介入', 'Request human intervention') }]}/></label></div><p>{copy('默认保守观察长任务。已观测到外部工作时保留状态，等待用户或宿主明确恢复；未知证据不直接判定失败。单机恢复不代表后台继续执行，跨机器接管由 AXCrew 的 Durable Task 和租约负责。', 'Long tasks use conservative observations. Observed external work retains state for explicit user or host resume; unknown evidence does not imply failure. Local recovery does not start background execution. AXCrew Durable Tasks and leases own cross-machine takeover.')}</p></Disclosure></section>
      <section className="settings-card"><div className="settings-actions"><button disabled={!dirty || invalid || saving} onClick={() => void save()}>{copy(saving ? '保存中…' : '保存策略', saving ? 'Saving…' : 'Save policy')}</button><button disabled={saving} onClick={() => void save(true)}>{copy(scope === 'project' ? '继承全局策略' : '恢复默认策略', scope === 'project' ? 'Inherit global policy' : 'Reset default policy')}</button></div>{invalid && <p role="alert">{copy('请检查非负整数、美元金额（最多 6 位小数）、唯一标识、版本、1–86400 秒超时及验证器参数。', 'Check nonnegative whole numbers, USD amounts (up to 6 decimal places), unique IDs, versions, 1–86400 second deadlines and validator parameters.')}</p>}{error && <p role="alert" className="settings-notice is-error">{error}</p>}{notice && <p role="status" className="settings-notice">{notice}</p>}</section>
    </>}
  </>
}
