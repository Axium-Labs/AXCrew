import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isTauri } from '@tauri-apps/api/core'
import { call as invoke } from '../lib/errors'
import { DiffLines } from './SessionTranscript'
import { useLang } from '../lib/i18n'
import type { ChangedFile } from '../lib/sessionTranscript'

export function SessionChangesPanel({files,selected,onSelect,root}:{files:ChangedFile[];selected?:string;onSelect:(path:string)=>void;root?:string}){
  const lang=useLang(s=>s.lang),[choice,setChoice]=useState<{path?:string;view:'diff'|'file'}>({view:'diff'})
  const file=files.find(file=>file.path===selected)??files[0]
  const view=choice.path===file?.path?choice.view:'diff'
  const setView=(view:'diff'|'file')=>setChoice({path:file?.path,view})
  const content=useQuery({queryKey:['changed-file',root,file?.path,file?.diff],queryFn:()=>invoke<string>('read_workspace_file',{root,relative:file!.path}),enabled:!!root&&!!file&&isTauri()&&view==='file'&&file.change!=='deleted'&&!file.binary,retry:false})
  if(!file)return <div className="session-right-empty">{lang==='zh'?'暂无文件变更':'No file changes'}</div>
  return <div className="session-changes-panel"><div className="session-changes-panel-list" aria-label={lang==='zh'?'修改的文件':'Changed files'}>{files.map(item=><button type="button" aria-pressed={item.path===file.path} className={item.path===file.path?'is-selected':''} key={item.path} onClick={()=>{onSelect(item.path);setView('diff')}}><span>{item.path}</span><b>+{item.additions}</b><em>-{item.deletions}</em></button>)}</div><div className="session-changes-panel-header"><strong title={file.path}>{file.path}</strong><div><button type="button" aria-pressed={view==='diff'} onClick={()=>setView('diff')}>{lang==='zh'?'差异':'Diff'}</button><button type="button" aria-pressed={view==='file'} onClick={()=>setView('file')}>{lang==='zh'?'文件':'File'}</button></div></div><div className="session-changes-panel-content">{view==='diff'?(file.diff?<DiffLines diff={file.diff}/>:<p>{file.binary?(lang==='zh'?'二进制文件已更改，无法显示文本差异。':'Binary file changed; a text diff is unavailable.'):(lang==='zh'?'此记录未保存文件差异。':'No diff was saved for this record.')}</p>):file.change==='deleted'?<p>{lang==='zh'?'此文件已删除，可在差异中查看删除的内容。':'This file was deleted. View its removed contents in Diff.'}</p>:file.binary?<p>{lang==='zh'?'二进制文件无法显示为文本。':'Binary files cannot be displayed as text.'}</p>:content.isLoading?<p>{lang==='zh'?'读取中…':'Loading…'}</p>:content.error?<p role="alert">{String(content.error)}</p>:content.data!==undefined?<pre>{content.data}</pre>:<p>{lang==='zh'?'文件内容可在本地桌面端查看。':'File contents can be viewed in the local desktop app.'}</p>}</div></div>
}
