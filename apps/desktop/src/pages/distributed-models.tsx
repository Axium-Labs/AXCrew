import { useState } from 'react'
import { Field } from '../components/shared'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { modelKey, modelOptions, type AxInstance } from '../lib/distributed'
import type { Label } from './distributed-forms'

export function ModelPicker({instances,now,value,onChange,label,title}:{instances:AxInstance[];now:number;value:string;onChange:(value:string)=>void;label:Label;title?:string}){
  const [search,setSearch]=useState('')
  const models=modelOptions(instances,now),available=models.some(m=>modelKey(m)===value)
  return <Field label={title??label('执行模型','Execution model')}>
    <Input aria-label={label('搜索可选模型','Search available models')} placeholder={label('搜索 Provider / Model','Search Provider / Model')} value={search} onChange={e=>setSearch(e.target.value)}/>
    <Select label={title??label('执行模型','Execution model')} value={value} onChange={onChange} options={[{value:'',label:label('继承 AX 当前模型','Inherit AX current model')},...models.filter(m=>modelKey(m)===value||`${m.provider} ${m.model} ${m.name}`.toLowerCase().includes(search.toLowerCase())).map(m=>({value:modelKey(m),label:`${m.provider} · ${m.name||m.model}`,group:m.provider})),...(value&&!available?[{value,label:label('所选模型已不可用 / 目录过期','Selected model unavailable / catalog stale'),disabled:true}]:[])]}/>
    {instances.map(i=><small key={i.id} className="mt-1 block text-xs leading-relaxed text-muted">{i.name} · {!i.enabled||i.last_seen<=now-30?label('节点离线或禁用','Node offline or disabled'):i.model_catalog?.error?label('模型目录不可用：','Model catalog unavailable: ')+i.model_catalog.error:!i.model_catalog?label('等待 AX 回报模型目录','Awaiting AX model catalog'):(i.model_catalog_at??0)<=now-180?label('模型目录已过期','Model catalog stale'):i.model_catalog.current?`${label('当前模型：','Current model: ')}${i.model_catalog.current.provider} / ${i.model_catalog.current.model}`:label('AX 尚无默认模型，请选择可用模型或在节点配置','AX has no default model; select a model or configure it on the node')}</small>)}
    <small className="mt-1 block text-xs leading-relaxed text-muted">{label('模型来自目标 AX；实际调用失败会显示错误。离线或过期节点不可选择。','Models come from target AX; call failures are shown. Offline or stale nodes are excluded.')}</small>
  </Field>
}
