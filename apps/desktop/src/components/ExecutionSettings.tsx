import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { useLang } from '../lib/i18n'
import type { AxLocalState } from '../lib/ax'
import './execution-settings.css'

type Props = {
  value?: AxLocalState
  disabled: boolean
  onChange: (environment?: AxLocalState['agent_environment'], shell?: AxLocalState['terminal_shell']) => void
}

function Choice({ label, value, disabled, options, onChange }: {
  label: string; value: string; disabled: boolean
  options: { value: string; label: string; description?: string; disabled?: boolean }[]
  onChange: (value: string) => void
}) {
  return <Select.Root value={value} disabled={disabled} onValueChange={onChange}>
    <Select.Trigger className="execution-select" aria-label={label}><Select.Value /><Select.Icon><ChevronDown size={16}/></Select.Icon></Select.Trigger>
    <Select.Portal><Select.Content className="execution-menu" position="popper" align="end" sideOffset={6}><Select.Viewport>
      {options.map(option => <Select.Item key={option.value} value={option.value} disabled={option.disabled} className="execution-option">
        <div><Select.ItemText>{option.label}</Select.ItemText>{option.description && <small>{option.description}</small>}</div>
        <Select.ItemIndicator><Check size={17}/></Select.ItemIndicator>
      </Select.Item>)}
    </Select.Viewport></Select.Content></Select.Portal>
  </Select.Root>
}

export function ExecutionSettings({ value, disabled, onChange }: Props) {
  const zh = useLang(state => state.lang) === 'zh'
  const windows = value?.windows === true
  const environmentLabel = zh ? '智能体环境' : 'Agent environment'
  const shellLabel = zh ? '集成终端 Shell' : 'Integrated terminal shell'
  return <section className="settings-card execution-settings">
    <div className="execution-row"><div><h2>{environmentLabel}</h2><p>{zh ? '选择智能体的运行位置' : 'Choose where the agent runs'}</p></div>
      <Choice label={environmentLabel} value={value?.agent_environment ?? 'native'} disabled={disabled || !value} onChange={choice => onChange(choice as AxLocalState['agent_environment'])} options={[
        { value: 'native', label: windows ? (zh ? 'Windows 原生' : 'Windows native') : (zh ? '本机原生' : 'Native'), description: zh ? '直接在本机运行智能体' : 'Run the agent directly on this computer' },
        { value: 'wsl', label: zh ? '适用于 Linux 的 Windows 子系统' : 'Windows Subsystem for Linux', description: zh ? '在默认 WSL 发行版中运行 Linux AX' : 'Run Linux AX in the default WSL distribution', disabled: !windows },
      ]}/>
    </div>
    <div className="execution-row"><div><h2>{shellLabel}</h2><p>{zh ? '选择要在集成终端中打开的 Shell' : 'Choose the shell opened in the integrated terminal'}</p></div>
      <Choice label={shellLabel} value={windows ? value?.terminal_shell ?? 'powershell' : 'sh'} disabled={disabled || !windows} onChange={choice => onChange(undefined, choice as AxLocalState['terminal_shell'])} options={windows ? [
        { value: 'powershell', label: 'PowerShell' }, { value: 'cmd', label: 'Command Prompt' }, { value: 'git_bash', label: 'Git Bash' }, { value: 'wsl', label: 'WSL' },
      ] : [{ value: 'sh', label: '/bin/sh' }]}/>
    </div>
    <p className="execution-help">{zh ? '更改对新启动的 AX 和新终端生效。WSL 需要在默认发行版的 ~/.local/bin/ax 安装 Linux 版 AX。' : 'Changes apply to new AX processes and terminals. WSL requires Linux AX at ~/.local/bin/ax in the default distribution.'}</p>
  </section>
}
