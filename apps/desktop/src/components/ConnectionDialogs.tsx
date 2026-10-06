import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, ChevronDown, Folder, FolderPlus, Globe, Laptop, Plus, RefreshCw } from 'lucide-react'
import { open as pickDirectory } from '@tauri-apps/plugin-dialog'
import { isTauri } from '@tauri-apps/api/core'
import { Dialog } from './ui/dialog'
import { Menu } from './ui/menu'
import { useLang } from '../lib/i18n'
import { connections, type Project, type SshConnection } from '../lib/connections'
import { useDevices } from '../lib/query'
import './connections.css'

export function useConnectionText(){const lang=useLang(s=>s.lang);return (zh:string,en:string)=>lang==='zh'?zh:en}

export function SshDialog({open,onClose}:{open:boolean;onClose:()=>void}){
  const text=useConnectionText(),query=useQueryClient()
  const found=useQuery({queryKey:['ssh-discover'],queryFn:connections.discover,enabled:open,retry:false})
  const [manual,setManual]=useState(false),[selected,setSelected]=useState<string[]>([])
  const [name,setName]=useState(''),[host,setHost]=useState(''),[port,setPort]=useState(''),[identity,setIdentity]=useState(''),[auth,setAuth]=useState(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const finish=()=>{if(!busy){setError('');setManual(false);setSelected([]);onClose()}}
  const save=async(items:Omit<SshConnection,'id'>[])=>{
    setBusy(true);setError('')
    try{for(const item of items)await connections.add(item);await query.invalidateQueries({queryKey:['ssh-connections']});await query.invalidateQueries({queryKey:['devices']});setManual(false);setName('');setHost('');setPort('');setIdentity('');setSelected([]);onClose()}
    catch(e){setError(String(e))}finally{setBusy(false)}
  }
  return <Dialog open={open} onOpenChange={value=>{if(!value)finish()}} title={text('添加 SSH 连接','Add SSH connection')} className="connection-dialog">
    {manual?<form onSubmit={event=>{event.preventDefault();void save([{name:name.trim()||host.trim(),host:host.trim(),port:port?Number(port):null,identity_file:auth?identity.trim():null}])}}>
      <label className="connection-field"><span>{text('显示名称','Display name')}</span><div className="connection-name"><Globe size={20}/><input value={name} onChange={e=>setName(e.target.value)}/></div></label>
      <label className="connection-field"><span>{text('主机名','Hostname')}</span><input required value={host} onChange={e=>setHost(e.target.value)} placeholder="host.com 或 user@host.com"/></label>
      <label className="connection-field"><span>{text('SSH 端口 （可选）','SSH port (optional)')}</span><input type="number" min="1" max="65535" value={port} onChange={e=>setPort(e.target.value)}/></label>
      <div className="connection-auth"><button type="button" className={!auth?'active':''} onClick={()=>setAuth(false)}>{text('无身份验证','Default SSH authentication')}</button><button type="button" className={auth?'active':''} onClick={()=>setAuth(true)}>{text('身份文件','Identity file')}</button></div>
      {auth&&<label className="connection-field"><span>{text('身份文件路径','Identity file path')}</span><input required value={identity} onChange={e=>setIdentity(e.target.value)}/></label>}
      {error&&<p role="alert" className="connection-error">{error}</p>}
      <footer className="connection-footer"><button type="button" onClick={()=>setManual(false)} disabled={busy}>{text('取消','Cancel')}</button><button className="connection-primary" disabled={busy||!host.trim()}>{busy?text('保存中…','Saving…'):text('保存','Save')}</button></footer>
    </form>:<>
      <div className="ssh-discovery">
        {found.isPending?<p>{text('读取 SSH 配置…','Reading SSH config…')}</p>:found.error?<p role="alert">{String(found.error)}</p>:!found.data?.length?<p>{text('未找到 SSH 主机，请手动添加','No SSH hosts found. Add one manually.')}</p>:found.data.map(item=><label key={item.host}><Laptop size={20}/><strong>{item.name}</strong><input type="checkbox" checked={selected.includes(item.host)} onChange={e=>setSelected(values=>e.target.checked?[...values,item.host]:values.filter(v=>v!==item.host))}/></label>)}
      </div>
      {error&&<p role="alert" className="connection-error">{error}</p>}
      <footer className="connection-footer discovery-footer"><button type="button" aria-label={text('刷新主机','Refresh hosts')} onClick={()=>void found.refetch()}><RefreshCw size={18}/></button><button type="button" onClick={()=>{setManual(true);setError('')}}>{text('手动添加','Add manually')}</button><span/><button className="connection-primary" disabled={busy||!selected.length} onClick={()=>void save((found.data??[]).filter(item=>selected.includes(item.host)))}>{text('添加','Add')}</button></footer>
    </>}
  </Dialog>
}

export function FolderDialog({device,onClose,onSelect}:{device:string|null;onClose:()=>void;onSelect:(cwd:string)=>void}){
  const text=useConnectionText(),[path,setPath]=useState<string>(),[input,setInput]=useState('')
  const listing=useQuery({queryKey:['host-workspace',device,path],queryFn:()=>connections.workspace(device!,path),enabled:!!device,retry:false})
  return <Dialog open={!!device} onOpenChange={value=>{if(!value)onClose()}} title={text('选择源文件夹','Choose source folder')} className="connection-dialog">
    <form className="connection-path" onSubmit={e=>{e.preventDefault();if(input.trim())setPath(input.trim())}}><input aria-label={text('文件夹路径','Folder path')} placeholder={listing.data?.cwd??text('输入远程绝对路径','Enter an absolute remote path')} value={input} onChange={e=>setInput(e.target.value)}/><button>{text('打开','Open')}</button></form>
    <div className="connection-folder-list">{listing.isFetching?<p>{text('读取文件夹…','Reading folders…')}</p>:listing.error?<p role="alert" className="connection-error">{String(listing.error)}</p>:<><p>{listing.data?.cwd}</p>{listing.data?.hint==="registered_workspaces"&&<p>{text("选择远程 AX 已打开的项目文件夹；其他目录需先在远程设备上用 AX 打开。","Choose a folder already opened by remote AX. Open other folders with AX on that device first.")}</p>}{listing.data?.parent&&<button onClick={()=>{setPath(listing.data!.parent!);setInput('')}}><ArrowLeft size={18}/> ..</button>}{listing.data?.directories.map(dir=><button key={dir.path} onClick={()=>{setPath(dir.path);setInput('')}}><Folder size={18}/>{dir.name}</button>)}</>}</div>
    <footer className="connection-footer"><button onClick={onClose}>{text('取消','Cancel')}</button><button className="connection-primary" disabled={!listing.data?.cwd||listing.isFetching||!!listing.error} onClick={()=>{onSelect(listing.data!.cwd);onClose()}}>{text('选择此文件夹','Select this folder')}</button></footer>
  </Dialog>
}

export function ProjectDialog({open,onClose,onCreated}:{open:boolean;onClose:()=>void;onCreated:(project:Project)=>void}){
  const text=useConnectionText(),query=useQueryClient(),devices=useDevices()
  const [name,setName]=useState(''),[device,setDevice]=useState('local'),[cwd,setCwd]=useState(''),[folder,setFolder]=useState<string|null>(null),[ssh,setSsh]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const choose=async()=>{setError('');if(device==='local'&&isTauri()){try{const selected=await pickDirectory({directory:true,multiple:false});if(typeof selected==='string')setCwd(selected)}catch(e){setError(String(e))}}else setFolder(device)}
  const change=(id:string)=>{setDevice(id);setCwd('');setError('')}
  const selectDevice=async(id:string,status:string)=>{
    if(id.startsWith('ssh:')&&!['online','busy'].includes(status)){
      setBusy(true);setError('')
      try{await connections.connect(id);await query.invalidateQueries({queryKey:['devices']});change(id)}catch(e){setError(String(e))}finally{setBusy(false)}
    }else change(id)
  }
  return <><Dialog open={open} onOpenChange={value=>{if(!value&&!busy)onClose()}} title={text('创建项目','Create project')} className="connection-dialog project-dialog">
    <form onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{const project=await connections.createProject({name:name.trim(),device_id:device,cwd});await query.invalidateQueries({queryKey:['named-projects']});await query.invalidateQueries({queryKey:['allMembers']});await query.invalidateQueries({queryKey:['members']});await query.invalidateQueries({queryKey:['crews']});onCreated(project);setName('');setCwd('');onClose()}catch(e){setError(String(e))}finally{setBusy(false)}}}>
      <div className="connection-name"><Folder size={21}/><input aria-label={text('项目名称','Project name')} placeholder={text('项目名称','Project name')} required value={name} onChange={e=>setName(e.target.value)}/></div>
      <h3>{text('源文件夹','Source folder')}</h3><div className="project-source">
        <Menu className="project-host-menu" trigger={<button type="button">{device==='local'?text('在此电脑上添加文件夹','Add folders on this computer'):devices.data?.find(d=>d.id===device)?.name??device}<ChevronDown size={18}/></button>} items={[
          {label:<><Laptop size={18}/>{text('此电脑','This computer')}{device==='local'&&<Check size={16}/>}</>,action:()=>change('local')},
          {label:text('远程设备','Remote devices'),disabled:true,action:()=>{}},
          ...(devices.data??[]).filter(d=>d.id!=='local').map(d=>({label:<><Laptop size={18}/>{d.name}{device===d.id&&<Check size={16}/>}<small>{!['online','busy'].includes(d.status)?text('离线','Offline'):''}</small></>,disabled:busy||!d.id.startsWith('ssh:')&&!['online','busy'].includes(d.status),action:()=>{void selectDevice(d.id,d.status)}})),
          ...(!(devices.data??[]).some(d=>d.id!=='local')?[{label:text('未连接任何远程主机','No remote hosts connected'),disabled:true,action:()=>{}}]:[]),
          {label:<><Plus size={18}/>{text('添加远程主机','Add remote host')}</>,action:()=>setSsh(true)},
        ]}/>
        {cwd?<div className="project-source-path"><Folder size={18}/><span title={cwd}>{cwd}</span><button type="button" onClick={()=>setCwd('')}>×</button></div>:<button className="project-folder-add" type="button" onClick={()=>void choose()}><FolderPlus size={19}/>{text('添加','Add')}</button>}
      </div>{error&&<p className="connection-error" role="alert">{error}</p>}
      <footer className="connection-footer"><button type="button" disabled={busy} onClick={onClose}>{text('取消','Cancel')}</button><button className="connection-primary" disabled={busy||!name.trim()||!cwd}>{busy?text('创建中…','Creating…'):text('创建项目','Create project')}</button></footer>
    </form>
  </Dialog><FolderDialog key={folder??'none'} device={folder} onClose={()=>setFolder(null)} onSelect={setCwd}/><SshDialog open={ssh} onClose={()=>setSsh(false)}/></>
}
