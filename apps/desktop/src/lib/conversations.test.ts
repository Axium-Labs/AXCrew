import { describe, expect, it } from 'vitest'
import { conversations } from './conversations'
import { conversationTranscript, transcript } from './sessionTranscript'
import type { Task, CrewEvent, SessionHistory } from './types'

export const makeTask=(id:string, patch:Partial<Task>={}):Task=>({id,crew_id:'crew',parent_id:null,title:id,description:'',assigned_member:'member',assigned_device:'local',dependencies:[],priority:0,status:'completed',input:id,output:null,retry_count:0,created_at:100,started_at:100,finished_at:101,...patch})

describe('conversation identity',()=>{
  it('keeps the first title and routes old turns to active work even with equal timestamps',()=>{
    const tasks=[makeTask('z-root'),makeTask('a-next',{parent_id:'z-root',status:'running'})]
    const bindings=tasks.map(task=>({task_id:task.id,ax_session_id:'same',device_id:'local',member_id:'member'}))
    const result=conversations(bindings,tasks)
    expect(result).toHaveLength(1)
    expect(result[0].root.id).toBe('z-root')
    expect(result[0].latest.id).toBe('a-next')
  })
  it('does not combine matching AX IDs on different devices',()=>{
    const tasks=[makeTask('one'),makeTask('two',{assigned_device:'remote'})]
    expect(conversations(tasks.map(task=>({task_id:task.id,ax_session_id:'same',device_id:task.assigned_device,member_id:'member'})),tasks)).toHaveLength(2)
  })
  it('shows an accepted conversation before its binding arrives',()=>{
    expect(conversations([], [makeTask('new',{status:'ready'})],['new'])[0].latest.id).toBe('new')
  })
})

describe('history and streamed replies',()=>{
  const history:SessionHistory={task_id:'root',ax_session_id:'same',updates:[
    {sessionId:'same',update:{sessionUpdate:'user_message_chunk',messageId:'u',content:{text:'hello'}}},
    {sessionId:'same',update:{sessionUpdate:'agent_message_chunk',messageId:'a',content:{text:'Good'}}},
  ]}
  it('keeps messages with different message IDs separate',()=>{
    const data={...history,updates:[history.updates[0],{sessionId:'same',update:{sessionUpdate:'user_message_chunk',messageId:'u2',content:{text:'again'}}}]}
    expect(transcript(data).map(line=>line.text)).toEqual(['hello','again'])
  })
  it('does not replace the previous turn when the same prompt is sent again',()=>{
    const next=makeTask('next',{parent_id:'root',input:'hello',status:'running'})
    expect(conversationTranscript(history,[],next,true).map(line=>line.text)).toEqual(['hello','Good','hello'])
  })
  it('reconciles a replay with streaming chunks without duplication or lost text',()=>{
    const events=['Good',' morning'].map((text,index)=>({event_id:String(index),timestamp:100,kind:'agent.message',crew_id:'crew',member_id:'member',device_id:'local',task_id:'root',session_id:'same',payload:{sessionUpdate:'agent_message_chunk',content:{text}}} as CrewEvent))
    const lines=conversationTranscript(history,events,makeTask('root',{input:'hello',status:'running'}),true)
    expect(lines.map(line=>line.text)).toEqual(['hello','Good morning'])
    expect(conversationTranscript(history,events,makeTask('root'),false).map(line=>line.text)).toEqual(['hello','Good'])
  })
})
