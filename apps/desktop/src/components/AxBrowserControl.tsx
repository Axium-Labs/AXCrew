import { HostPermissionsPanel } from './HostPermissionsPanel'
import { useLang } from '../lib/i18n'

export function AxBrowserControl() {
  const zh = useLang(state => state.lang) === 'zh'
  return <div className="settings-stack">
    <section className="settings-card"><h2>{zh ? '浏览器选项' : 'Browser options'}</h2><p>{zh ? 'AX 使用独立的 Playwright 浏览器，需要安装 Node、Playwright 和受支持的浏览器。网站权限按来源分别管理，不改变文件和终端的沙箱设置。请通过新的导航请求授权其他网站；跨站资源、WebSocket、上传、下载和弹出窗口暂不可用，部分网站因此无法完整使用。' : 'AX uses an owned Playwright browser and requires Node, Playwright and a supported browser. Website access is independent of file and terminal sandbox settings. Navigate explicitly to authorize another site; cross-origin resources, WebSockets, uploads, downloads and popups are unavailable, limiting some sites.'}</p></section>
    <HostPermissionsPanel surface="browser"/>
  </div>
}
