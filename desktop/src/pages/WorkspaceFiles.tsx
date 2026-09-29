import { useEffect, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Copy, FileText, Folder, Search } from 'lucide-react'
import type { Member } from '../lib/types'

type FileEntry={name:string;is_dir:boolean;size:number}
type Listing={path:string;entries:FileEntry[]}

export function WorkspaceFiles({member,onReference}:{member?:Member;onReference?:(path:string)=>void}){
  const [relative,setRelative]=useState(''),[selectedFile,setSelectedFile]=useState(''),[filter,setFilter]=useState('')
  useEffect(()=>{setRelative('');setSelectedFile('');setFilter('')},[member?.id])
  const available=!!member&&member.device_id==='local'&&isTauri()
  const listing=useQuery({queryKey:['workspaceFiles',member?.id,member?.cwd,relative],queryFn:()=>invoke<Listing>('list_workspace_files',{root:member!.cwd,relative}),enabled:available&&!selectedFile,retry:0})
  const preview=useQuery({queryKey:['workspacePreview',member?.id,member?.cwd,selectedFile],queryFn:()=>invoke<string>('read_workspace_file',{root:member!.cwd,relative:selectedFile}),enabled:available&&!!selectedFile,retry:0})
  const enter=(name:string)=>{setRelative(value=>value?`${value}/${name}`:name);setFilter('')}
  const select=(name:string)=>setSelectedFile(relative?`${relative}/${name}`:name)
  const up=()=>{setRelative(value=>value.split('/').slice(0,-1).join('/'));setFilter('')}
  const entries=listing.data?.entries.filter(entry=>entry.name.toLowerCase().includes(filter.toLowerCase()))??[]

  return <div className="session-files-view">
    <div className="session-right-path" title={member?.cwd??''}><span>{member?.cwd??'未选择工作区'}</span><button title="复制路径" aria-label="复制路径" disabled={!member?.cwd} onClick={()=>{if(member?.cwd)void navigator.clipboard.writeText(member.cwd)}}><Copy size={15}/></button></div>
    {!member?<div className="session-right-empty"><Folder size={34}/><strong>工作目录</strong><p>建立会话后即可查看工作目录。</p></div>
    :member.device_id!=='local'?<div className="session-right-empty"><Folder size={34}/><strong>远程工作目录</strong><p>{member.cwd}</p><small>当前只能浏览本机成员的文件。</small></div>
    :!isTauri()?<div className="session-right-empty"><Folder size={34}/><strong>桌面文件浏览</strong><p>请在 AX Crew 桌面应用中查看文件。</p></div>
    :selectedFile?<><div className="session-files-breadcrumb"><button onClick={()=>setSelectedFile('')}><ArrowLeft size={16}/> 返回文件列表</button><span>{selectedFile}</span>{onReference&&<button onClick={()=>onReference(`${member.cwd.replace(/[\\/]$/,'')}/${selectedFile}`)}>引用到消息</button>}</div><div className="session-file-preview">{preview.isLoading?'正在读取文件…':preview.error?<div className="session-inline-error">{String(preview.error)}</div>:<pre>{preview.data}</pre>}</div></>
    :<><div className="session-files-breadcrumb"><button onClick={()=>setRelative('')}><Folder size={15}/> 工作目录</button>{relative.split('/').filter(Boolean).map((part,index)=><span key={`${index}-${part}`}><ChevronRight size={13}/><button onClick={()=>setRelative(relative.split('/').slice(0,index+1).join('/'))}>{part}</button></span>)}</div><div className="session-files-filter"><Search size={15}/><input aria-label="筛选文件" value={filter} onChange={event=>setFilter(event.target.value)} placeholder="筛选文件…"/></div><div className="session-files-list">{relative&&<button className="session-file-row" onClick={up}><Folder size={17}/><span>..</span></button>}{listing.isLoading?<div className="session-files-message">正在读取目录…</div>:listing.error?<div className="session-inline-error">无法读取目录：{String(listing.error)}</div>:entries.length?entries.map(entry=><button className="session-file-row" key={entry.name} onClick={()=>entry.is_dir?enter(entry.name):select(entry.name)}>{entry.is_dir?<Folder size={17}/>:<FileText size={17}/>}<span title={entry.name}>{entry.name}</span>{entry.is_dir&&<ChevronRight size={14}/>}</button>):<div className="session-files-message">{filter?'没有匹配的文件':'目录为空'}</div>}</div></>}
  </div>
}
