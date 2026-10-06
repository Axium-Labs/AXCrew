import { describe, expect, it } from '../../apps/desktop/node_modules/vitest'
import { toolLabel, toolOperation, toolTitle, workBlocks } from '../../apps/desktop/src/lib/toolPresentation'
import type { SessionLine } from '../../apps/desktop/src/lib/sessionTranscript'

const tool=(key:string,toolKind:string,toolInput:Record<string,unknown>):SessionLine=>({type:'tool',key,text:'',toolKind,toolInput,status:'completed'})
describe('localized work details',()=>{
  it('translates labels while keeping real paths, queries and commands',()=>{
    expect(toolTitle(tool('s','shell',{command:'cargo test --workspace'}),'zh')).toBe('已运行 cargo test --workspace')
    expect(toolTitle(tool('r','read',{path:'src/main.rs'}),'zh')).toBe('已读取 src/main.rs')
    expect(toolTitle(tool('e','patch',{path:'src/main.rs'}),'zh')).toBe('已编辑 src/main.rs')
    expect(toolTitle(tool('w','web',{operation:'fetch',urls:['https://zh.wikisource.org/wiki/%E9%B2%81','https://example.org']}),'zh')).toBe('已读取 2 个网页 · zh.wikisource.org')
    expect(toolTitle(tool('q','web',{operation:'search',queries:['鲁迅作品列表']}),'zh')).toBe('已搜索 1 个关键词 · 鲁迅作品列表')
    expect(toolLabel(tool('s','shell',{}),'en')).toBe('Run command')
    expect(toolTitle(tool('w','web',{operation:'fetch',url:'https://example.org'}),'en')).toContain('1 page · example.org')
    expect(toolOperation(tool('w','web',{operation:'fetch',urls:['https://example.org']}),'zh')).toBe('网址\nhttps://example.org')
    expect(toolOperation(tool('q','search',{query:'鲁迅',path:'src'}),'zh')).toBe('关键词：鲁迅\n范围：src')
  })
  it('preserves phase changes and keeps same-family narration inside its group',()=>{
    const narration:SessionLine={type:'agent',key:'a',text:'检查第二个来源'}
    const result=workBlocks([tool('w1','web',{}),narration,tool('w2','web',{}),{...narration,key:'b',text:'开始修改代码'},tool('p','patch',{})])
    expect(result.map(block=>block.map(line=>line.key))).toEqual([['w1','a','w2'],['b'],['p']])
  })
})
