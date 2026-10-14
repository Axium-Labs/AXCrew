import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Field } from '../components/shared'
import { Disclosure } from '../components/ui/disclosure'
import { distributed, historyInstance, modelKey, parseModel, type Workflow, type DistributedTask, type ExecutionModel } from '../lib/distributed'
import { ModelPicker } from './distributed-models'
import { list } from './distributed-forms'
import { ClusterStatus, isOnline } from './distributed-ui'
import type { WorkbenchProps } from './Distributed'

export function workflowObjective(state:WorkbenchProps['state'],w:Workflow){
  if(w.objective!=null)return w.objective
  const input=state.tasks[w.root_task_id]?.spec.input??''
  if(input.startsWith('/goal create ')){try{return String(JSON.parse(input.slice(13)).target??'')}catch{return input}}
  return input
}

export function GoalPolicy({state,workflow:w,label,busy,run,close,error}:WorkbenchProps&{workflow:Workflow;close:()=>void}){
  const [base]=useState(w)
  // Runtime checkpoints/status may advance the revision while the form is open.
  // Only an actual change to editable fields makes the draft stale; final save still uses CAS.
  const editablePolicy=(value:Workflow)=>JSON.stringify([value.title,value.objective,value.collaboration?.kind,value.collaboration?.participants,value.collaboration?.requirements,value.collaboration?.member_models,value.collaboration?.excluded_instances])
  const stale=!!w.removed||editablePolicy(w)!==editablePolicy(base)
  const [baseTitle]=useState(w.title)
  const [baseObjective]=useState(workflowObjective(state,w))
  const [baseParticipants]=useState(w.collaboration?.participants??{})
  const [baseMemberModels]=useState<Record<string,ExecutionModel>>(w.collaboration?.member_models??{})
  const [baseSkills]=useState(w.collaboration?.requirements.skills?.join(', ')??'')
  const [baseMcp]=useState(w.collaboration?.requirements.mcp?.join(', ')??'')
  const [baseModels]=useState(w.collaboration?.requirements.models?.join(', ')??'')
  const [baseExcluded]=useState(w.collaboration?.excluded_instances??[])
  const [title,setTitle]=useState(baseTitle),[objective,setObjective]=useState(baseObjective)
  const [participantDraft,setParticipants]=useState(baseParticipants)
  const [memberModels,setMemberModels]=useState<Record<string,ExecutionModel>>(baseMemberModels)
  const [skills,setSkills]=useState(baseSkills)
  const [mcp,setMcp]=useState(baseMcp)
  const [models,setModels]=useState(baseModels)
  const [excluded,setExcluded]=useState(baseExcluded)
  const [search,setSearch]=useState('')
  const [newWork,setNewWork]=useState<Record<string,{key:string;title:string;input:string}>>({})
  const members=Object.values(state.instances).filter(i=>i.projects.includes(w.project_id))
  const memberIds=new Set(members.map(i=>i.id))
  // Recompute against live enrollment, including deletion while this dialog is open.
  const participants=Object.fromEntries(Object.entries(participantDraft).filter(([id])=>memberIds.has(id)))
  const unavailableMembers=Object.keys(participantDraft).filter(id=>!memberIds.has(id))
  const toggle=(id:string,selected:boolean)=>{
    setParticipants(current=>{const next={...current};if(selected)next[id]='';else delete next[id];return next})
    setExcluded(current=>selected?current.filter(value=>value!==id):[...new Set([...current,id])])
  }
  const save=()=>run(async()=>{
    await distributed.settings(w,{title:title.trim(),objective,kind:w.collaboration?.kind||'task',participants,
      member_models:Object.fromEntries(Object.entries(memberModels).filter(([id])=>id in participants)),excluded_instances:excluded.filter(id=>memberIds.has(id)),
      new_tasks:Object.entries(newWork).filter(([id])=>id in participants).map(([id,t])=>({request_id:t.key,title:t.title.trim(),input:t.input,project_id:w.project_id,requirements:{instance_id:id}})),
      requirements:{...w.collaboration?.requirements,models:list(models),skills:list(skills),mcp:list(mcp)}})
    close()
  })
  return <Dialog open wide className="cluster-edit-dialog" title={label('编辑协作','Edit collaboration')} onOpenChange={open=>{if(!open&&!busy)close()}}>
    <div className="cluster-edit-body cluster-form">
      {error&&<p role="alert" className="text-danger">{error}</p>}
      <Field label={label('协作名称','Collaboration name')}><Input aria-label={label('协作名称','Collaboration name')} value={title} maxLength={512} onChange={e=>setTitle(e.target.value)}/></Field>
      <Field label={label('目标说明','Objective description')}><textarea aria-label={label('目标说明','Objective description')} rows={3} value={objective} onChange={e=>setObjective(e.target.value)}/></Field>
      <p className="cluster-edit-note">{label('目标说明用于组织协作。修改具体执行内容请编辑工作任务；已执行任务可通过 Session 补充要求。','The objective describes this collaboration. Edit work tasks to change execution content; use Session guidance for tasks that have already started.')}</p>
      <section className="cluster-form"><div className="cluster-section-head"><h3>{label('参与 AX','Participating AX')}</h3><span className="text-muted">{Object.keys(participants).length} {label('已选择','selected')}</span></div>
        <p className="cluster-edit-note">{label('移除成员会停止其在此协作中的执行并重新分配任务。新增成员可参与现有任务，也可选填新工作；未选择成员时按能力自动匹配未排除的 AX。','Removing a member fences its work in this collaboration and reassigns tasks. Added members can take existing work or an optional new task. With no selected members, eligible non-excluded AX instances are matched automatically.')}</p>
        {members.length>4&&<Input aria-label={label('搜索成员','Search members')} placeholder={label('搜索 AX 或 Host','Search AX or Host')} value={search} onChange={e=>setSearch(e.target.value)}/>}
        <div className="cluster-edit-members">{members.filter(i=>`${i.name} ${state.hosts[i.host_id]?.name??''}`.toLowerCase().includes(search.toLowerCase())).map(i=>{
          const selected=i.id in participants
          const newTaskInvalid=newWork[i.id]&&(!newWork[i.id].title.trim()||!newWork[i.id].input.trim())
          return <section key={i.id} className="cluster-edit-member">
            <div className="cluster-edit-identity"><label className="cluster-check"><input type="checkbox" aria-label={`${label('参与','Include')} ${i.name}`} checked={selected} onChange={e=>toggle(i.id,e.target.checked)}/><span><b>{i.name}</b><small>{state.hosts[i.host_id]?.name??i.host_id}</small></span></label><ClusterStatus label={label} value={!i.enabled?'disabled':isOnline(i.last_seen,i.enabled,state.server_time)?'online':'offline'}/></div>
            {selected&&<div className="cluster-form">
              <Field label={label('工作职责','Work duty')}><Input aria-label={`${i.name} ${label('工作职责','work duty')}`} maxLength={128} value={participants[i.id]} onChange={e=>setParticipants({...participants,[i.id]:e.target.value})}/></Field>
              <ModelPicker label={label} title={`${i.name} ${label('执行模型','execution model')}`} instances={[i]} now={state.server_time} value={memberModels[i.id]?modelKey(memberModels[i.id]):''} onChange={value=>{const next={...memberModels},model=parseModel(value);if(model)next[i.id]=model;else delete next[i.id];setMemberModels(next)}}/>
              {!(i.id in baseParticipants)&&<>
                <label className="cluster-check"><input type="checkbox" checked={!!newWork[i.id]} onChange={e=>setNewWork(current=>{const next={...current};if(e.target.checked)next[i.id]={key:crypto.randomUUID(),title:'',input:''};else delete next[i.id];return next})}/>{label('同时为此成员添加工作任务','Also add a work task for this member')}</label>
                {newWork[i.id]&&<><Field label={label('新工作标题','New task title')}><Input aria-label={`${i.name} ${label('新工作标题','new task title')}`} value={newWork[i.id].title} onChange={e=>setNewWork({...newWork,[i.id]:{...newWork[i.id],title:e.target.value}})}/></Field><Field label={label('新工作内容','New task content')}><textarea rows={3} aria-label={`${i.name} ${label('新工作内容','new task input')}`} value={newWork[i.id].input} onChange={e=>setNewWork({...newWork,[i.id]:{...newWork[i.id],input:e.target.value}})}/></Field>{newTaskInvalid&&<p role="alert" className="text-danger text-sm">{label('标题和内容都不能为空','Title and content cannot be empty')}</p>}</>}
              </>}
            </div>}
            {!selected&&<label className="cluster-check cluster-edit-note"><input type="checkbox" checked={excluded.includes(i.id)} onChange={e=>setExcluded(e.target.checked?[...excluded,i.id]:excluded.filter(id=>id!==i.id))}/>{label('排除自动分配（仅此协作）','Exclude automatic placement (this collaboration)')}</label>}
          </section>
        })}</div>
        {!members.length&&<p className="cluster-edit-note">{label('没有关联此项目的 AX；请在节点管理中连接。','No AX is approved for this project. Connect one in Nodes.')}</p>}
      </section>
      <Disclosure title={label('能力匹配要求','Capability requirements')}><div className="cluster-form">
        <Field label={label('Skill 能力要求','Skill capability requirements')}><Input value={skills} onChange={e=>setSkills(e.target.value)}/></Field>
        <Field label={label('MCP 能力要求','MCP capability requirements')}><Input value={mcp} onChange={e=>setMcp(e.target.value)}/></Field>
        <Field label={label('模型能力标签（不切换执行模型）','Model capability tags (do not switch execution model)')}><Input value={models} onChange={e=>setModels(e.target.value)}/></Field>
      </div></Disclosure>
      <p className="cluster-edit-note">{label('将移除的成员：','Members to remove: ')}{Object.keys(baseParticipants).filter(id=>memberIds.has(id)&&!(id in participants)).map(id=>historyInstance(state,id)?.name??id).join(', ')||'—'}</p>
      {unavailableMembers.length>0&&<p className="cluster-edit-note">{label('以下成员已删除或不再关联此项目，不会参与分配，其旧成员关联、模型和新建工作将在保存时清理：','Deleted members and members no longer approved for this project do not participate in placement; their old membership, models and new work are cleared on save: ')}{unavailableMembers.map(id=>historyInstance(state,id)?.name??id).join(', ')}</p>}
      {stale&&<p role="alert" className="text-danger">{label('协作已在其他操作中修改，请重新打开核对后保存。','This collaboration changed elsewhere. Reopen it before saving.')}</p>}
    </div>
    <div className="cluster-edit-footer"><Button variant="ghost" disabled={busy} onClick={close}>{label('取消','Cancel')}</Button><Button disabled={busy||(stale)||!title.trim()||Object.entries(newWork).some(([id,t])=>id in participants&&(!t.title.trim()||!t.input.trim()))} onClick={()=>void save()}>{label('保存协作','Save collaboration')}</Button></div>
  </Dialog>
}

