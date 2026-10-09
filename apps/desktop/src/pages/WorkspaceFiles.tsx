import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { call as invoke } from '../lib/errors'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Copy, FileText, Folder, Search } from 'lucide-react'
import type { Member } from '../lib/types'
import { useT } from '../lib/i18n'

type FileEntry={name:string;is_dir:boolean;size:number}
type Listing={path:string;entries:FileEntry[]}

export function WorkspaceFiles({member,root:workspaceRoot,onReference}:{member?:Member;root?:string;onReference?:(path:string)=>void}){
  const t=useT()
  const root=member?.cwd??workspaceRoot
  const [relative,setRelative]=useState(''),[selectedFile,setSelectedFile]=useState(''),[filter,setFilter]=useState('')
  useEffect(()=>{setRelative('');setSelectedFile('');setFilter('')},[member?.id,root])
  const available=!!root&&(!member||member.device_id==='local')&&isTauri()
  const listing=useQuery({queryKey:['workspaceFiles',member?.id,root,relative],queryFn:()=>invoke<Listing>('list_workspace_files',{root,relative}),enabled:available&&!selectedFile,retry:0})
  const preview=useQuery({queryKey:['workspacePreview',member?.id,root,selectedFile],queryFn:()=>invoke<string>('read_workspace_file',{root,relative:selectedFile}),enabled:available&&!!selectedFile,retry:0})
  const enter=(name:string)=>{setRelative(value=>value?`${value}/${name}`:name);setFilter('')}
  const select=(name:string)=>setSelectedFile(relative?`${relative}/${name}`:name)
  const up=()=>{setRelative(value=>value.split('/').slice(0,-1).join('/'));setFilter('')}
  const entries=listing.data?.entries.filter(entry=>entry.name.toLowerCase().includes(filter.toLowerCase()))??[]

  return <div className="session-files-view">
    <div className="session-right-path" title={root??''}><span>{root??t('files.noWorkspace')}</span><button title={t('files.copyPath')} aria-label={t('files.copyPath')} disabled={!root} onClick={()=>{if(root)void navigator.clipboard.writeText(root!)}}><Copy size={15}/></button></div>
    {!root?<div className="session-right-empty"><Folder size={34}/><strong>{t('files.workdir')}</strong><p>{t('files.workdirHint')}</p></div>
    :member&&member.device_id!=='local'?<div className="session-right-empty"><Folder size={34}/><strong>{t('files.remoteWorkdir')}</strong><p>{root!}</p><small>{t('files.localOnly')}</small></div>
    :!isTauri()?<div className="session-right-empty"><Folder size={34}/><strong>{t('files.title')}</strong><p>{t('files.desktopOnly')}</p></div>
    :selectedFile?<><div className="session-files-breadcrumb"><button onClick={()=>setSelectedFile('')}><ArrowLeft size={16}/> {t('files.backToList')}</button><span>{selectedFile}</span>{onReference&&<button onClick={()=>onReference(`${root!.replace(/[\\/]$/,'')}/${selectedFile}`)}>{t('files.referenceIntoMessage')}</button>}</div><div className="session-file-preview">{preview.isLoading?t('files.loading'):preview.error?<div className="session-inline-error">{String(preview.error)}</div>:<pre>{preview.data}</pre>}</div></>
    :<><div className="session-files-breadcrumb"><button onClick={()=>setRelative('')}><Folder size={15}/> {t('files.workdir')}</button>{relative.split('/').filter(Boolean).map((part,index)=><span key={`${index}-${part}`}><ChevronRight size={13}/><button onClick={()=>setRelative(relative.split('/').slice(0,index+1).join('/'))}>{part}</button></span>)}</div><div className="session-files-filter"><Search size={15}/><input aria-label={t('files.search')} value={filter} onChange={event=>setFilter(event.target.value)} placeholder={t('files.searchPlaceholder')}/></div><div className="session-files-list">{relative&&<button className="session-file-row" onClick={up}><Folder size={17}/><span>..</span></button>}{listing.isLoading?<div className="session-files-message">{t('files.readingDirectory')}</div>:listing.error?<div className="session-inline-error">{t('files.readFailed')}{String(listing.error)}</div>:entries.length?entries.map(entry=><button className="session-file-row" key={entry.name} onClick={()=>entry.is_dir?enter(entry.name):select(entry.name)}>{entry.is_dir?<Folder size={17}/>:<FileText size={17}/>}<span title={entry.name}>{entry.name}</span>{entry.is_dir&&<ChevronRight size={14}/>}</button>):<div className="session-files-message">{filter?t('files.noMatch'):t('files.emptyDirectory')}</div>}</div></>}
  </div>
}
