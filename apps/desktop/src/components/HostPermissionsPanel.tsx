import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { axAvailable, axHostPermissions, type HostDecision, type HostPermissionChanges } from '../lib/ax'
import { useLang } from '../lib/i18n'
import { SettingsToggle } from './ui/settings-toggle'

export function HostPermissionsPanel({ surface }: { surface: 'computer' | 'browser' }) {
  const zh = useLang(state => state.lang) === 'zh'
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['ax-host-permissions'], queryFn: () => axHostPermissions(), enabled: axAvailable, retry: false })
  const [target, setTarget] = useState(''), [decision, setDecision] = useState<HostDecision>('ask')
  const save = useMutation({ mutationFn: (changes: HostPermissionChanges) => axHostPermissions(changes), onSuccess: data => client.setQueryData(['ax-host-permissions'], data) })
  const title = surface === 'computer' ? (zh ? '应用权限' : 'Application access') : (zh ? '网站权限' : 'Website access')
  const choices: [HostDecision, string][] = [['ask', zh ? '询问' : 'Ask'], ['allow', zh ? '始终允许' : 'Always allow'], ['deny', zh ? '禁止' : 'Deny']]
  if (!axAvailable) return <section className="settings-card"><h2>{title}</h2><p>{zh ? '请在桌面端管理访问权限。' : 'Manage access in the desktop app.'}</p></section>
  if (!query.data) return <section className="settings-card"><h2>{title}</h2>{query.isPending ? <p aria-busy="true">{zh ? '正在读取权限…' : 'Loading access rules…'}</p> : <><p role="alert">{String(query.error)}</p><button className="settings-secondary" onClick={() => void query.refetch()}>{zh ? '重试' : 'Retry'}</button></>}</section>
  const entries = surface === 'computer' ? query.data.apps : query.data.sites
  return <section className="settings-card host-permissions-panel" aria-busy={save.isPending}>
    <h2>{title}</h2>
    {surface === 'browser' && <SettingsToggle label={zh ? '启用 Browser Use' : 'Enable Browser Use'} checked={query.data.browser_enabled} disabled={save.isPending} onChange={event => save.mutate({ browser_enabled: event.target.checked })} description={zh ? '使用 AX 独立管理的浏览器会话，不共享日常浏览器的登录状态。' : 'Use an AX-owned browser session, separate from your personal browser profile.'}/>}
    <p>{zh ? '访问授权与文件、终端沙箱分别管理。首次访问会询问，可选择仅此次、本会话或始终允许；具体操作仍遵循审批。' : 'Access is separate from the file and terminal sandbox. First use asks for once, session or persistent access; action approvals still apply.'}</p>
    {Object.entries(entries).length === 0 && <p>{zh ? '暂无保存的权限规则。' : 'No saved access rules.'}</p>}
    {Object.entries(entries).map(([id, value]) => <div className="host-permission-row" key={id}>
      <span title={id}>{id}</span>
      <select aria-label={`${title}: ${id}`} value={value} disabled={save.isPending} onChange={event => save.mutate({ surface, target: id, decision: event.target.value as HostDecision })}>{choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button className="settings-secondary" disabled={save.isPending} onClick={() => save.mutate({ surface, target: id, remove: true })}>{zh ? '移除' : 'Remove'}</button>
    </div>)}
    <form className="host-permission-add" onSubmit={event => { event.preventDefault(); if (target.trim()) save.mutate({ surface, target: target.trim(), decision }, { onSuccess: () => setTarget('') }) }}>
      <label htmlFor={`host-${surface}-target`}>{surface === 'computer' ? (zh ? '应用可执行文件的完整路径' : 'Full application executable path') : (zh ? '网站地址（协议、域名及端口）' : 'Website origin (scheme, host and port)')}</label>
      <div className="host-permission-row"><input id={`host-${surface}-target`} value={target} disabled={save.isPending} onChange={event => setTarget(event.target.value)} placeholder={surface === 'computer' ? 'C:/…/app.exe' : 'https://example.com'}/>
        <select aria-label={zh ? '新增规则权限' : 'New rule access'} value={decision} disabled={save.isPending} onChange={event => setDecision(event.target.value as HostDecision)}>{choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <button type="submit" className="settings-secondary" disabled={save.isPending || !target.trim()}>{zh ? '保存' : 'Save'}</button>
      </div>
    </form>
    {save.error && <p className="settings-error" role="alert">{String(save.error)}</p>}
  </section>
}
