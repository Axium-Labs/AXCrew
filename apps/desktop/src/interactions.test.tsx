import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { create } from 'zustand'
import type { Task, Session, CrewEvent, Permission } from './lib/types'

const fixture=vi.hoisted(()=>({tasks:[] as Task[],sessions:[] as Session[],permissions:[] as Permission[],api:vi.fn(),history:vi.fn()}))
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}))
vi.mock('@tauri-apps/api/window',()=>({getCurrentWindow:vi.fn()}))
vi.mock('@xterm/xterm',()=>({Terminal:class{}}))
vi.mock('@xterm/addon-fit',()=>({FitAddon:class{}}))
vi.mock('./lib/live',()=>({startLive:()=>()=>{},useLive:create(()=>({status:'Connected',events:[] as CrewEvent[],streams:{}}))}))
vi.mock('./lib/api',()=>({api:fixture.api,endpoints:{
  health:async()=>({status:'ok',version:'1'}),
  settings:async()=>({default_cwd:'C:/workspace',protocol_version:1}),
  crews:async()=>[{id:'crew',name:'测试团队',created_at:1},{id:'crew2',name:'另一团队',created_at:1}],
  members:async(id:string)=>id==='crew'?[{id:'member',crew_id:'crew',name:'测试成员',device_id:'local',cwd:'C:/workspace',permission_profile:'ask',skills:[],mcp_servers:[],max_concurrency:1}]:[],
  devices:async()=>[{id:'local',name:'本机',status:'online',last_seen:1}],
  permissions:async()=>structuredClone(fixture.permissions),tasks:async()=>structuredClone(fixture.tasks),sessions:async()=>structuredClone(fixture.sessions),
  history:fixture.history,events:async()=>[],
  localAx:async()=>({available:true,home:'C:/Users/me/.ax',projects:[{id:'p',root:'C:/workspace',sessions:[{id:'local-1',title:'本地会话',created_at:1,updated_at:2,messages:2,preview:'hi',task_id:null}]}]}),
  localSession:async()=>({task_id:'',ax_session_id:'local-1',updates:[]}),
  automations:async()=>[],automationRuns:async()=>[],
}}))

vi.mock('./lib/connections',()=>({connections:{projects:async()=>[],discover:async()=>[]}}))
import App from './App'
import { queryClient } from './lib/runtime'
import { useUi } from './store/ui'
import { useSessionUi } from './store/sessions'
import { useLang } from './lib/i18n'

const task=(id:string,patch:Partial<Task>={}):Task=>({id,crew_id:'crew',parent_id:null,title:`会话 ${id}`,description:'',assigned_member:'member',assigned_device:'local',dependencies:[],priority:0,status:'completed',input:`prompt ${id}`,output:null,retry_count:0,created_at:1,started_at:1,finished_at:2,...patch})
const start=async(path='/sessions')=>{window.history.replaceState({idx:0},'',`/#${path}`);render(<App/>);await screen.findByRole('textbox',{name:'发送消息'})}

beforeEach(()=>{
  Object.defineProperty(window,'innerWidth',{configurable:true,value:1440})
  fixture.tasks=[];fixture.sessions=[];fixture.permissions=[];fixture.api.mockReset();fixture.history.mockReset().mockResolvedValue({updates:[]})
  queryClient.clear();queryClient.setDefaultOptions({queries:{retry:false}})
  useUi.setState({sidebar:true,palette:false,theme:'dark'})
  useSessionUi.setState({listOpen:true,rightOpen:false,rightTab:'files',drafts:{},startingIds:[],metadata:{},selectedEnvironment:null})
  // The suite asserts the Chinese copy, so pin the language instead of inheriting
  // whatever `navigator.language` the test environment reports.
  useLang.setState({lang:'zh'})
  Object.defineProperty(window,'matchMedia',{writable:true,value:vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}))})
  window.requestAnimationFrame=callback=>{callback(0);return 0}
  Element.prototype.scrollIntoView=vi.fn()
})
afterEach(()=>{cleanup();queryClient.clear()})

