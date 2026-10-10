import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingsToggle } from './ui/settings-toggle'
import { axAvailable, axComputerUse, type ComputerUseSettings } from '../lib/ax'
import { useLang } from '../lib/i18n'
import { HostPermissionsPanel } from './HostPermissionsPanel'

function LimitField({ label, description, value, min, max, disabled, onSave, invalidMessage }: {
  label: string; description: string; value: number; min: number; max: number; disabled: boolean
  onSave: (value: number) => void; invalidMessage: string
}) {
  const id = useId(), [draft, setDraft] = useState(String(value)), [invalid, setInvalid] = useState(false)
  useEffect(() => { setDraft(String(value)); setInvalid(false) }, [value])
  const save = () => {
    const next = Number(draft)
    if (!draft.trim() || !Number.isInteger(next) || next < min || next > max) { setInvalid(true); return }
    setInvalid(false)
    if (next !== value) onSave(next)
  }
  return <div className="computer-use-field">
    <label htmlFor={id}>{label}</label>
    <p id={`${id}-description`}>{description}</p>
    <input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} value={draft} disabled={disabled}
      aria-describedby={`${id}-description${invalid ? ` ${id}-error` : ''}`} aria-invalid={invalid}
      onChange={event => { setDraft(event.target.value); setInvalid(false) }} onBlur={save}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/>
    {invalid && <div id={`${id}-error`} className="settings-error" role="alert">{invalidMessage} ({min}–{max})</div>}
  </div>
}

export function AxDesktopControl() {
  const zh = useLang(state => state.lang) === 'zh'
  const client = useQueryClient()
  const state = useQuery({ queryKey: ['ax-computer-use'], queryFn: () => axComputerUse(), enabled: axAvailable, retry: false })
  const save = useMutation({
    mutationFn: (patch: Partial<ComputerUseSettings>) => axComputerUse(patch),
    onSuccess: data => client.setQueryData(['ax-computer-use'], data),
  })
  if (!axAvailable) return <div className="settings-stack"><section className="settings-card"><p>{zh ? '请在 AXCrew 桌面端设置 Computer Use。' : 'Configure Computer Use in the AXCrew desktop app.'}</p></section></div>
  if (state.isPending) return <div className="settings-stack"><section className="settings-card" aria-busy="true"><p>{zh ? '正在读取 Computer Use 设置…' : 'Loading Computer Use settings…'}</p></section></div>
  if (!state.data) return <div className="settings-stack"><section className="settings-card"><p role="alert">{String(state.error)}</p><button className="settings-secondary" onClick={() => void state.refetch()}>{zh ? '重试' : 'Retry'}</button></section></div>
  const { settings, limits, supported } = state.data
  const busy = save.isPending
  return <div className="settings-stack computer-use-settings" aria-busy={busy}>
    <div className="computer-use-heading"><h2>Computer Use</h2><span>{zh ? '焦点 + 光标' : 'Focus + cursor'}</span></div>
    <section className="settings-card computer-use-switches">
      <SettingsToggle label={zh ? '启用 Computer Use' : 'Enable Computer Use'}
        description={zh ? '让代理通过辅助功能读取桌面应用的窗口，并操作它们的控件。在这里打开之前一直是关闭的；更改将在下一轮对话生效。' : 'Let agents read desktop windows through accessibility and operate their controls. Disabled until enabled here; changes apply on the next turn.'}
        checked={settings.enabled} disabled={busy || (!supported && !settings.enabled)} onChange={event => save.mutate({ enabled: event.target.checked })}/>
      <SettingsToggle label={zh ? '附带截图' : 'Include screenshots'}
        description={zh ? '同时截取目标窗口并传递它的文件路径。辅助功能树仍是主要通道；检测到密码字段或无法完成检查时，不会截取窗口。' : 'Capture the target window and return its file path. Accessibility remains the primary channel; windows with password fields or an incomplete privacy scan are not captured.'}
        checked={settings.include_screenshot} disabled={busy} onChange={event => save.mutate({ include_screenshot: event.target.checked })}/>
    </section>
    {!supported && <p className="computer-use-notice">{zh ? 'Computer Use 目前需要 Windows 原生环境。' : 'Computer Use currently requires native Windows.'}</p>}
    {save.error && <div className="settings-error" role="alert">{String(save.error)}</div>}
    <div className="computer-use-heading"><h2>{zh ? '上限' : 'Limits'}</h2></div>
    <section className="settings-card computer-use-limits">
      <p>{zh ? '代理一次读取窗口的多少内容。这些是成本和速度的调节项，不是安全设置，每个值都不会超出内置上限。除非窗口太大、一次读不完，或者截图感觉变慢，否则不用改动。' : 'Adjust how much of a window the agent reads at once. These tune cost and speed, within built-in limits. Leave the defaults unless a window is too large to read or screenshots feel slow.'}</p>
      <LimitField label={zh ? '树节点上限' : 'Tree node limit'}
        description={zh ? '一次窗口读取最多返回多少个控件。超过这个数量的窗口会被截断，并会告知代理。控件密集的应用（表格、IDE）可以调高；想减少每次读取消耗的 token 就调低。' : 'Maximum controls returned per read. Larger trees are truncated and reported to the agent. Increase for dense tables or IDEs; decrease to reduce token usage.'}
        value={settings.max_nodes} min={1} max={limits.max_nodes} disabled={busy} onSave={max_nodes => save.mutate({ max_nodes })} invalidMessage={zh ? '请输入范围内的整数' : 'Enter an integer in range'}/>
      <LimitField label={zh ? '截图宽度' : 'Screenshot width'}
        description={zh ? '截图最长边的像素数。越小越省钱、读得越快；越大，小字就越清晰可读。截图保持原始比例，不会放大小窗口。' : 'Maximum pixels on the longest edge, preserving aspect ratio. Smaller images are faster and cheaper; larger images keep small text clearer. Small windows are not enlarged.'}
        value={settings.screenshot_width} min={limits.min_screenshot_width} max={limits.max_screenshot_width} disabled={busy} onSave={screenshot_width => save.mutate({ screenshot_width })} invalidMessage={zh ? '请输入范围内的整数' : 'Enter an integer in range'}/>
    </section>
    <HostPermissionsPanel surface="computer"/>
  </div>
}
