import { SettingsToggle } from './ui/settings-toggle'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLang } from '../lib/i18n'
import { endpoints } from '../lib/api'
import { Monitor, Keyboard, Mouse, AlertCircle, Check } from 'lucide-react'
import type { ReactNode } from 'react'

type ControlCommand = 'screenshot' | 'click' | 'type' | 'scroll' | 'key' | 'move'

function Panel({title, children}: {title: string; children: ReactNode}) {
  return <section className="settings-card"><h2>{title}</h2>{children}</section>
}

export function AxDesktopControl() {
  const lang = useLang(s => s.lang)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  // 获取桌面信息
  const desktopInfo = useQuery({
    queryKey: ['ax-desktop-info'],
    queryFn: async () => {
      const response = await endpoints.health()
      return {
        status: 'connected',
        version: response.version,
      }
    },
    retry: false
  })

  const setNotice = (msg: string, error = false) => {
    setMessage(msg)
    setIsError(error)
    setTimeout(() => setMessage(''), 4000)
  }

  const executeCommand = async (command: ControlCommand, _params?: Record<string, unknown>) => {
    setBusy(true)
    setMessage('')
    try {
      // 这里会调用对应的 AX 命令
      // const result = await invoke<ControlResult>('execute_desktop_command', {command, params})
      // 暂时模拟
      const messages: Record<ControlCommand, string> = {
        screenshot: lang === 'zh' ? '截图已保存' : 'Screenshot saved',
        click: lang === 'zh' ? '点击完成' : 'Click done',
        type: lang === 'zh' ? '输入完成' : 'Typed',
        scroll: lang === 'zh' ? '滚动完成' : 'Scrolled',
        key: lang === 'zh' ? '按键完成' : 'Key pressed',
        move: lang === 'zh' ? '移动完成' : 'Moved'
      }
      setNotice(messages[command])
      await new Promise(resolve => setTimeout(resolve, 500))
    } catch (error) {
      setNotice(String(error), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-stack">
      {/* 连接状态 */}
      <Panel title={lang === 'zh' ? '连接状态' : 'Connection Status'}>
        <div className="settings-health">
          <span className="is-online" />
          <strong>{lang === 'zh' ? '已连接' : 'Connected'}</strong>
          <small>v{desktopInfo.data?.version || '—'}</small>
        </div>
      </Panel>

      {/* 基础控制 */}
      <Panel title={lang === 'zh' ? '基础操作' : 'Basic Operations'}>
        <p style={{fontSize: '12px', color: 'var(--session-muted)', marginBottom: '16px'}}>
          {lang === 'zh'
            ? '直接控制桌面设备的输入和输出。这些操作可以帮助你在 AI 协助下进行自动化任务。'
            : 'Directly control input and output of desktop devices. These operations help automate tasks with AI assistance.'}
        </p>
        <div className="ax-control-grid">
          <button
            className="ax-control-card"
            disabled={busy}
            onClick={() => void executeCommand('screenshot')}
          >
            <Monitor size={24} />
            <strong>{lang === 'zh' ? '截屏' : 'Screenshot'}</strong>
            <small>{lang === 'zh' ? '获取当前屏幕' : 'Capture screen'}</small>
          </button>

          <button
            className="ax-control-card"
            disabled={busy}
            onClick={() => void executeCommand('click')}
          >
            <Mouse size={24} />
            <strong>{lang === 'zh' ? '点击' : 'Click'}</strong>
            <small>{lang === 'zh' ? '在指定位置点击' : 'Click at position'}</small>
          </button>

          <button
            className="ax-control-card"
            disabled={busy}
            onClick={() => void executeCommand('type')}
          >
            <Keyboard size={24} />
            <strong>{lang === 'zh' ? '输入文本' : 'Type'}</strong>
            <small>{lang === 'zh' ? '输入字符或命令' : 'Input text/command'}</small>
          </button>

          <button
            className="ax-control-card"
            disabled={busy}
            onClick={() => void executeCommand('key')}
          >
            <Keyboard size={24} />
            <strong>{lang === 'zh' ? '按键' : 'Key Press'}</strong>
            <small>{lang === 'zh' ? '按下特殊键' : 'Press special key'}</small>
          </button>

          <button
            className="ax-control-card"
            disabled={busy}
            onClick={() => void executeCommand('move')}
          >
            <Mouse size={24} />
            <strong>{lang === 'zh' ? '移动鼠标' : 'Move Mouse'}</strong>
            <small>{lang === 'zh' ? '移动到指定位置' : 'Move to position'}</small>
          </button>

          <button
            className="ax-control-card"
            disabled={busy}
            onClick={() => void executeCommand('scroll')}
          >
            <Mouse size={24} />
            <strong>{lang === 'zh' ? '滚动' : 'Scroll'}</strong>
            <small>{lang === 'zh' ? '滚动页面内容' : 'Scroll page'}</small>
          </button>
        </div>

        {message && (
          <div className={`settings-notice ${isError ? 'is-error' : 'is-success'}`}>
            {isError ? <AlertCircle size={16} /> : <Check size={16} />}
            <span>{message}</span>
          </div>
        )}
      </Panel>

      {/* 高级设置 */}
      <Panel title={lang === 'zh' ? '高级设置' : 'Advanced Settings'}>
        <div className="settings-field-row">
          <span>{lang === 'zh' ? '鼠标延迟' : 'Mouse Delay'}</span>
          <input type="number" defaultValue="100" min="0" max="1000" placeholder="ms"
            style={{width: '60px', padding: '6px', borderRadius: '4px', border: '1px solid var(--session-border)'}} />
        </div>

        <div className="settings-field-row">
          <span>{lang === 'zh' ? '输入延迟' : 'Input Delay'}</span>
          <input type="number" defaultValue="50" min="0" max="500" placeholder="ms"
            style={{width: '60px', padding: '6px', borderRadius: '4px', border: '1px solid var(--session-border)'}} />
        </div>

        <SettingsToggle label={lang === 'zh' ? '启用操作记录' : 'Enable action logging'} description={lang === 'zh' ? '记录所有操作用于调试' : 'Log actions for debugging'} defaultChecked/>
      </Panel>

      {/* 注意事项 */}
      <Panel title={lang === 'zh' ? '使用说明' : 'Usage Tips'}>
        <ul style={{fontSize: '12px', lineHeight: '1.6', color: 'var(--session-text)', margin: 0, paddingLeft: '20px'}}>
          <li>{lang === 'zh'
            ? '这些功能需要 AX 在后台运行，支持对计算机的自动化操控'
            : 'These features require AX running in background for desktop automation'}</li>
          <li>{lang === 'zh'
            ? '操作会在系统层面执行，请确保已充分授权'
            : 'Operations execute at system level; ensure proper permissions'}</li>
          <li>{lang === 'zh'
            ? '可与 AI 协助结合，自动化完成复杂任务'
            : 'Combine with AI assistance for automated task automation'}</li>
          <li>{lang === 'zh'
            ? '所有操作都会被记录，便于事后查看和调试'
            : 'All actions are logged for later review and debugging'}</li>
        </ul>
      </Panel>
    </div>
  )
}