describe('shell interactions',()=>{
  it('keeps independent collapsed panels across navigation and restores each explicitly',async()=>{
    const user=userEvent.setup();await start()
    await user.click(screen.getByRole('button',{name:'收起主导航'}))
    expect(document.querySelector('.sidebar.is-compact')).not.toBeNull()
    await user.click(screen.getAllByRole('button',{name:'收起会话列表'})[0])
    await user.click(screen.getByRole('button',{name:'打开右侧面板'}))
    expect(screen.queryByRole('complementary',{name:'会话列表'})).toBeNull()
    expect(document.querySelector('.sidebar.is-compact')).not.toBeNull()
    await user.click(screen.getByRole('link',{name:'设置'}))
    await user.click(screen.getByRole('link',{name:'会话'}))
    expect(screen.queryByRole('complementary',{name:'会话列表'})).toBeNull()
    expect(screen.getByRole('complementary',{name:'会话侧栏'})).not.toBeNull()
    await user.click(screen.getByRole('button',{name:'展开会话列表'}))
    expect(screen.getByRole('complementary',{name:'会话列表'})).not.toBeNull()
    await user.click(screen.getByRole('button',{name:'展开主导航'}))
    expect(document.querySelector('.sidebar.is-compact')).toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary',{name:'会话侧栏'})).toBeNull()
  })
  it('closes command search without reopening on focus and executes keyboard selection',async()=>{
    const user=userEvent.setup();await start()
    await user.click(screen.getByRole('button',{name:'运行命令'}))
    expect(screen.getByRole('dialog')).not.toBeNull()
    await user.keyboard('{Escape}')
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(screen.getByRole('button',{name:'运行命令'}))
    await user.type(screen.getByRole('textbox',{name:'搜索命令'}),'设置{Enter}')
    await screen.findByRole('heading',{name:'概览'})
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((screen.getByRole('button',{name:'返回'}) as HTMLButtonElement).disabled).toBe(false)
    await user.click(screen.getByRole('button',{name:'返回'}))
    await screen.findByRole('textbox',{name:'发送消息'})
    expect((screen.getByRole('button',{name:'前进'}) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('conversation interactions',()=>{
  const seed=()=>{fixture.tasks=[task('one'),task('two')];fixture.sessions=fixture.tasks.map(item=>({task_id:item.id,ax_session_id:item.id,device_id:'local',member_id:'member'}))}
  it('preserves separate drafts when switching conversations',async()=>{
    seed();const user=userEvent.setup();await start('/sessions/one')
    await user.type(screen.getByRole('textbox',{name:'发送消息'}),'first draft')
    await user.click(screen.getByRole('button',{name:/会话 two/}))
    expect((screen.getByRole('textbox',{name:'发送消息'}) as HTMLTextAreaElement).value).toBe('')
    await user.type(screen.getByRole('textbox',{name:'发送消息'}),'second draft')
    await user.click(screen.getByRole('button',{name:/会话 one/}))
    expect((screen.getByRole('textbox',{name:'发送消息'}) as HTMLTextAreaElement).value).toBe('first draft')
  })
  it('submits once, displays the accepted turn immediately, keeps a stable conversation title, and stops the latest turn',async()=>{
    seed();fixture.history.mockResolvedValue({ax_session_id:'one',updates:[{sessionId:'one',update:{sessionUpdate:'user_message_chunk',messageId:'u1',content:{text:'prompt one'}}},{sessionId:'one',update:{sessionUpdate:'agent_message_chunk',messageId:'a1',content:{text:'上一轮完整回复'}}}]})
    const user=userEvent.setup();await start('/sessions/one')
    await screen.findByText('上一轮完整回复')
    fixture.history.mockImplementation(()=>new Promise(()=>{}))
    const created=task('next',{parent_id:'one',status:'running',title:'followup',input:'followup',finished_at:null})
    let resolve!:(value:Task)=>void
    fixture.api.mockImplementation(()=>new Promise<Task>(done=>{resolve=done}))
    await user.type(screen.getByRole('textbox',{name:'发送消息'}),'followup')
    fireEvent.submit(document.querySelector('.session-composer')!);fireEvent.submit(document.querySelector('.session-composer')!)
    expect(fixture.api).toHaveBeenCalledTimes(1)
    fixture.tasks.push(created);fixture.sessions.push({...fixture.sessions[0],task_id:'next'})
    resolve(created)
    await screen.findByRole('button',{name:'停止'})
    expect(window.location.hash).toBe('#/sessions/one')
    expect(screen.getByText('上一轮完整回复')).not.toBeNull()
    expect(document.querySelector('.session-chat-header strong')?.textContent).toBe('会话 one')
    expect(screen.getByText('followup')).not.toBeNull()
    fixture.api.mockResolvedValue({})
    await user.click(screen.getByRole('button',{name:'停止'}))
    expect(fixture.api).toHaveBeenLastCalledWith('/api/tasks/next/cancel','POST',{})
  })
  it('does not pull the user back after sending and leaving the page',async()=>{
    const user=userEvent.setup();await start()
    await screen.findByRole('button',{name:'发送消息'})
    let resolve!:(value:Task)=>void;fixture.api.mockImplementation(()=>new Promise<Task>(done=>{resolve=done}))
    await user.type(screen.getByRole('textbox',{name:'发送消息'}),'hello{Enter}')
    await user.click(screen.getByRole('link',{name:'设置'}))
    resolve(task('new',{status:'ready'}))
    await waitFor(()=>expect(useSessionUi.getState().startingIds).toContain('new'))
    expect(window.location.hash).toBe('#/settings')
  })
})


describe('actions and failure recovery',()=>{
  it('keeps the draft after an API error, retries it, and does not submit IME confirmation',async()=>{
    const user=userEvent.setup();await start();await screen.findByRole('button',{name:'发送消息'})
    fixture.api.mockRejectedValueOnce(new Error('offline'))
    const input=screen.getByRole('textbox',{name:'发送消息'})
    await user.type(input,'保留这段内容')
    fireEvent.keyDown(input,{key:'Enter',isComposing:true})
    expect(fixture.api).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    await screen.findByRole('alert')
    expect(fixture.api).toHaveBeenCalledWith('/api/sessions','POST',{title:'保留这段内容',text:'保留这段内容',cwd:'C:/workspace',provider:undefined,model:undefined,images:[],permission_profile:'ask'})
    expect((input as HTMLTextAreaElement).value).toBe('保留这段内容')
    const created=task('accepted',{status:'ready',input:'保留这段内容',finished_at:null})
    fixture.tasks=[created];fixture.api.mockResolvedValueOnce(created)
    await user.click(screen.getByRole('button',{name:'发送消息'}))
    await waitFor(()=>expect(window.location.hash).toBe('#/sessions/accepted'))
    expect(fixture.api).toHaveBeenCalledTimes(2)
  })
  it('resolves the current conversation permission using the server option ID',async()=>{
    fixture.tasks=[task('approval',{status:'waiting_permission',finished_at:null})]
    fixture.sessions=[{task_id:'approval',ax_session_id:'ax-approval',device_id:'local',member_id:'member'}]
    fixture.permissions=[{request_id:'request',request:{sessionId:'ax-approval',toolCall:{title:'读取文件',kind:'read',rawInput:{}},options:[{optionId:'custom-allow',name:'允许此次读取'}]}}]
    fixture.api.mockResolvedValue({})
    const user=userEvent.setup();await start('/sessions/approval')
    await user.click(await screen.findByRole('button',{name:'允许此次读取'}))
    expect(fixture.api).toHaveBeenCalledWith('/api/permissions/request/resolve','POST',{option_id:'custom-allow'})
  })
  it('filters all teams and preserves the selected status when changing teams',async()=>{
    fixture.tasks=[task('one',{status:'running'}),task('two',{crew_id:'crew2',status:'running'})]
    const user=userEvent.setup();await start();await user.click(screen.getByRole('button',{name:'运行命令'}));await user.click(screen.getByRole('option',{name:'任务'}))
    await screen.findByText('任务列表 · 2')
    const [crew,status]=screen.getAllByRole('combobox')
    await user.selectOptions(status,'running')
    await user.selectOptions(crew,'crew2')
    expect((status as HTMLSelectElement).value).toBe('running')
    await screen.findByText('任务列表 · 1')
    await user.selectOptions(crew,'')
    await screen.findByText('任务列表 · 2')
  })
})

describe('conversation context menu',()=>{
  const seed=()=>{fixture.tasks=[task('one')];fixture.sessions=[{task_id:'one',ax_session_id:'one',device_id:'local',member_id:'member'}]}
  it('renames, marks and permanently deletes only after confirmation',async()=>{
    seed();const user=userEvent.setup();await start('/sessions/one')
    fireEvent.contextMenu(await screen.findByRole('button',{name:/会话 one/}),{clientX:100,clientY:100})
    await user.click(screen.getByRole('menuitem',{name:'重命名'}))
    await user.clear(screen.getByLabelText('会话名称'));await user.type(screen.getByLabelText('会话名称'),'Renamed')
    await user.click(screen.getByRole('button',{name:'保存'}))
    expect(useSessionUi.getState().metadata['local:one'].title).toBe('Renamed')
    fireEvent.contextMenu(document.querySelector('.session-recent-row')!)
    await user.click(screen.getByRole('menuitem',{name:'标记'}))
    expect(useSessionUi.getState().metadata['local:one'].marked).toBe(true)
    fireEvent.contextMenu(document.querySelector('.session-recent-row')!)
    await user.click(screen.getByRole('menuitem',{name:'项目'}))
    await user.selectOptions(screen.getByRole('combobox',{name:'项目'}),'C:/workspace')
    await user.click(screen.getByRole('button',{name:'保存'}))
    expect(useSessionUi.getState().metadata['local:one'].project).toBe('C:/workspace')

    fireEvent.contextMenu(document.querySelector('.session-recent-row')!)
    await user.click(screen.getByRole('menuitem',{name:'永久删除'}))
    expect(fixture.api.mock.calls.some(call=>call[1]==='DELETE')).toBe(false)
    expect(screen.getByRole('dialog',{name:'永久删除'})).not.toBeNull()
    fixture.api.mockImplementation(async()=>{fixture.tasks=[];fixture.sessions=[];return {deleted:true}})
    await user.click(screen.getByRole('button',{name:'永久删除'}))
    await waitFor(()=>expect(fixture.api).toHaveBeenCalledWith('/api/sessions/one','DELETE'))
    expect(screen.queryByRole('button',{name:'查看已删除'})).toBeNull()

  })
})
