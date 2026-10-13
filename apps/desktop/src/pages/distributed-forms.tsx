import { useState } from 'react'
import { getConnection } from '../lib/api'
import { distributed, type Cluster } from '../lib/distributed'
import { Field } from '../components/shared'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Dialog } from '../components/ui/dialog'
import { Download } from 'lucide-react'
export type Label = (cn:string,en:string)=>string
export const list=(value:string)=>value.split(',').map(s=>s.trim()).filter(Boolean)
const number=(value:string)=>Math.max(0,Number(value)||0)
export const fileDownload=(name:string,content:BlobPart,type='application/json')=>{
  const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a')
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}

export { CreateTask } from './distributed-create'
export type FormProps={open:boolean;close:()=>void;state?:Cluster;run:(action:()=>Promise<unknown>)=>Promise<void>;busy:boolean;error:string;label:(cn:string,en:string)=>string}
export function Enroll({open,close,run,busy,label,error}:FormProps){
  const [form,setForm]=useState({host_id:'',host_name:'',name:'AX-code',project:'project-ax',path:'',concurrency:'1',gateway:'',delegate:true,management:false})
  const [config,setConfig]=useState<Record<string,unknown>|null>(null)
  const field=(key:keyof typeof form,cn:string,en:string,placeholder='')=><Field label={label(cn,en)}><Input value={String(form[key])} placeholder={placeholder} onChange={e=>setForm({...form,[key]:e.target.value})}/></Field>
  return <Dialog open={open} onOpenChange={value=>{if(!value){setConfig(null);close()}}} title={label('添加 AX 实例','Add AX instance')}>{error&&<p role="alert" className="ax-notice is-error is-flush">{error}</p>}{config?<><p className="mb-4 text-sm text-muted">{label('保存配置到目标机器，核对本地路径、AX_HOME、模型和权限后运行。配置包含该实例的私有凭证。','Save this config on the target machine. Check local paths, AX_HOME, model and permissions, then run. It contains this instance’s private credential.')}</p><pre className="cluster-config">{JSON.stringify(config,null,2)}</pre><pre className="cluster-config">ax crew worker worker.json</pre><Button onClick={()=>fileDownload('worker.json',JSON.stringify(config,null,2))}><Download size={14}/>{label('下载 worker 配置','Download worker config')}</Button></>:<div className="cluster-form"><p className="text-sm text-muted">{label('同一台机器的实例请使用相同 Host ID。Worker 会主动连接 AXCrew，不要求机器开放入站端口。','Instances on the same machine must use the same Host ID. Workers connect outbound to AXCrew; no inbound port is needed.')}</p><div className="cluster-form-grid">{field('host_id','Host ID','Host ID','build-server-01')}{field('host_name','机器名称','Host name')}{field('name','AX 名称','AX name')}{field('project','逻辑项目 ID','Logical project ID')}{field('path','此机器上的项目路径','Local project path','D:\\AX or /srv/AX')}{field('gateway','AXCrew 地址（远程使用 HTTPS）','AXCrew URL (HTTPS for remote)','https://crew.example.com')}</div>
      <p className="text-sm text-muted">{label('AX 连接后自动检测 CPU、RAM、GPU，并在 Host 页面展示机器状态。Skill、MCP、Tool 和模型等在连接后的 AX 实例页面配置。','AX detects CPU, RAM and GPUs after connecting. View machine status under Hosts and configure skills, MCP, tools and models under AX instances after connection.')}</p>
      <div className="cluster-form-grid">{field('concurrency','并发 Execution 数','Concurrent executions')}<label className="cluster-check"><input type="checkbox" checked={form.delegate} onChange={e=>setForm({...form,delegate:e.target.checked})}/>{label('允许 AX 自主委派','Allow AX delegation')}</label></div>
      <label className="cluster-check"><input type="checkbox" checked={form.management} onChange={e=>setForm({...form,management:e.target.checked})}/>{label('允许管理员远程管理此 AX 的设置与插件','Allow administrator to manage this AX settings and plugins remotely')}</label>
      <Button disabled={busy||!form.host_id||!form.name||!form.project||!form.path||number(form.concurrency)<1} onClick={()=>void run(async()=>{
        const connection=await getConnection();const result=await distributed.enroll({host_id:form.host_id,host_name:form.host_name||form.host_id,name:form.name,projects:[form.project],max_executions:number(form.concurrency),can_delegate:form.delegate})
        setConfig({gateway:form.gateway||connection.endpoint,instance_id:result.instance.id,token:result.token,projects:{[form.project]:form.path},execution_root:'./executions/'+result.instance.id,ax_home:'./ax-home/'+result.instance.id,max_executions:number(form.concurrency),permission_profile:'ask',sandbox:'strict',remote_management:form.management})
      })}>{label('注册并生成配置','Register and generate config')}</Button></div>}</Dialog>
}
