import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ProjectDialog, SshDialog } from '../../apps/desktop/src/components/ConnectionDialogs'
import { Connections } from '../../apps/desktop/src/pages/Connections'

const fixture=vi.hoisted(()=>({add:vi.fn(),connect:vi.fn(),createProject:vi.fn(),workspace:vi.fn(),devices:[] as {id:string;name:string;status:string}[]}))
vi.mock('../../apps/desktop/src/lib/connections',()=>({connections:{ssh:async()=>[],discover:async()=>[{name:'build',host:'build',port:null,identity_file:null}],add:fixture.add,connect:fixture.connect,createProject:fixture.createProject,workspace:fixture.workspace}}))
vi.mock('../../apps/desktop/src/lib/query',()=>({useDevices:()=>({data:fixture.devices})}))
vi.mock('../../apps/desktop/src/lib/api',()=>({api:vi.fn(),endpoints:{authorizations:async()=>({pending:[],authorized:[]})}}))
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}))
vi.mock('../../apps/desktop/src/components/AndroidConnection',()=>({AndroidConnection:()=>null}))

function start(element:React.ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});render(<QueryClientProvider client={client}><MemoryRouter>{element}</MemoryRouter></QueryClientProvider>)}
beforeEach(()=>{vi.clearAllMocks();fixture.devices=[{id:'local',name:'本机',status:'online'},{id:'remote',name:'Build host',status:'online'},{id:'offline',name:'Offline host',status:'offline'}];fixture.workspace.mockResolvedValue({cwd:'/srv',parent:'/',directories:[{name:'project',path:'/srv/project'}]});fixture.createProject.mockResolvedValue({id:'p',name:'Demo',device_id:'remote',cwd:'/srv',member_id:'m'});fixture.add.mockResolvedValue({id:'ssh:test'})})
afterEach(cleanup)

it('opens the clean connection page and adds a discovered SSH alias without copying secrets',async()=>{
  const user=userEvent.setup();start(<Connections/>);await screen.findByRole('heading',{name:'连接'})
  expect(screen.getByRole('tab',{name:'控制此电脑'})).toBeTruthy();await user.click(screen.getByRole('tab',{name:'SSH'}));await user.click(screen.getByRole('button',{name:'添加 SSH 连接'}))
  await user.click(await screen.findByRole('checkbox'));await user.click(screen.getByRole('button',{name:'添加',exact:true}));await waitFor(()=>expect(fixture.add).toHaveBeenCalledWith({name:'build',host:'build',port:null,identity_file:null}))
})

it('keeps manual SSH input visible on save failure and validates the optional port',async()=>{
  const user=userEvent.setup();fixture.add.mockRejectedValue(new Error('invalid host'));start(<SshDialog open onClose={()=>{}}/>);await user.click(screen.getByRole('button',{name:'手动添加'}))
  fireEvent.change(screen.getByLabelText('主机名'),{target:{value:'user@build'}});fireEvent.change(screen.getByLabelText('SSH 端口 （可选）'),{target:{value:'2222'}})
  await user.click(screen.getByRole('button',{name:'身份文件'}));fireEvent.change(screen.getByLabelText('身份文件路径'),{target:{value:'C:/keys/my key'}});await user.click(screen.getByRole('button',{name:'保存'}))
  await screen.findByRole('alert');expect((screen.getByLabelText('主机名') as HTMLInputElement).value).toBe('user@build');expect(fixture.add).toHaveBeenCalledWith({name:'user@build',host:'user@build',port:2222,identity_file:'C:/keys/my key'})
})

it('selects directories on the remote host and creates the correct bound project',async()=>{
  const user=userEvent.setup(),created=vi.fn();start(<ProjectDialog open onClose={()=>{}} onCreated={created}/>);fireEvent.change(screen.getByLabelText('项目名称'),{target:{value:'Demo'}})
  await user.click(screen.getByRole('button',{name:'在此电脑上添加文件夹'}));await user.click(screen.getByRole('menuitem',{name:'Build host'}));await user.click(screen.getByRole('button',{name:'添加',exact:true}))
  await screen.findByText('/srv');expect(fixture.workspace).toHaveBeenCalledWith('remote',undefined);await user.click(screen.getByRole('button',{name:'选择此文件夹'}));await user.click(screen.getByRole('button',{name:'创建项目',exact:true}))
  await waitFor(()=>expect(created).toHaveBeenCalled());expect(fixture.createProject).toHaveBeenCalledWith({name:'Demo',device_id:'remote',cwd:'/srv'})
})

it('keeps the project name and source folder when creation fails',async()=>{
  const user=userEvent.setup();fixture.createProject.mockRejectedValue(new Error('host offline'));start(<ProjectDialog open onClose={()=>{}} onCreated={()=>{}}/>);fireEvent.change(screen.getByLabelText('项目名称'),{target:{value:'Draft'}})
  await user.click(screen.getByRole('button',{name:'添加',exact:true}));await screen.findByText('/srv');await user.click(screen.getByRole('button',{name:'选择此文件夹'}));await user.click(screen.getByRole('button',{name:'创建项目',exact:true}));await screen.findByRole('alert')
  expect((screen.getByLabelText('项目名称') as HTMLInputElement).value).toBe('Draft');expect(screen.getByText('/srv')).toBeTruthy()
})