export function TaskEditor({task:t,state,label,busy,run,close,removed,error,onTask,initialRemoving=false}:WorkbenchProps&{task:DistributedTask;close:()=>void;removed:()=>void;initialRemoving?:boolean}){
  const [base]=useState(t),[title,setTitle]=useState(t.spec.title),[input,setInput]=useState(t.spec.input),[removing,setRemoving]=useState(initialRemoving)
  const canEditInput=!t.attempts.length&&!['completed','cancelled','failed'].includes(t.status)
  const changed=t.generation!==base.generation||t.spec.title!==base.spec.title||t.spec.input!==base.spec.input||!!t.removed
  const editableInput=canEditInput?input:t.spec.input
  let goalInput:Record<string,unknown>|null=null
  if(editableInput.startsWith('/goal create ')){try{const parsed=JSON.parse(editableInput.slice(13));if(parsed&&typeof parsed==='object'&&typeof parsed.target==='string')goalInput=parsed}catch{/* Preserve legacy plain input. */}}
  const dependents=Object.values(state.tasks).filter(other=>!other.removed&&other.id!==t.id&&(other.spec.dependencies.includes(t.id)||other.spec.parent_id===t.id))
  return <div className="cluster-form">
    {error&&<p role="alert" className="text-danger">{error}</p>}
    <Field label={label('任务名称','Task name')}><Input aria-label={label('任务名称','Task name')} value={title} maxLength={512} onChange={e=>setTitle(e.target.value)}/></Field>
    <Field label={label('任务内容','Task content')}><textarea aria-label={label('任务内容','Task content')} rows={5} value={goalInput?String(goalInput.target):editableInput} readOnly={!canEditInput} onChange={e=>setInput(goalInput?'/goal create '+JSON.stringify({...goalInput,target:e.target.value}):e.target.value)}/></Field>
    {!canEditInput&&<p className="cluster-edit-note">{label('此任务已开始执行或已结束，原始内容保留。请在当前 Session 发送补充要求，或添加替代任务；名称仍可修改。','This task has execution history. Its original input is retained. Send guidance in the current Session or add a replacement task; its name remains editable.')}</p>}
    {changed&&<p role="alert" className="text-danger">{label('任务已更新，请重新打开编辑。','The task changed. Reopen the editor.')}</p>}
    <div className="cluster-toolbar"><Button disabled={busy||changed||!title.trim()||!(goalInput?String(goalInput.target):input).trim()} onClick={()=>void run(async()=>{await distributed.editTask(base,title.trim(),canEditInput?input:t.spec.input);close()})}>{label('保存任务','Save task')}</Button><Button variant="ghost" disabled={busy} onClick={close}>{label('返回详情','Back to details')}</Button><Button variant="ghost" disabled={busy||changed} onClick={()=>setRemoving(true)}>{label('移除任务','Remove task')}</Button></div>
    {removing&&<div className="cluster-approval">
      <p>{label('移除后停止执行并从工作列表隐藏，历史记录保留。','Removal stops execution and hides the task from the work list. History is retained.')}</p>
      {dependents.length>0&&<p role="alert">{label('以下任务依赖此任务，请先单独移除它们，或修改它们的依赖关系：','The following tasks depend on this task. Remove them individually first, or edit their dependencies: ')}{dependents.map(d=><Button key={d.id} variant="ghost" disabled={busy} onClick={()=>onTask(d.id)}>{d.spec.title}</Button>)}</p>}
      <div className="cluster-toolbar">
        <Button disabled={busy||changed||dependents.length>0} onClick={()=>void run(async()=>{
          await distributed.editTask(base,base.spec.title,base.spec.input,true);
          removed()
        })}>{label('确认移除任务','Confirm removal')}</Button>
        <Button variant="ghost" onClick={()=>setRemoving(false)}>{label('保留任务','Keep task')}</Button>
      </div>
    </div>}
  </div>
}
