import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { Copy, FolderOpen, MessageCircle, RefreshCw, Send, Feather, Hash, Gamepad2, Video, MessagesSquare, Users, Phone, ExternalLink } from 'lucide-react'
import { chatPlatforms as platforms, platformNames, platformSetup } from '../lib/chatPlatforms'
import { call as invoke } from '../lib/errors'
import { chatChannels, type ChatChannel, type ChatPlatform } from '../lib/channels'
import { useConnectionText } from './ConnectionDialogs'
import { resolveSendWorkspace } from '../lib/workspace'
import { useSessionUi } from '../store/sessions'
import './chat-channels.css'

const icons={slack:Hash,discord:Gamepad2,telegram:Send,webex:Video,wecom:MessagesSquare,feishu:Feather,teams:Users,weixin:MessageCircle,imessage:MessageCircle,whatsapp:Phone}
function ChannelCard({channel,defaultCwd}:{channel:ChatChannel;defaultCwd:string}) {
  const text=useConnectionText(),query=useQueryClient()
  const [cwd,setCwd]=useState(channel.cwd||defaultCwd),[appId,setAppId]=useState(channel.app_id),[secret,setSecret]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pair,setPair]=useState<{command:string;expires_at:number}|null>(null)
  const [login,setLogin]=useState<{id:string;content:string}|null>(null),[qr,setQr]=useState(''),[verify,setVerify]=useState(''),[needVerify,setNeedVerify]=useState(false),[verifySubmitted,setVerifySubmitted]=useState<string|undefined>()
  const [appToken,setAppToken]=useState(''),[tenant,setTenant]=useState(channel.tenant_id||''),[publicUrl,setPublicUrl]=useState(channel.public_url||''),[bridgePath,setBridgePath]=useState(channel.bridge_path||''),[databasePath,setDatabasePath]=useState(channel.database_path||''),[whatsappQr,setWhatsappQr]=useState('')
  const setup=platformSetup[channel.platform],Icon=icons[channel.platform],unavailable=channel.available===false
  const alive=useRef(true)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  const name=text(...platformNames[channel.platform])
  const refresh=()=>query.invalidateQueries({queryKey:['chat-channels']})
  const run=async(action:()=>Promise<unknown>)=>{setBusy(true);setError('');setNotice('');try{await action();await refresh()}catch(error){if(alive.current)setError(error instanceof Error?error.message:String(error))}finally{if(alive.current)setBusy(false)}}
  const save=async(enabled:boolean)=>{await chatChannels.save(channel.platform,{enabled,cwd:cwd.trim(),app_id:setup.id?appId.trim():undefined,secret:secret.trim()||undefined,...(channel.platform==='slack'?{app_token:appToken.trim()||undefined}:{}),...(channel.platform==='teams'?{tenant_id:tenant.trim(),public_url:publicUrl.trim()}:{}),...(['imessage','whatsapp'].includes(channel.platform)?{bridge_path:bridgePath.trim()}:{}),...(channel.platform==='imessage'?{database_path:databasePath.trim()}:{})});setSecret('');setAppToken('');setPair(null)}
  useEffect(()=>{let valid=true;if(!channel.qr){setWhatsappQr('');return}QRCode.toDataURL(channel.qr,{width:256,margin:2}).then(value=>{if(valid)setWhatsappQr(value)}).catch(()=>{if(valid)setError(text('二维码生成失败，请重试','Could not generate QR code'))});return()=>{valid=false}},[channel.qr])
  useEffect(()=>{if(!login){setQr('');return}let valid=true;QRCode.toDataURL(login.content,{width:256,margin:2}).then(value=>{if(valid)setQr(value)}).catch(()=>{if(valid)setError(text('二维码生成失败，请重试','Could not generate QR code'))});return()=>{valid=false}},[login])
  useEffect(()=>{
    if(!login||(needVerify&&!verifySubmitted))return
    let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined
    const poll=async()=>{
      try {
        const result=await chatChannels.weixinPoll(login.id,verifySubmitted)
        if(cancelled)return
        if(result.status==='confirmed'){setLogin(null);setNeedVerify(false);setVerify('');setVerifySubmitted(undefined);setNotice(text('微信已登录，请生成绑定指令并在微信中发送','Weixin is signed in. Generate and send a pairing command.'));void refresh();return}
        if(result.status==='expired'||result.status==='already_bound'){setLogin(null);setError(text('二维码已失效或已绑定，请重新扫码','QR code expired or already bound. Start again.'));return}
        if(result.status==='need_verifycode'){setNeedVerify(true);setVerifySubmitted(undefined);return}
        setNotice(result.status==='scaned'?text('已扫码，请在微信确认','Scanned. Confirm in Weixin.'):text('等待微信扫码','Waiting for Weixin scan'))
        timer=setTimeout(()=>void poll(),2500)
      }catch(error){if(!cancelled){setError(error instanceof Error?error.message:String(error));setLogin(null)}}
    }
    void poll();return()=>{cancelled=true;if(timer)clearTimeout(timer)}
  },[login,needVerify,verifySubmitted])
  const states:Record<string,string>={waiting_webhook:text('等待 Teams 消息回调','Waiting for Teams callback'),pairing:text('等待手机扫码','Waiting for QR scan'),disabled:text('未开启','Disabled'),connecting:text('连接中','Connecting'),connected:text('已连接','Connected'),connection_error:text('连接失败，请检查平台凭据和网络','Connection failed. Check credentials and network.'),disconnected:text('连接已断开，等待重连','Disconnected. Reconnecting.'),delivery_error:text('回复发送未确认，可在聊天中发送 /status 查看','Reply delivery was not confirmed. Send /status to check.'),login_required:text('微信登录失效，请重新扫码','Weixin login expired. Scan again.')}
  return <section className="settings-card chat-channel">
    <div className="chat-channel-title"><h3><Icon size={19}/>{name}</h3><span role="status">{states[channel.state]||channel.state}</span></div>
    <div className="chat-channel-guide"><p className="connect-desc">{text(...setup.description)}</p><button type="button" onClick={()=>void run(()=>invoke('open_chat_setup',{url:setup.guide}))}><ExternalLink size={14}/>{text('设置指南','Setup guide')}</button></div>
    {unavailable&&<p className="chat-channel-unavailable" role="note">{text('此电脑无法使用 iMessage。请在已登录 Messages 的 Mac 上运行 AXCrew。','iMessage is unavailable on this computer. Run AXCrew on a Mac signed into Messages.')}</p>}
    <fieldset className="chat-channel-config" disabled={busy||unavailable}>
    {setup.id&&<label className="chat-channel-field">{setup.id}<input value={appId} onChange={event=>setAppId(event.target.value)} autoComplete="off"/></label>}
    {setup.secret&&<label className="chat-channel-field">{setup.secret}<input type="password" value={secret} onChange={event=>setSecret(event.target.value)} autoComplete="new-password" placeholder={channel.configured?text('已保存；留空保留','Saved; leave blank to retain'):text('填写平台凭据','Enter platform credential')}/></label>}
    {channel.platform==='slack'&&<label className="chat-channel-field">App Token<input type="password" value={appToken} onChange={event=>setAppToken(event.target.value)} autoComplete="new-password" placeholder={channel.app_token_configured?text('已保存；留空保留','Saved; leave blank to retain'):'xapp-…'}/></label>}
    {channel.platform==='teams'&&<><label className="chat-channel-field">{text('租户 ID','Tenant ID')}<input value={tenant} onChange={event=>setTenant(event.target.value)} autoComplete="off"/></label><label className="chat-channel-field">{text('公网 HTTPS 地址','Public HTTPS origin')}<input value={publicUrl} onChange={event=>setPublicUrl(event.target.value)} placeholder="https://crew.example.com"/></label><p className="connect-desc">{text('消息端点：','Messaging endpoint: ')}{publicUrl.replace(/\/$/,'')}/api/messaging/teams</p><p className="chat-channel-unavailable">{text('需要配置 HTTPS 反向代理或隧道。只公开此消息端点，不要公开整个管理接口。','Configure an HTTPS reverse proxy or tunnel. Expose only this messaging endpoint, not the whole administration API.')}</p></>}
    {['imessage','whatsapp'].includes(channel.platform)&&<label className="chat-channel-field">{channel.platform==='imessage'?text('imsg 程序路径（可选）','imsg executable path (optional)'):text('Node.js 程序路径（可选）','Node.js executable path (optional)')}<input value={bridgePath} onChange={event=>setBridgePath(event.target.value)} placeholder={channel.platform==='imessage'?'imsg':'node'}/></label>}
    {channel.platform==='imessage'&&<label className="chat-channel-field">{text('Messages 数据库路径（可选）','Messages database path (optional)')}<input value={databasePath} onChange={event=>setDatabasePath(event.target.value)} placeholder="~/Library/Messages/chat.db"/></label>}
    {channel.platform==='whatsapp'&&<div className="chat-channel-actions"><button type="button" disabled={channel.enabled} onClick={()=>void run(async()=>{await chatChannels.installWhatsapp();setNotice(text('连接组件已安装，请保存并连接，然后使用手机扫码。','Connection component installed. Save and connect, then scan with your phone.'))})}>{busy?text('正在处理…','Working…'):text('安装 / 修复连接组件','Install / repair connection component')}</button></div>}
    <label className="chat-channel-field">{text('新会话工作目录','Workspace for new conversations')}<div className="chat-channel-path"><input value={cwd} onChange={event=>setCwd(event.target.value)} disabled={busy}/><button type="button" aria-label={text('选择工作目录','Choose workspace')} disabled={busy} onClick={()=>void run(async()=>{const path=await resolveSendWorkspace();if(path)setCwd(path)})}><FolderOpen size={17}/></button></div></label>
    <div className="chat-channel-actions">
      <button type="button" className="settings-primary" disabled={busy||!cwd.trim()} onClick={()=>void run(async()=>{await save(channel.platform==='weixin'?channel.configured:true);setNotice(text('设置已保存','Settings saved'))})}>{channel.platform==='weixin'&&!channel.configured?text('保存工作目录','Save workspace'):text('保存并连接','Save and connect')}</button>
      {channel.platform==='weixin'&&<button type="button" disabled={busy||!cwd.trim()} onClick={()=>void run(async()=>{await save(false);setPair(null);setNeedVerify(false);setVerifySubmitted(undefined);setLogin(await chatChannels.weixinLogin())})}>{text('微信扫码登录','Sign in with Weixin')}</button>}
      {channel.enabled&&<button type="button" disabled={busy} onClick={()=>void run(async()=>{await save(false);setPair(null);setLogin(null)})}>{text('停用','Disable')}</button>}
      {channel.configured&&<button type="button" disabled={busy} onClick={()=>void run(async()=>{await chatChannels.disconnect(channel.platform);setPair(null);setLogin(null);setSecret('');setNotice(text('凭据和账号绑定已移除','Credentials and account bindings removed'))})}>{text('断开并移除凭据','Disconnect and remove credentials')}</button>}
    </div>
    </fieldset>
    {channel.platform==='whatsapp'&&whatsappQr&&<div className="chat-channel-login"><img src={whatsappQr} width={256} height={256} alt={text('WhatsApp 关联设备二维码','WhatsApp device linking QR code')}/><p className="connect-desc">{text('在手机 WhatsApp → 已关联的设备 → 关联设备中扫码。','Scan from WhatsApp → Linked devices → Link a device on your phone.')}</p></div>}
    {login&&<div className="chat-channel-login">{qr&&<img src={qr} width={256} height={256} alt={text('微信登录二维码','Weixin login QR code')}/>}<button type="button" onClick={()=>{setLogin(null);setNotice('')}}>{text('收起二维码','Hide QR code')}</button>{needVerify&&<form onSubmit={event=>{event.preventDefault();setVerifySubmitted(verify.trim())}}><label>{text('微信显示的验证码','Verification code shown in Weixin')}<input value={verify} onChange={event=>setVerify(event.target.value)} autoComplete="one-time-code"/></label><button disabled={!verify.trim()}>{text('继续验证','Verify')}</button></form>}</div>}
    {channel.enabled&&<div className="chat-channel-pair"><button type="button" disabled={busy} onClick={()=>void run(async()=>setPair(await chatChannels.pairing(channel.platform)))}><RefreshCw size={15}/>{text('生成账号绑定指令','Generate account pairing command')}</button>{pair&&<><p className="connect-desc">{text('五分钟内从要授权的账号，向已连接的机器人或账号私聊发送这条指令，然后回到电脑确认。','Within five minutes, send this command from the account you want to authorize to the connected bot or account, then approve it here.')}</p><div className="chat-channel-command"><code>{pair.command}</code><button type="button" aria-label={text('复制绑定指令','Copy pairing command')} onClick={()=>void run(()=>navigator.clipboard.writeText(pair.command))}><Copy size={16}/></button></div></>}</div>}
    {channel.peers.map(peer=><div className="chat-channel-peer" key={peer.id}><div><strong>{peer.sender}</strong><small>{peer.approved?text('已授权','Approved'):text('待电脑确认','Awaiting desktop approval')}</small></div>{!peer.approved&&<button type="button" disabled={busy} onClick={()=>void run(()=>chatChannels.approve(channel.platform,peer.id))}>{text('允许此账号','Approve account')}</button>}<button type="button" disabled={busy} onClick={()=>void run(()=>chatChannels.revoke(channel.platform,peer.id))}>{peer.approved?text('撤销','Revoke'):text('拒绝','Deny')}</button></div>)}
    {notice&&<p role="status" className="connect-desc">{notice}</p>}{error&&<p role="alert" className="connection-error">{error}</p>}
  </section>
}
export function ChatChannels(){
  const text=useConnectionText(),cwd=useSessionUi(state=>state.selectedCwd)||''
  const channels=useQuery({queryKey:['chat-channels'],queryFn:chatChannels.list,refetchInterval:3000})
  const [selected,setSelected]=useState<ChatPlatform>('weixin')

  const status=(channel:ChatChannel|undefined)=>!channel?text(channels.isPending?'加载中…':'需更新后端',channels.isPending?'Loading…':'Update backend'):channel.available===false?text('仅限 macOS','macOS only'):channel.state==='connected'?text('已连接','Connected'):channel.state==='waiting_webhook'?text('等待回调','Waiting for callback'):channel.state==='pairing'?text('等待扫码','Waiting for scan'):channel.state==='connecting'?text('连接中…','Connecting…'):!channel.configured?text('需要设置','Needs setup'):!channel.enabled?text('已停用','Disabled'):text('需要检查','Needs attention')
  return <div className="chat-channels">
    <div className="chat-platform-list" role="tablist" aria-label={text('聊天平台','Chat platforms')} aria-orientation="vertical">
      {platforms.map((platform,index)=>{const channel=channels.data?.find(c=>c.platform===platform),Icon=icons[platform]
        return <button key={platform} id={'channel-tab-'+platform} type="button" role="tab" aria-selected={selected===platform} aria-controls={'channel-panel-'+platform} tabIndex={selected===platform?0:-1} onClick={()=>setSelected(platform)} onKeyDown={event=>{
          const next=['ArrowDown','ArrowRight'].includes(event.key)?(index+1)%platforms.length:['ArrowUp','ArrowLeft'].includes(event.key)?(index+platforms.length-1)%platforms.length:event.key==='Home'?0:event.key==='End'?platforms.length-1:null
          if(next!==null){event.preventDefault();setSelected(platforms[next]);document.getElementById('channel-tab-'+platforms[next])?.focus()}
        }}><span className={'chat-platform-icon is-'+platform}><Icon size={21}/></span><span><strong>{text(...platformNames[platform])}</strong><small><i className={channel?.state==='connected'?'is-connected':''}/>{status(channel)}</small></span></button>
      })}
    </div>
    <div className="chat-platform-content">
      {channels.isPending&&<p role="status">{text('正在加载聊天平台…','Loading chat platforms…')}</p>}
      {channels.error&&<div role="alert" className="chat-platform-error"><p>{text('无法加载聊天平台，请重试。','Could not load chat platforms. Please retry.')}</p><button onClick={()=>void channels.refetch()}>{text('重试','Retry')}</button></div>}
      {platforms.map(platform=>{const channel=channels.data?.find(c=>c.platform===platform);return <div key={platform} id={'channel-panel-'+platform} role="tabpanel" aria-labelledby={'channel-tab-'+platform} hidden={selected!==platform} tabIndex={0}>{channel?<ChannelCard channel={channel} defaultCwd={cwd}/>:!channels.isPending&&!channels.error?<p>{text('请更新 AXCrew 后端以配置此平台。','Update the AXCrew backend to configure this platform.')}</p>:null}</div>})}
      <p className="chat-platform-note">{text('仅支持已授权账号的私聊文字消息。电脑需保持运行，消息与回复会经过所选平台。','Only approved private text chats are supported. Keep this computer running. Messages and replies pass through the selected platform.')}</p>
    </div>
  </div>
}
