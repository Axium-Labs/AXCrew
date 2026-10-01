import * as Switch from '@radix-ui/react-switch'
import { useLang } from '../lib/i18n'
import type { AxLocalState } from '../lib/ax'
import './subagent-settings.css'

export function SubagentSettings({ value, disabled, onChange }: {
  value?: AxLocalState
  disabled: boolean
  onChange: (enabled: boolean) => void
}) {
  const zh = useLang(state => state.lang) === 'zh'
  const label = zh ? '子智能体（Subagent）' : 'Subagents'
  return <section className="settings-card subagent-settings">
    <div className="subagent-settings-row">
      <div><h2>{label}</h2><p>{zh
        ? '允许智能体按需委派独立任务。默认关闭。'
        : 'Allow the agent to delegate independent tasks when needed. Off by default.'}</p></div>
      <Switch.Root className="subagent-switch" aria-label={label}
        checked={value?.subagent_enabled ?? false} disabled={disabled || !value}
        onCheckedChange={onChange}><Switch.Thumb className="subagent-switch-thumb"/></Switch.Root>
    </div>
    <p className="subagent-settings-help">{zh
      ? '保存后从下一轮对话生效。开启后由模型自行判断是否使用子智能体。'
      : 'Saved changes apply on the next agent turn. The model decides whether to use subagents.'}</p>
  </section>
}
