import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Laptop, Plus, Smartphone, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AndroidConnection } from '../components/AndroidConnection'
import { SshDialog, useConnectionText } from '../components/ConnectionDialogs'
import { Dialog } from '../components/ui/dialog'
import { endpoints, api } from '../lib/api'
import { connections } from '../lib/connections'
import { useDevices } from '../lib/query'
import './settings.css'
import './connect.css'

export function Connections(){
  const text=useConnectionText(),query=useQueryClient(),devices=useDevices()
  const [tab,setTab]=useState<'control'|'devices'|'ssh'>('control'),[phone,setPhone]=useState(false),[ssh,setSsh]=useState(false),[pending,setPending]=useState(''),[error,setError]=useState('')
  const authorized=useQuery({queryKey:['authorizations'],queryFn:endpoints.authorizations,refetchInterval:5000})
  const hosts=useQuery({queryKey:['ssh-connections'],queryFn:connections.ssh})
  const run=async(id:string,action:()=>Promise<unknown>)=>{setPending(id);setError('');try{await action();await query.invalidateQueries({queryKey:['devices']});await query.invalidateQueries({queryKey:['authorizations']});await query.invalidateQueries({queryKey:['ssh-connections']})}catch(e){setError(String(e))}finally{setPending('')}}
  return <div className="connections-page"><h1>{text('连接','Connections')}</h1>
    <div className="connections-tabs" role="tablist" aria-label={text('连接类型','Connection type')}>{([['control',text('控制此电脑','Control this computer')],['devices',text('控制其他设备','Control other devices')],['ssh','SSH']] as const).map(([value,label])=><button role="tab" aria-selected={tab===value} className={tab===value?'active':''} key={value} onClick={()=>setTab(value)}>{label}</button>)}</div>
    <h2>{tab==='control'?text('可控制此电脑的设备','Devices that can control this computer'):tab==='devices'?text('可用的远程设备','Available remote devices'):text('SSH 连接','SSH connections')}</h2>
    {tab==='control'?<>
      {[...(authorized.data?.pending??[]),...(authorized.data?.authorized??[])].map(device=><div className="connections-row" key={device.device_id}><Smartphone size={23}/><div><strong>{device.name}</strong><small>{device.platform} · {device.status}</small></div>{device.status==='pending'?<><button disabled={!!pending} onClick={()=>void run(device.device_id,()=>endpoints.confirmAuthorization(device.device_id))}>{text('允许','Allow')}</button><button disabled={!!pending} onClick={()=>void run(device.device_id,()=>endpoints.denyAuthorization(device.device_id))}>{text('拒绝','Deny')}</button></>:<button aria-label={text('撤销设备','Revoke device')} disabled={!!pending} onClick={()=>void run(device.device_id,()=>endpoints.revokeAuthorization(device.device_id))}><Trash2 size={16}/></button>}</div>)}
      <div className="connections-empty"><div><Smartphone size={28}/><span>···</span><Laptop size={32}/></div><p>{text('添加设备以远程控制此电脑','Add a device to control this computer remotely')}</p><button className="connection-primary" onClick={()=>setPhone(true)}>{text('添加','Add')}</button></div>
    </>:tab==='devices'?<>
      {(devices.data??[]).filter(d=>d.id!=='local'&&!d.id.startsWith('ssh:')).map(device=><div className="connections-row" key={device.id}><Laptop size={24}/><div><strong>{device.name}</strong><small>{device.hostname} · {device.status}</small></div><Link to={'/devices/'+device.id}>{text('管理','Manage')}</Link></div>)}
      <div className="connections-empty"><Laptop size={32}/><p>{text('连接其他设备上的 AX，选择远程环境运行会话','Connect AX on another device to run remote sessions')}</p><Link className="connection-primary" to="/devices?pair=1">{text('添加设备','Add device')}</Link></div>
    </>:<>
      {hosts.data?.map(host=>{const device=devices.data?.find(d=>d.id===host.id);return <div className="connections-row" key={host.id}><Laptop size={24}/><div><strong>{host.name}</strong><small>{host.host} · {['online','busy'].includes(device?.status??'')?text('已连接','Connected'):text('未连接','Disconnected')}</small></div><button disabled={!!pending} onClick={()=>void run(host.id,()=>connections.connect(host.id))}>{pending===host.id?text('连接中…','Connecting…'):text('连接','Connect')}</button><button disabled={!!pending} aria-label={text('删除 SSH 连接','Remove SSH connection')} onClick={()=>void run(host.id,()=>api('/api/devices/'+encodeURIComponent(host.id)+'/revoke','POST',{}))}><Trash2 size={16}/></button></div>})}
      <button className="connections-add" onClick={()=>setSsh(true)}><Plus size={18}/>{text('添加 SSH 连接','Add SSH connection')}</button>
      <p className="connections-hint">{text('由本地 AX 通过 SSH 执行远程命令，远端无需安装 AX 或配置模型。SSH 主机数量不设上限。使用本机 OpenSSH 配置、SSH Agent 或身份文件连接。','Local AX executes remote commands over SSH. Remote hosts need no AX or model credentials. There is no fixed SSH host limit. Use local OpenSSH configuration, SSH Agent or an identity file.')}</p>
    </>}
    {(error||devices.error||hosts.error||authorized.error)&&<p role="alert" className="connection-error">{error||String(devices.error||hosts.error||authorized.error)}</p>}
    <Dialog open={phone} onOpenChange={setPhone} title={text('添加设备','Add device')} wide><AndroidConnection/></Dialog>
    <SshDialog open={ssh} onClose={()=>setSsh(false)}/>
  </div>
}
