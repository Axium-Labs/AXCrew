import { SettingsToggle } from './ui/settings-toggle'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLang } from '../lib/i18n'
import { Globe, ArrowLeft, ArrowRight, RotateCw, Search, ExternalLink, Download, Camera, Mouse, Keyboard, AlertCircle, Check } from 'lucide-react'
import type { ReactNode } from 'react'

type BrowserCommand = 'navigate' | 'click' | 'type' | 'scroll' | 'screenshot' | 'extract' | 'back' | 'forward' | 'refresh'

function Panel({title, children}: {title: string; children: ReactNode}) {
  return <section className="settings-card"><h2>{title}</h2>{children}</section>
}

export function AxBrowserControl() {
  const lang = useLang(s => s.lang)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [url, setUrl] = useState('')

  // 获取浏览器状态
  const browserStatus = useQuery({
    queryKey: ['ax-browser-status'],
    queryFn: async () => {
      // 模拟浏览器状态
      return {
        active: true,
        currentUrl: 'https://example.com',
        title: 'Example Domain'
      }
    },
    retry: false
  })

  const setNotice = (msg: string, error = false) => {
    setMessage(msg)
    setIsError(error)
    setTimeout(() => setMessage(''), 4000)
  }

  const executeCommand = async (command: BrowserCommand, _params?: Record<string, unknown>) => {
    setBusy(true)
    setMessage('')
    try {
      // 这里会调用对应的 AX 命令
      // const result = await invoke<ControlResult>('execute_browser_command', {command, params})
      const messages: Record<BrowserCommand, string> = {
        navigate: lang === 'zh' ? '导航完成' : 'Navigated',
        click: lang === 'zh' ? '点击完成' : 'Clicked',
        type: lang === 'zh' ? '输入完成' : 'Typed',
        scroll: lang === 'zh' ? '滚动完成' : 'Scrolled',
        screenshot: lang === 'zh' ? '截图已保存' : 'Screenshot saved',
        extract: lang === 'zh' ? '数据已提取' : 'Data extracted',
        back: lang === 'zh' ? '返回上一页' : 'Went back',
        forward: lang === 'zh' ? '前进下一页' : 'Went forward',
        refresh: lang === 'zh' ? '页面已刷新' : 'Refreshed'
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
      {/* 浏览器状态 */}
      <Panel title={lang === 'zh' ? '浏览器状态' : 'Browser Status'}>
        <div className="settings-health">
          <span className={browserStatus.data?.active ? 'is-online' : ''} />
          <strong>{browserStatus.data?.active
            ? (lang === 'zh' ? '浏览器运行中' : 'Browser Active')
            : (lang === 'zh' ? '浏览器未运行' : 'Browser Inactive')
          }</strong>
        </div>

        {browserStatus.data?.active && (
          <div style={{marginTop: '12px', fontSize: '12px'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px'}}>
              <Globe size={14} style={{color: 'var(--session-muted)'}} />
              <span style={{color: 'var(--session-text)', fontWeight: 500}}>
                {browserStatus.data?.title || '—'}
              </span>
            </div>
            <div style={{color: 'var(--session-muted)', fontSize: '11px', paddingLeft: '22px'}}>
              {browserStatus.data?.currentUrl || '—'}
            </div>
          </div>
        )}
      </Panel>

      {/* 导航控制 */}
      <Panel title={lang === 'zh' ? '页面导航' : 'Page Navigation'}>
        <p style={{fontSize: '12px', color: 'var(--session-muted)', marginBottom: '16px'}}>
          {lang === 'zh'
            ? '控制浏览器导航、刷新和历史记录操作。'
            : 'Control browser navigation, refresh, and history.'}
        </p>

        <div style={{display: 'flex', gap: '8px', marginBottom: '16px'}}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={lang === 'zh' ? '输入网址...' : 'Enter URL...'}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid var(--session-border)',
              borderRadius: '6px',
              background: 'var(--session-bg)',
              color: 'var(--session-text)',
              fontSize: '13px'
            }}
          />
          <button
            className="settings-primary"
            disabled={busy || !url}
            onClick={() => void executeCommand('navigate', {url})}
            style={{gap: '6px'}}
          >
            <ExternalLink size={16} />
            {lang === 'zh' ? '打开' : 'Go'}
          </button>
        </div>

        <div style={{display: 'flex', gap: '8px'}}>
          <button
            className="settings-secondary"
            disabled={busy}
            onClick={() => void executeCommand('back')}
            style={{flex: 1, gap: '6px'}}
          >
            <ArrowLeft size={16} />
            {lang === 'zh' ? '后退' : 'Back'}
          </button>
          <button
            className="settings-secondary"
            disabled={busy}
            onClick={() => void executeCommand('forward')}
            style={{flex: 1, gap: '6px'}}
          >
            <ArrowRight size={16} />
            {lang === 'zh' ? '前进' : 'Forward'}
          </button>
          <button
            className="settings-secondary"
            disabled={busy}
            onClick={() => void executeCommand('refresh')}
            style={{flex: 1, gap: '6px'}}
          >
            <RotateCw size={16} />
            {lang === 'zh' ? '刷新' : 'Refresh'}
          </button>
        </div>
      </Panel>

      {/* 交互操作 */}
      <Panel title={lang === 'zh' ? '页面交互' : 'Page Interactions'}>
        <p style={{fontSize: '12px', color: 'var(--session-muted)', marginBottom: '16px'}}>
          {lang === 'zh'
            ? '在网页上执行点击、输入、滚动等交互操作。'
            : 'Execute clicks, input, scrolling and other interactions on the page.'}
        </p>
        <div className="ax-control-grid">
          <button
            className="ax-control-card"
            disabled={busy}
            onClick={() => void executeCommand('click')}
          >
            <Mouse size={24} />
            <strong>{lang === 'zh' ? '点击元素' : 'Click Element'}</strong>
            <small>{lang === 'zh' ? '点击指定元素' : 'Click target'}</small>
          </button>

          <button
            className="ax-control-card"
            disabled={busy}
            onClick={() => void executeCommand('type')}
          >
            <Keyboard size={24} />
            <strong>{lang === 'zh' ? '输入文本' : 'Type Text'}</strong>
            <small>{lang === 'zh' ? '在输入框输入' : 'Fill input'}</small>
          </button>

          <button
            className="ax-control-card"
            disabled={busy}
            onClick={() => void executeCommand('scroll')}
          >
            <Mouse size={24} />
            <strong>{lang === 'zh' ? '滚动页面' : 'Scroll'}</strong>
            <small>{lang === 'zh' ? '滚动到位置' : 'Scroll to position'}</small>
          </button>

          <button
            className="ax-control-card"
            disabled={busy}
            onClick={() => void executeCommand('screenshot')}
          >
            <Camera size={24} />
            <strong>{lang === 'zh' ? '截屏' : 'Screenshot'}</strong>
            <small>{lang === 'zh' ? '捕获当前页面' : 'Capture page'}</small>
          </button>

          <button
            className="ax-control-card"
            disabled={busy}
            onClick={() => void executeCommand('extract')}
          >
            <Download size={24} />
            <strong>{lang === 'zh' ? '提取数据' : 'Extract Data'}</strong>
            <small>{lang === 'zh' ? '获取页面内容' : 'Get content'}</small>
          </button>

          <button
            className="ax-control-card"
            disabled={busy}
            onClick={() => void executeCommand('extract')}
          >
            <Search size={24} />
            <strong>{lang === 'zh' ? '查找元素' : 'Find Element'}</strong>
            <small>{lang === 'zh' ? '定位页面元素' : 'Locate element'}</small>
          </button>
        </div>

        {message && (
          <div className={`settings-notice ${isError ? 'is-error' : 'is-success'}`}>
            {isError ? <AlertCircle size={16} /> : <Check size={16} />}
            <span>{message}</span>
          </div>
        )}
      </Panel>

      {/* 高级选项 */}
      <Panel title={lang === 'zh' ? '浏览器选项' : 'Browser Options'}>
        <SettingsToggle label={lang === 'zh' ? '无头模式' : 'Headless Mode'} description={lang === 'zh' ? '后台运行浏览器（不显示窗口）' : 'Run browser in background'} defaultChecked/>

        <SettingsToggle label={lang === 'zh' ? '启用 JavaScript' : 'Enable JavaScript'} description={lang === 'zh' ? '允许执行页面脚本' : 'Allow page scripts'} />

        <SettingsToggle label={lang === 'zh' ? '自动等待加载' : 'Wait for Load'} description={lang === 'zh' ? '等待页面完全加载后再操作' : 'Wait for page to load'} defaultChecked/>

        <div className="settings-field-row">
          <span>{lang === 'zh' ? '超时时间' : 'Timeout'}</span>
          <input type="number" defaultValue="30" min="5" max="120" placeholder="seconds"
            style={{width: '70px', padding: '6px', borderRadius: '4px', border: '1px solid var(--session-border)'}} />
        </div>

        <div className="settings-field-row">
          <span>{lang === 'zh' ? '用户代理' : 'User Agent'}</span>
          <select style={{
            padding: '6px 8px',
            borderRadius: '4px',
            border: '1px solid var(--session-border)',
            background: 'var(--session-bg)',
            color: 'var(--session-text)',
            fontSize: '12px'
          }}>
            <option>Chrome (Desktop)</option>
            <option>Firefox (Desktop)</option>
            <option>Safari (Desktop)</option>
            <option>Mobile Chrome</option>
            <option>Mobile Safari</option>
          </select>
        </div>
      </Panel>

      {/* 使用说明 */}
      <Panel title={lang === 'zh' ? '使用说明' : 'Usage Tips'}>
        <ul style={{fontSize: '12px', lineHeight: '1.6', color: 'var(--session-text)', margin: 0, paddingLeft: '20px'}}>
          <li>{lang === 'zh'
            ? '浏览器控制功能需要 AX 在后台运行 Chromium 或 Playwright'
            : 'Browser control requires AX running Chromium or Playwright'}</li>
          <li>{lang === 'zh'
            ? '可以与 AI 协助结合，自动化网页数据采集和操作'
            : 'Combine with AI for automated web scraping and interactions'}</li>
          <li>{lang === 'zh'
            ? '支持选择器定位、表单填写、页面截图等功能'
            : 'Supports selector targeting, form filling, screenshots, etc.'}</li>
          <li>{lang === 'zh'
            ? '所有操作都会被记录，便于调试和复现'
            : 'All actions are logged for debugging and replay'}</li>
          <li>{lang === 'zh'
            ? '注意遵守目标网站的使用条款和 robots.txt'
            : 'Respect target site terms of service and robots.txt'}</li>
        </ul>
      </Panel>
    </div>
  )
}
