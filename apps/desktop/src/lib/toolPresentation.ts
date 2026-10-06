import type { SessionLine } from './sessionTranscript'

export type ToolKind='shell'|'ssh'|'edit'|'read'|'list'|'search'|'find'|'fetch'|'web-search'|'tool'

// Translate operation labels, never the actual command, path or tool result.
export function toolKind(line:SessionLine):ToolKind{
  const name=(line.toolKind??'').toLowerCase(),input=line.toolInput??{},text=line.text
  if(name==='ssh')return 'ssh'
  if(['shell','execute','exec_command','write_stdin'].includes(name))return 'shell'
  if(['patch','edit','write','apply_patch'].includes(name))return 'edit'
  if(name==='web')return input.operation==='search'||/^search \d+ quer/.test(text)?'web-search':'fetch'
  if(name==='search')return 'search'
  if(['find_files','glob'].includes(name))return 'find'
  if(name==='list')return 'list'
  if(['read','tool_output','view_image'].includes(name))return 'read'
  if(name==='filesystem')return input.operation==='write'?'edit':input.operation==='list'?'list':'read'
  if(/^running /.test(text))return 'shell'
  if(/^editing |^write /.test(text))return 'edit'
  if(/^fetch \d+ urls?:/.test(text))return 'fetch'
  if(/^search \d+ quer/.test(text))return 'web-search'
  if(/^searching /.test(text))return 'search'
  if(/^finding /.test(text))return 'find'
  if(/^list /.test(text))return 'list'
  if(/^read /.test(text))return 'read'
  return 'tool'
}
export function toolFamily(line:SessionLine){
  const kind=toolKind(line)
  return ['fetch','web-search'].includes(kind)?'web':['read','list','search','find'].includes(kind)?'files':['shell','ssh'].includes(kind)?'commands':kind
}
const labels:Record<ToolKind,[string,string]>={shell:['运行命令','Run command'],ssh:['SSH 命令','SSH command'],edit:['编辑文件','Edit file'],read:['读取文件','Read file'],list:['列出目录','List directory'],search:['搜索文件','Search files'],find:['查找文件','Find files'],fetch:['读取网页','Read web pages'],'web-search':['搜索网页','Search the web'],tool:['调用工具','Use tool']}
export const toolLabel=(line:SessionLine,lang:'zh'|'en')=>labels[toolKind(line)][lang==='zh'?0:1]

function shortUrl(value:string){try{return new URL(value).hostname}catch{return value}}
export function toolTitle(line:SessionLine,lang:'zh'|'en'){
  const input=line.toolInput??{},kind=toolKind(line),zh=lang==='zh'
  const running=!['completed','success','failed','error'].includes(line.status??'')
  const failed=['failed','error'].includes(line.status??'')
  const verbs:Record<ToolKind,[string,string,string]>={
    shell:['运行命令','正在运行','已运行'],ssh:['SSH 命令','正在通过 SSH 运行','已通过 SSH 运行'],
    edit:['编辑文件','正在编辑','已编辑'],read:['读取文件','正在读取','已读取'],list:['列出目录','正在列出','已列出'],
    search:['搜索文件','正在搜索','已搜索'],find:['查找文件','正在查找','已查找'],fetch:['读取网页','正在读取','已读取'],
    'web-search':['搜索网页','正在搜索','已搜索'],tool:['调用工具','正在调用','已调用'],
  }
  let target=''
  if(kind==='shell'||kind==='ssh')target=String(input.command??line.operation??line.text.replace(/^running /,'')).split('\n')[0]
  else if(['read','list','edit'].includes(kind))target=String(input.path??line.operation?.split('\n')[0]?.replace(/^(read|write|list|editing) /,'')??line.text.replace(/^(read|write|list|editing) /,''))
  else if(kind==='search')target=String(input.query??line.text.replace(/^searching /,''))
  else if(kind==='find')target=String(input.pattern??line.text.replace(/^finding /,''))
  else if(kind==='fetch'||kind==='web-search'){
    const key=kind==='fetch'?'urls':'queries',singular=kind==='fetch'?'url':'query'
    const list=Array.isArray(input[key])?input[key] as unknown[]:input[singular]?[input[singular]]:[]
    const legacy=/^(?:fetch|search) (\d+) (?:urls?|quer(?:y|ies)): (.*)$/.exec(line.text)
    const count=list.length||Number(legacy?.[1]??1),first=String(list[0]??legacy?.[2]??'')
    target=kind==='fetch'?`${count}${zh?' 个网页':' page'+(count===1?'':'s')}${first?' · '+shortUrl(first):''}`:`${count}${zh?' 个关键词':' quer'+(count===1?'y':'ies')}${first?' · '+first:''}`
  }else target=line.toolKind??line.text
  // Legacy title-only rows can have generic names; avoid repeating them.
  if(['shell','filesystem','read','write','patch','web','ssh'].includes(target))target=''
  const verb=zh?(failed?'执行失败':verbs[kind][running?1:2]):failed?'Failed':running?toolLabel(line,lang):toolLabel(line,lang).replace(/^Run /,'Ran ').replace(/^Read /,'Read ').replace(/^Edit /,'Edited ').replace(/^Search /,'Searched ').replace(/^Find /,'Found ').replace(/^List /,'Listed ')
  return `${verb}${target?' '+target:''}`
}

export function toolOperation(line:SessionLine,lang:'zh'|'en'='en'){
  const input=line.toolInput??{},kind=toolKind(line),zh=lang==='zh'
  if(kind==='shell'||kind==='ssh')return String(input.command??line.operation??line.text.replace(/^running /,''))
  if(kind==='fetch'||kind==='web-search'){
    const plural=kind==='fetch'?'urls':'queries',single=kind==='fetch'?'url':'query'
    const list=Array.isArray(input[plural])?input[plural] as unknown[]:input[single]?[input[single]]:[]
    if(list.length)return `${kind==='fetch'?(zh?'网址':'URLs'):(zh?'关键词':'Queries')}\n${list.join('\n')}`
    return line.text.replace(/^(?:fetch|search) \d+ (?:urls?|quer(?:y|ies)): /,'')
  }
  if(kind==='search'||kind==='find'){
    const term=input[kind==='search'?'query':'pattern']
    if(term!==undefined)return `${kind==='search'?(zh?'关键词':'Query'):(zh?'文件匹配':'Pattern')}：${term}${input.path||input.root?`\n${zh?'范围':'Scope'}：${input.path??input.root}`:''}`
  }
  if(line.operation)return line.operation.replace(/^(read|write|list) /,'')
  if(line.toolInput)return JSON.stringify(line.toolInput,null,2)
  return line.text.replace(/^(running|editing|searching|finding) /,'')
}

/** Adjacent calls stay together. Prose between repeated same-family calls is
 * kept inside that group; a change of operation retains its progress paragraph. */
export function workBlocks(lines:SessionLine[]):SessionLine[][]{
  const blocks:SessionLine[][]=[]
  for(let index=0;index<lines.length;index++){
    const line=lines[index],previous=blocks.at(-1)
    if(line.type==='tool'&&previous?.[0].type==='tool'){previous.push(line);continue}
    if(line.type!=='tool'&&previous?.[0].type==='tool'){
      let next=index
      while(next<lines.length&&lines[next].type!=='tool')next++
      const lastTool=previous.findLast(item=>item.type==='tool')!
      if(next<lines.length&&toolFamily(lastTool)===toolFamily(lines[next])){
        previous.push(...lines.slice(index,next+1));index=next;continue
      }
    }
    blocks.push([line])
  }
  return blocks
}
