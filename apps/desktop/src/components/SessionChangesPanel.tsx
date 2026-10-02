import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { DiffLines } from './SessionTranscript'
import { useLang } from '../lib/i18n'
import type { ChangedFile } from '../lib/sessionTranscript'

export function SessionChangesPanel({files,selected,onSelect,root}:{files:ChangedFile[];selected?:string;onSelect:(path:string)=>void;root?:string}){
  const lang=useLang(s=>s.lang),[view,setView]=useState<'diff'|'file'>('diff')
  const file=files.find(file=>file.path===selected)??files[0]
  const content=useQuery({queryKey:['changed-file',root,file?.path],queryFn:()=>invoke<string>('read_workspace_file',{root,relative:file!.path}),enabled:!!root&&!!file&&isTauri()&&(view==='file'||!file.diff),retry:false})
  if(!file)return <div className="session-right-empty">{lang==='zh'?'暂无文件变更':'No file changes'}</div>
  return <div className="session-changes-panel"><div className="session-changes-panel-list">{files.map(item=><button type="button" className={item.path===file.path?'is-selected':''} key={item.path} onClick={()=>onSelect(item.path)}><span>{item.path}</span><b>+{item.additions}</b><em>-{item.deletions}</em></button>)}</div><div className="session-changes-panel-header"><strong title={file.path}>{file.path}</strong><div><button type="button" aria-pressed={view==='diff'} onClick={()=>setView('diff')}>{lang==='zh'?'差异':'Diff'}</button><button type="button" aria-pressed={view==='file'} onClick={()=>setView('file')}>{lang==='zh'?'文件':'File'}</button></div></div><div className="session-changes-panel-content">{view==='diff'&&file.diff?<DiffLines diff={file.diff}/>:content.isLoading?<p>{lang==='zh'?'读取中…':'Loading…'}</p>:content.error?<p role="alert">{String(content.error)}</p>:content.data!==undefined?<pre>{content.data}</pre>:<p>{lang==='zh'?'此记录未保存差异；文件内容可在本地桌面端查看。':'No saved diff. File contents can be viewed in the local desktop app.'}</p>}</div></div>
}
