import { describe, expect, it } from 'vitest'
import { conversationTranscript, transcript, transcriptBlocks } from './sessionTranscript'
import type { CrewEvent, SessionHistory, Task } from './types'

const history=(updates:Record<string,unknown>[]):SessionHistory=>({task_id:'t',ax_session_id:'s',updates:updates.map(update=>({sessionId:'s',update}))})
const event=(timestamp:number,payload:Record<string,unknown>):CrewEvent=>({event_id:'e',timestamp,kind:'agent.message',crew_id:null,member_id:null,device_id:null,task_id:'t',session_id:'s',payload})

describe('message time',()=>{
  it('reads the private _ax stamp AX puts on a replayed message',()=>{
    const lines=transcript(history([{sessionUpdate:'user_message_chunk',messageId:'1',content:{type:'text',text:'hi'},_ax:{createdAt:1790688191}}]))
    expect(lines).toHaveLength(1)
    // AX reports seconds; the transcript normalises to milliseconds for the view.
    expect(lines[0].at).toBe(1790688191000)
  })

  it('keeps the first chunk time while a message streams',()=>{
    const lines=transcript(history([
      {sessionUpdate:'agent_message_chunk',messageId:'2',content:{type:'text',text:'a'},_ax:{createdAt:100}},
      {sessionUpdate:'agent_message_chunk',messageId:'2',content:{type:'text',text:'b'},_ax:{createdAt:200}},
    ]))
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('ab')
    expect(lines[0].at).toBe(100000)
  })

  it('falls back to the event timestamp for live chunks',()=>{
    const lines=transcript(undefined,[event(300,{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'x'}})])
    expect(lines[0].at).toBe(300000)
  })

  it('prefers the private stamp over the event timestamp',()=>{
    const lines=transcript(undefined,[event(300,{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'x'},_ax:{createdAt:42}})])
    expect(lines[0].at).toBe(42000)
  })

  it('fills in a tool call time from its later update',()=>{
    const lines=transcript(history([
      {sessionUpdate:'tool_call',toolCallId:'c1',title:'read',status:'pending'},
      {sessionUpdate:'tool_call_update',toolCallId:'c1',status:'completed',_ax:{createdAt:5}},
    ]))
    expect(lines).toHaveLength(1)
    expect(lines[0].status).toBe('completed')
    expect(lines[0].at).toBe(5000)
  })

  it('leaves the time unset when AX reports nothing',()=>{
    expect(transcript(history([{sessionUpdate:'agent_thought_chunk',messageId:'9',content:{type:'text',text:'thinking'}}]))[0].at).toBeUndefined()
  })
})

describe('current turn',()=>{
  it('stamps the outgoing prompt with the task start time',()=>{
    const task={id:'t',created_at:7,input:'hello'} as unknown as Task
    const lines=conversationTranscript(undefined,[],task,true)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({type:'user',text:'hello',at:7000})
  })

  it('does not synthesise the current turn once it is settled',()=>{
    const task={id:'t',created_at:7,input:'hello'} as unknown as Task
    expect(conversationTranscript(undefined,[],task,false)).toEqual([])
  })

  it('keeps the streamed tool result while a turn reconciles',()=>{
    const task={id:'t',created_at:7,input:'hello'} as unknown as Task
    const history:SessionHistory={task_id:'t',ax_session_id:'s',updates:[
      {sessionId:'s',update:{sessionUpdate:'user_message_chunk',messageId:'1',content:{type:'text',text:'hello'}}},
      {sessionId:'s',update:{sessionUpdate:'tool_call',toolCallId:'c1',title:'shell',status:'pending'}},
    ]}
    const lines=conversationTranscript(history,[event(9,{sessionUpdate:'tool_call_update',toolCallId:'c1',status:'completed'})],task,true)
    expect(lines[0].type).toBe('user')
    expect(lines[1]).toMatchObject({type:'tool',text:'shell',status:'completed'})
  })
})

describe('tool rows',()=>{
  it('carries the result of a replayed call so the row can be opened',()=>{
    const lines=transcript(history([{sessionUpdate:'tool_call_update',toolCallId:'call_00_abc',status:'completed',content:[{type:'content',content:{type:'text',text:'README.md\nsrc'}}]}]))
    expect(lines[0].output).toBe('README.md\nsrc')
  })

  it('drops a provider call id that a replay reported as the title',()=>{
    const lines=transcript(history([{sessionUpdate:'tool_call',toolCallId:'call_00_abc',title:'call_00_abc',status:'pending'}]))
    expect(lines[0].text).toBe('')
  })

  it('still names a tool from the live path',()=>{
    const lines=transcript(undefined,[event(1,{sessionUpdate:'tool_call',toolCallId:'c1',title:'读取 README.md',rawInput:{name:'filesystem'},status:'pending'})])
    expect(lines[0].text).toBe('读取 README.md')
  })

  it('falls back to the tool name when a call has no title',()=>{
    const lines=transcript(undefined,[event(1,{sessionUpdate:'tool_call',toolCallId:'c1',rawInput:{name:'filesystem'},status:'pending'})])
    expect(lines[0].text).toBe('filesystem')
  })

  it('keeps the longest result when an update streams more of it',()=>{
    const lines=transcript(history([
      {sessionUpdate:'tool_call',toolCallId:'c1',title:'shell',status:'in_progress'},
      {sessionUpdate:'tool_call_update',toolCallId:'c1',status:'in_progress',content:[{type:'text',text:'half'}]},
      {sessionUpdate:'tool_call_update',toolCallId:'c1',status:'completed',content:[{type:'text',text:'half a result'}]},
    ]))
    expect(lines).toHaveLength(1)
    expect(lines[0].output).toBe('half a result')
    expect(lines[0].status).toBe('completed')
  })
})

describe('blocks',()=>{
  const line=(type:'user'|'agent'|'tool'|'thought',key:string) => ({type,text:key,key})

  it('folds each turn into one process block plus its answer',()=>{
    const blocks=transcriptBlocks([
      line('user','u1'),
      line('thought','k1'),line('tool','t1'),line('agent','a1'),
      line('user','u2'),line('tool','t2'),
    ])
    expect(blocks.map(block=>block.kind)).toEqual(['line','process','line','line','process'])
    expect(blocks[1]).toMatchObject({kind:'process',lines:[{key:'k1'},{key:'t1'}]})
    expect(blocks[2]).toMatchObject({kind:'line',line:{key:'a1'}})
  })

  it('keeps the last answer of a turn open even when steps follow it',()=>{
    const blocks=transcriptBlocks([line('agent','a1'),line('agent','a2'),line('tool','t1')])
    expect(blocks.map(block=>block.kind)).toEqual(['process','line','process'])
    expect(blocks[1]).toMatchObject({kind:'line',line:{key:'a2'}})
  })

  it('does not invent an answer for a turn that only ran tools',()=>{
    const blocks=transcriptBlocks([line('user','u1'),line('tool','t1'),line('tool','t2')])
    expect(blocks.map(block=>block.kind)).toEqual(['line','process'])
  })

  it('passes no end time when AX reported none',()=>{
    const blocks=transcriptBlocks([line('tool','t1'),line('agent','a1')])
    expect(blocks[0]).not.toHaveProperty('end')
  })
})
