import { useState } from 'react'
import { distributed, type AxInstance, type Capabilities, type ClusterHost } from '../lib/distributed'
import { Field } from '../components/shared'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Dialog } from '../components/ui/dialog'

type Label = (cn:string,en:string)=>string
const list=(value:string)=>value.split(',').map(s=>s.trim()).filter(Boolean)

export function HostDetails({host,label}:{host:ClusterHost;label:Label}){
  const info=host.inventory,unknown=label('未知','Unknown')
  if(!info)return <p className="text-sm text-muted">{label('等待 AX 自动检测机器配置；连接前不预设 CPU、RAM 或 GPU 数量。','Awaiting automatic AX hardware detection; CPU, RAM and GPU capacity is unknown until connected.')}</p>
  return <div className="cluster-hardware">
    <div><span>{label('机器 / 系统','Machine / OS')}</span><b>{info.hostname||host.name} · {info.os} / {info.arch}</b></div>
    <div><span>{label('CPU 逻辑核数','Logical CPU cores')}</span><b>{info.cpu}{info.cpu_name&&` · ${info.cpu_name}`}</b></div>
    <div><span>RAM</span><b>{info.ram_mb===null?unknown:`${info.ram_mb} MiB`}</b></div>
    <div><span>{label('GPU 数量','GPU count')}</span><b>{info.gpu??unknown}{info.gpu_names.length>0&&` · ${info.gpu_names.join(', ')}`}</b></div>
    <div><span>{label('上次检测','Last detected')}</span><b>{host.inventory_at?new Date(host.inventory_at*1000).toLocaleString():unknown}</b></div>
    {info.errors.length>0&&<p className="text-sm text-muted">{label('部分信息检测失败','Some inventory fields could not be detected')}: {info.errors.join('; ')}</p>}
  </div>
}

export function ConfigureInstance({instance,close,run,busy,label,error}:{instance:AxInstance;close:()=>void;run:(action:()=>Promise<unknown>)=>Promise<void>;busy:boolean;label:Label;error:string}){
  const caps=instance.pending_capabilities??instance.capabilities
  const [form,setForm]=useState({...Object.fromEntries(Object.entries(caps).map(([key,values])=>[key,values.join(', ')])),provider:'',skills_dir:'',mcp_config:''} as Record<string,string>)
  const [settings,setSettings]=useState<Record<string,unknown>|null>(null)
  const field=(key:string,cn:string,en:string)=><Field label={label(cn,en)}><Input value={form[key]??''} onChange={e=>setForm({...form,[key]:e.target.value})}/></Field>
  const download=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(settings,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='worker-settings.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  return <Dialog open onOpenChange={open=>{if(!open)close()}} title={`${label('配置 AX 能力','Configure AX capabilities')} · ${instance.name}`}>
    {error&&<p role="alert" className="text-danger mb-4">{error}</p>}
    {settings?<div className="cluster-detail"><p>{label('配置已保存为待生效。将以下字段合并到目标机器原有 worker.json，安装或配置对应 Skill/MCP 后重启 Worker。保留原有连接凭证和项目路径；AX 回传实际能力后才用于调度。','Configuration saved as pending. Merge these fields into the target machine’s existing worker.json, install/configure the selected skills and MCP, then restart the worker. Keep connection credentials and project mappings. Scheduling uses capabilities reported by AX.')}</p><pre>{JSON.stringify(settings,null,2)}</pre><Button onClick={download}>{label('下载配置字段','Download settings')}</Button></div>:<div className="cluster-form">
      <p className="text-sm text-muted">{label('这里配置已连接实例的能力。Skill/MCP 必须在目标机器安装并启用；Tool 名称填写 AX 内置工具，MCP 工具通过 MCP 配置。模型填写一个 ID，认证保留在目标机器。','Configure a connected instance. Install and enable skills/MCP locally. Tool names select AX built-ins; configure MCP tools through MCP. Use one model ID; credentials stay on the target machine.')}</p>
      <div className="cluster-form-grid">
        {field('roles','角色（逗号分隔）','Roles (comma separated)')}{field('models','模型 ID','Model ID')}{field('provider','Provider ID（可选）','Provider ID (optional)')}{field('skills','Skill 名称','Skill names')}{field('skills_dir','目标机器 Skill 目录（可选）','Local skill directory (optional)')}{field('mcp','MCP 名称','MCP names')}{field('mcp_config','目标机器 MCP 配置路径（可选）','Local MCP config path (optional)')}{field('tools','Tool 名称','Tool names')}{field('environments','环境标签','Environment tags')}
        <Field label={label('执行权限','Execution permissions')}><select value={form.permissions||'ask'} onChange={e=>setForm({...form,permissions:e.target.value})}><option value="ask">Ask</option><option value="allow">Allow</option><option value="deny">Deny</option></select></Field>
      </div>
      <Button disabled={busy||list(form.models??'').length>1} onClick={()=>void run(async()=>{
        const next=Object.fromEntries(['roles','skills','mcp','tools','models','permissions','environments'].map(key=>[key,list(key==='permissions'?(form[key]||'ask'):(form[key]??''))])) as Capabilities
        await distributed.configure(instance.id,next)
        setSettings({roles:next.roles,skills:next.skills,mcp:next.mcp,tools:next.tools,model:next.models[0]??null,environments:next.environments,permission_profile:next.permissions[0],...(form.provider?{provider:form.provider}:{}),...(form.skills_dir?{skills_dir:form.skills_dir}:{}),...(form.mcp_config?{mcp_config:form.mcp_config}:{})})
      })}>{label('保存并生成本地配置','Save and generate local settings')}</Button>
    </div>}
  </Dialog>
}
