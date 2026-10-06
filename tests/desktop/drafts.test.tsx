import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SessionsWorkspace } from '../../apps/desktop/src/pages/SessionsWorkspace'
import { useSessionUi } from '../../apps/desktop/src/store/sessions'
import type { Session } from '../../apps/desktop/src/lib/types'

const fixture=vi.hoisted(()=>({bindings:[] as Session[]}))
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}))
vi.mock('../../apps/desktop/src/lib/api',()=>({api:async()=>[],endpoints:{
  settings:async()=>({default_cwd:'C:/workspace'}),crews:async()=>[],members:async()=>[],devices:async()=>[],permissions:async()=>[],localAx:async()=>({projects:[]}),
  tasks:async()=>[{id:'root',title:'会话',status:'completed',created_at:1,parent_id:null},{id:'child',title:'继续',status:'completed',created_at:2,parent_id:'root'}],
  sessions:async()=>fixture.bindings,history:async()=>({updates:[]})
}}))
afterEach(cleanup)
it('retains a newer draft while route turn IDs resolve into the canonical conversation',async()=>{
  fixture.bindings=[]
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),user=userEvent.setup()
  useSessionUi.setState({drafts:{},draftUpdatedAt:{},startingIds:[]})
  useSessionUi.getState().setDraft('root','较早的草稿')
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/sessions/child']}><Routes><Route path="/sessions/:id" element={<SessionsWorkspace/>}/></Routes></MemoryRouter></QueryClientProvider>)
  const input=screen.getByRole('textbox',{name:'发送消息'})
  await user.type(input,'数据加载前写下的草稿')
  fixture.bindings=['root','child'].map(task_id=>({task_id,ax_session_id:'same',device_id:'local',member_id:'member'}))
  await client.invalidateQueries({queryKey:['sessions']})
  await waitFor(()=>expect(document.querySelector('.session-title-menu strong')?.textContent).toBe('会话'))
  expect((input as HTMLTextAreaElement).value).toBe('数据加载前写下的草稿')
  await user.type(input,'，继续编辑')
  expect(useSessionUi.getState().drafts.root).toBe('数据加载前写下的草稿，继续编辑')
  expect(useSessionUi.getState().drafts.child).toBe('数据加载前写下的草稿，继续编辑')
  client.clear()
})
