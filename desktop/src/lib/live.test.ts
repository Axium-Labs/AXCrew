import { expect, it, vi } from 'vitest'
vi.mock('./api',()=>({getConnection:vi.fn()}))
vi.mock('@tauri-apps/plugin-notification',()=>({isPermissionGranted:vi.fn(),requestPermission:vi.fn(),sendNotification:vi.fn()}))
import { useLive } from './live'
import type { CrewEvent } from './types'

it('preserves a long reply when the Activity feed rolls over',()=>{
  useLive.setState({events:[],streams:{}})
  const events:CrewEvent[]=Array.from({length:700},(_,index)=>({event_id:String(index),timestamp:index,kind:'agent.message',crew_id:'crew',member_id:'member',device_id:'local',task_id:'task',session_id:'session',payload:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'x'}}}))
  useLive.getState().add(events.reverse())
  expect(useLive.getState().events).toHaveLength(500)
  expect(useLive.getState().streams.task).toHaveLength(1)
  expect(useLive.getState().streams.task[0].payload.content).toEqual({type:'text',text:'x'.repeat(700)})
})
