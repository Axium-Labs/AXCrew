import { useState } from 'react'
import { getConnection } from '../lib/api'
import { distributed, type Cluster, type Workflow } from '../lib/distributed'
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

export function CreateTask({open,close,state,run,busy,label,error,workflow,onCreated}:{workflow?:Workflow;onCreated?:(id:string)=>void}&FormProps){
  const [form,setForm]=useState({kind:'task',title:'',input:'',project:'',instance:'',role:'',cpu:'1',ram:'0',gpu:'0',revision:'',summary:'',skills:'',mcp:'',model:'',acceptance:'',long:false,automatic:true,template:''})
  const [dependencies,setDependencies]=useState<string[]>([])
  const projects=[...new Set(Object.values(state?.instances??{}).flatMap(i=>i.projects))]
  const project=workflow?.project_id||form.project||projects[0]||''
  const instances=Object.values(state?.instances??{}).filter(i=>i.projects.includes(project)&&(!workflow?.collaboration?.participants||!Object.keys(workflow.collaboration.participants).length||i.id in workflow.collaboration.participants))
  const field=(key:'title'|'role'|'cpu'|'ram'|'gpu'|'revision'|'summary'|'skills'|'mcp'|'model',cn:string,en:string)=><Field label={label(cn,en)}><Input value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></Field>
  return <Dialog open={open} onOpenChange={value=>{if(!value)close()}} title={workflow?label('添加工作任务','Add work task'):label('创建协作','Create collaboration')}>
    {error&&<p role="alert" className="ax-notice is-error is-flush">{error}</p>}
    <div className="cluster-form">
      {!workflow&&<Field label={label('协作类型','Collaboration type')}><select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}><option value="task">{label('普通协作任务','Collaboration task')}</option><option value="goal">{label('Goal · 持续追求目标','Goal · pursue an objective')}</option></select></Field>}
      {field('title','标题','Title')}
      <Field label={label('需要完成什么','What needs to be done')}><textarea rows={4} value={form.input} onChange={e=>setForm({...form,input:e.target.value})}/></Field>
      <div className="cluster-form-grid"><Field label={label('项目','Project')}><select disabled={!!workflow} value={project} onChange={e=>setForm({...form,project:e.target.value,instance:''})}>{projects.map(p=><option key={p}>{p}</option>)}</select></Field><Field label={label('执行 AX','Execution AX')}><select value={form.instance} onChange={e=>setForm({...form,instance:e.target.value})}><option value="">{label('自动分配','Automatic placement')}</option>{instances.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></Field></div>
      {!workflow&&form.kind==='goal'&&<><Field label={label('验收标准（每行一条）','Acceptance criteria (one per line)')}><textarea rows={3} value={form.acceptance} onChange={e=>setForm({...form,acceptance:e.target.value})}/></Field><label className="cluster-check"><input type="checkbox" checked={form.long} onChange={e=>setForm({...form,long:e.target.checked})}/>{label('启用 Long Project','Enable Long Project')}</label>{form.long&&<><label className="cluster-check"><input type="checkbox" checked={form.automatic} onChange={e=>setForm({...form,automatic:e.target.checked})}/>{label('自动 Session Rotation','Automatic Session Rotation')}</label><Field label={label('PROJECT_STATE 自定义模板（可选）','Custom PROJECT_STATE template (optional)')}><textarea rows={3} value={form.template} onChange={e=>setForm({...form,template:e.target.value})}/></Field><p className="text-sm text-muted">{label('沿用 AX 的 Goal、预算与权限。轮换保持同一目标和累计消耗。','Uses AX Goal budgets and permissions. Rotation retains identity and cumulative usage.')}</p></>}</>}
      <details><summary>{label('依赖与执行要求','Dependencies and execution requirements')}</summary><div className="cluster-form cluster-advanced"><div className="cluster-form-grid">{field('role','需要的能力角色','Required capability role')}{field('model','模型要求','Required model')}{field('skills','Skill（逗号分隔）','Skills (comma separated)')}{field('mcp','MCP（逗号分隔）','MCP (comma separated)')}{field('cpu','预留 CPU 核数','Reserved CPU cores')}{field('ram','预留内存（MiB）','Reserved memory (MiB)')}{field('gpu','预留 GPU 数量','Reserved GPUs')}{field('revision','Git commit（可选）','Git commit (optional)')}</div>{field('summary','必要的上下文','Necessary context')}<Field label={label('依赖任务','Dependencies')}><div className="cluster-options">{Object.values(state?.tasks??{}).filter(t=>t.spec.project_id===project&&(!workflow||t.spec.workflow_id===workflow.id)).map(t=><label key={t.id} className="cluster-check"><input type="checkbox" checked={dependencies.includes(t.id)} onChange={e=>setDependencies(e.target.checked?[...dependencies,t.id]:dependencies.filter(id=>id!==t.id))}/>{t.spec.title} · {t.status}</label>)}</div></Field></div></details>
      <Button disabled={busy||!form.title.trim()||!form.input.trim()||!project||(!workflow&&form.kind==='goal'&&!form.acceptance.trim())} onClick={()=>void run(async()=>{
        const input=!workflow&&form.kind==='goal'?`/goal create ${JSON.stringify({target:form.input,acceptance:form.acceptance.split('\n').map(s=>s.trim()).filter(Boolean),long_project:form.long?{enabled:true,rotation:{automatic:form.automatic},...(form.template?{template:form.template}:{})}:{enabled:false}})}`:form.input
        const t=await distributed.submit({request_id:crypto.randomUUID(),title:form.title,input,project_id:project,workflow_id:workflow?.id,context_summary:form.summary,workspace_revision:form.revision||null,dependencies:dependencies.filter(id=>state?.tasks[id]?.spec.project_id===project),requirements:{instance_id:form.instance||null,capabilities:{roles:list(form.role),models:list(form.model),skills:list(form.skills),mcp:list(form.mcp)},resources:{cpu:number(form.cpu),ram_mb:number(form.ram),gpu:number(form.gpu)}},...(!workflow?{collaboration:{kind:form.kind,paused:false,participants:{},requirements:{}}}:{})})
        onCreated?.(t.spec.workflow_id??'');setForm({...form,title:'',input:'',acceptance:''});setDependencies([]);close()
      })}>{label('开始协作','Start collaboration')}</Button>
    </div>
  </Dialog>
}
