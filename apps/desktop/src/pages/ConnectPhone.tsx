import { translate, useLang } from '../lib/i18n'
import { HelpCircle, Smartphone } from 'lucide-react'
import { AndroidConnection } from '../components/AndroidConnection'
import './settings.css' // AndroidConnection 复用的 settings-card / settings-primary 卡片样式
import './connect.css'

/** 侧边栏「连接手机」入口：连接流程优先的配对页面。 */
export function ConnectPhone() {
  useLang(state=>state.lang);

  return (
    <div className="connect-page">
      <header className="connect-head">
        <div className="connect-head-title">
          <span className="connect-head-icon" aria-hidden="true"><Smartphone size={22} /></span>
          <div>
            <h1>{translate("copy.325")}</h1>
            <p>{translate("copy.326")}</p>
          </div>
        </div>

        <ol className="connect-steps" aria-label={translate("copy.327")}>
          <li className="active"><b>1</b> {translate("copy.328")}</li>
          <li><b>2</b> {translate("copy.329")}</li>
          <li><b>3</b> {translate("copy.330")}</li>
        </ol>
      </header>

      <AndroidConnection />

      <details className="connect-help">
        <summary><HelpCircle size={14} /> {translate("copy.331")}</summary>
        <ul>
          <li>{translate("copy.332")}</li>
          <li>{translate("copy.333")}</li>
          <li>{translate("copy.334")}</li>
          <li>{translate("copy.335")}</li>
          <li>{translate("copy.336")}</li>
        </ul>
      </details>
    </div>
  )
}
