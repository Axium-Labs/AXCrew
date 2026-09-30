import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Check, Copy, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react'
import { Dialog } from './ui/dialog'
import { useT } from '../lib/i18n'
import './provider-login.css'

type LoginEvent = { id: string; message: string; url: string | null; code?: string | null; done: boolean; success: boolean }

export function ProviderLogin({provider,name,onClose,onSuccess}:{provider:string;name:string;onClose:()=>void;onSuccess:()=>void}) {
  const t = useT()
  const [url,setUrl] = useState(''),[code,setCode] = useState(''),[done,setDone] = useState(false),[error,setError] = useState('')
  const [copied,setCopied]=useState(''),[opening,setOpening]=useState(false),[attempt,setAttempt]=useState(0)
  useEffect(()=>{
    let disposed=false,id='',unlisten:(()=>void)|undefined
    const pending:LoginEvent[]=[]
    const process=(event:LoginEvent)=>{
      if(disposed||event.id!==id)return
      if(event.url)setUrl(event.url)
      if(event.code)setCode(event.code)
      if(event.done){setDone(true);if(event.success)onSuccess();else setError('login.failed')}
      // Diagnostic errors are kept separate from the localized instructions.
      if(/^Error:/.test(event.message))setError(event.message.replace(/^Error:\s*/,''))
    }
    void(async()=>{
      try{
        unlisten=await listen<LoginEvent>('ax-login',event=>{if(!id)pending.push(event.payload);else process(event.payload)})
        if(disposed){unlisten();return}
        id=await invoke<string>('ax_begin_login',{provider})
        if(disposed){void invoke('ax_cancel_login',{id});return}
        pending.splice(0).forEach(process)
      }catch(reason){if(!disposed){setDone(true);setError(String(reason))}}
    })()
    return()=>{disposed=true;unlisten?.();if(id)void invoke('ax_cancel_login',{id}).catch(()=>{})}
    // A language switch updates the visible instructions without restarting OAuth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[provider,attempt])
  useEffect(()=>{if(copied){const timer=setTimeout(()=>setCopied(''),2000);return()=>clearTimeout(timer)}},[copied])
  const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);setCopied(value);setError('')}catch(reason){setError(String(reason))}}
  const openBrowser=async()=>{setOpening(true);try{await invoke('ax_open_login_url',{url});setError('')}catch(reason){setError(String(reason))}finally{setOpening(false)}}
  return <Dialog open onOpenChange={open=>{if(!open)onClose()}} title={`${t('login.title')} · ${name}`}>
    <div className="provider-login">
    <p>{t('login.instructions')}</p>
    {url?<div className="provider-login-link"><a href={url} onClick={event=>{event.preventDefault();void openBrowser()}}>{url}</a><div className="provider-login-actions"><button type="button" className="is-primary" disabled={opening} onClick={()=>void openBrowser()}>{opening?<LoaderCircle className="is-spinning" size={16}/>:<ExternalLink size={16}/>} {t('login.openBrowser')}</button><button type="button" aria-label={t('login.copyUrl')} onClick={()=>void copy(url)}>{copied===url?<Check size={16}/>:<Copy size={16}/>} {t(copied===url?'login.copied':'login.copyUrl')}</button></div></div>:!done&&<p role="status"><LoaderCircle className="is-spinning" size={16}/> {t('login.preparing')}</p>}
    {code&&<div className="provider-login-actions"><code>{code}</code><button onClick={()=>void copy(code)}>{copied===code?<Check size={16}/>:<Copy size={16}/>} {t(copied===code?'login.copied':'login.copyCode')}</button></div>}
    <p role="status">{done&&!error?t('login.success'):!done&&url?t('login.waiting'):''}</p>
    {error&&<p role="alert" className="settings-notice is-error">{error==='login.failed'?t(error):error}</p>}
    <button type="button" className="settings-secondary" onClick={onClose}>{done?t('login.close'):t('common.cancel')}</button>
    {done&&error&&<button type="button" onClick={()=>{setUrl('');setCode('');setDone(false);setError('');setAttempt(value=>value+1)}}><RefreshCw size={16}/> {t('login.retry')}</button>}
    <span className="sr-only" role="status">{copied?t('login.copied'):''}</span>
    </div>
  </Dialog>
}
