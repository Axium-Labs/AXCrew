import { HelpCircle, Smartphone } from 'lucide-react'
import { AndroidConnection } from '../components/AndroidConnection'
import './settings.css' // AndroidConnection 复用的 settings-card / settings-primary 卡片样式
import './connect.css'

/** 侧边栏「连接手机」入口：连接流程优先的配对页面。 */
export function ConnectPhone() {
  return (
    <div className="connect-page">
      <header className="connect-head">
        <div className="connect-head-title">
          <span className="connect-head-icon" aria-hidden="true"><Smartphone size={22} /></span>
          <div>
            <h1>连接手机</h1>
            <p>用局域网或远程方式，把手机接入桌面 Gateway，控制同一套 AX Crew</p>
          </div>
        </div>

        <ol className="connect-steps" aria-label="连接流程">
          <li className="active"><b>1</b> 选择连接方式</li>
          <li><b>2</b> 获取连接凭证</li>
          <li><b>3</b> 手机连接</li>
        </ol>
      </header>

      <AndroidConnection />

      <details className="connect-help">
        <summary><HelpCircle size={14} /> 连接遇到问题？</summary>
        <ul>
          <li>手机和电脑必须连在同一个 Wi-Fi（同一局域网）。</li>
          <li>Windows 防火墙需放行 Gateway 端口（默认 53413），否则手机无法访问。</li>
          <li>页面显示的局域网地址是当前电脑的 IP，若网络变化会变，请以页面为准。</li>
          <li>配对码 5 分钟有效、一次性使用；手机扫码后需在本页「已授权设备」中点「允许」才完成授权。</li>
          <li>HTTPS / 远程连接需要单独配置反向代理，当前版本尚未开放。</li>
        </ul>
      </details>
    </div>
  )
}
