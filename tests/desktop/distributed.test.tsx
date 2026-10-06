import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Distributed } from '../../apps/desktop/src/pages/Distributed'
import { useLang } from '../../apps/desktop/src/lib/i18n'

const fixture=vi.hoisted(()=>({state:vi.fn(),enroll:vi.fn(),submit:vi.fn(),control:vi.fn(),enable:vi.fn(),resources:vi.fn(),configure:vi.fn()}))
vi.mock('../../apps/desktop/src/lib/distributed',()=>({distributed:fixture}))
vi.mock('../../apps/desktop/src/lib/api',()=>({getConnection:async()=>({endpoint:'https://crew.example.com',token:'admin'})}))

const cluster={revision:1,server_time:100,hosts:{host:{id:'host',name:'Build host',resources:{cpu:8,ram_mb:8192,gpu:1},last_seen:100,enabled:true,inventory_at:100,inventory:{hostname:'build-machine',os:'windows',arch:'x86_64',cpu_name:'Test CPU',cpu:8,ram_mb:8192,gpu:1 as number|null,gpu_names:['Test GPU'],errors:[]}}},instances:{code:{id:'code',host_id:'host',name:'AX-code',projects:['project-ax'],max_executions:2,can_delegate:true,enabled:true,last_seen:100,incarnation:'epoch',capabilities:{roles:['code'],skills:['rust'],mcp:[],tools:['shell'],models:['model'],permissions:['ask'],environments:['linux']}}},tasks:{task:{id:'task',creator:'admin',spec:{title:'Test job',input:'run tests',project_id:'project-ax',parent_id:null,dependencies:[],artifacts:[],requirements:{capabilities:{roles:['code']},resources:{cpu:1,ram_mb:1024,gpu:0}}},status:'failed',owner:'code',generation:2,failure:'test assertion failed',result:null,artifacts:[],attempts:[{generation:2,instance_id:'code',started_at:80,ended_at:90,error:'test assertion failed'}]}},artifacts:{},events:[{sequence:1,timestamp:90,kind:'task.observation',task_id:'task',instance_id:'code',detail:'diagnosis: race condition'}],workflows:{flow:{id:'flow',title:'Durable workflow',project_id:'project-ax',root_task_id:'task',status:'blocked',revision:3,state:{stage:'awaiting_fix'},updated_at:90}}}
function start(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});render(<QueryClientProvider client={client}><Distributed/></QueryClientProvider>)}
beforeEach(()=>{useLang.setState({lang:'zh'});vi.clearAllMocks();fixture.state.mockResolvedValue(structuredClone(cluster));fixture.control.mockResolvedValue({});fixture.enable.mockResolvedValue({});fixture.submit.mockResolvedValue({id:'new-task'});fixture.enroll.mockResolvedValue({instance:{id:'new-instance'},token:'instance-private-token'})})
afterEach(cleanup)

describe('distributed management',()=>{
  it('separates Host, AX capacity, tasks, observations and durable workflow state',async()=>{
    start();await screen.findByText('Build host');expect(screen.getByText('任务预留: CPU 0/8 · RAM 0/8192 MiB · GPU 0/1')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab',{name:'工作流'}));expect(screen.getByText('Durable workflow')).toBeTruthy();expect(screen.getByText(/awaiting_fix/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'查看根任务 / 取消 / 恢复'}));await screen.findByRole('dialog')
    expect(screen.getByText('diagnosis: race condition')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'重试'}))
    await waitFor(()=>expect(fixture.control).toHaveBeenCalledWith('task','retry'))
  })
  it('enrolls another AX on the same Host using shared capacity and generates an instance credential config',async()=>{
    start();await screen.findByText('Build host');fireEvent.click(screen.getByRole('button',{name:'添加 AX 实例'}))
    for(const label of ['CPU 核数','GPU 数量','RAM（MiB）','Skill 名称','MCP 名称','Tool 名称','模型 ID'])expect(screen.queryByLabelText(label)).toBeNull()
    fireEvent.change(screen.getByLabelText('Host ID'),{target:{value:'host'}})
    fireEvent.change(screen.getByLabelText('此机器上的项目路径'),{target:{value:'/srv/AX'}})
    fireEvent.change(screen.getByLabelText('AX 名称'),{target:{value:'AX-test'}})
    fireEvent.click(screen.getByRole('button',{name:'注册并生成配置'}))
    await screen.findByText('ax crew worker worker.json')
    expect(fixture.enroll.mock.calls[0][0]).toMatchObject({host_id:'host',name:'AX-test',max_executions:2,projects:['project-ax']})
    expect(fixture.enroll.mock.calls[0][0]).not.toHaveProperty('resources');expect(fixture.enroll.mock.calls[0][0]).not.toHaveProperty('capabilities')
    expect(screen.getByText(/instance-private-token/)).toBeTruthy();expect(screen.getByText(/"project-ax": "\/srv\/AX"/)).toBeTruthy()
  })
  it('shows detected hardware and configures capabilities only after connection',async()=>{
    fixture.configure.mockResolvedValue({})
    start();await screen.findByText('Build host');expect(screen.getByText('8 · Test CPU')).toBeTruthy();expect(screen.getByText('1 · Test GPU')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab',{name:'AX 实例'}));fireEvent.click(screen.getByRole('button',{name:'配置能力'}))
    fireEvent.change(screen.getByLabelText('Skill 名称'),{target:{value:'rust, testing'}})
    fireEvent.click(screen.getByRole('button',{name:'保存并生成本地配置'}))
    await screen.findByRole('button',{name:'下载配置字段'})
    expect(fixture.configure).toHaveBeenCalledWith('code',expect.objectContaining({skills:['rust','testing']}))
    expect(screen.getByText(/配置已保存为待生效/)).toBeTruthy()
  })
  it('distinguishes unknown GPU from zero',async()=>{
    const state=structuredClone(cluster);state.hosts.host.inventory.gpu=null
    fixture.state.mockResolvedValue(state);start();await screen.findByText('Build host');expect(screen.getByText('未知 · Test GPU')).toBeTruthy()
  })
  it('shows pending detection and disables capability setup before first connection',async()=>{
    const state=structuredClone(cluster);state.hosts.host.inventory=undefined as unknown as typeof state.hosts.host.inventory;state.hosts.host.last_seen=0;state.hosts.host.resources={cpu:0,ram_mb:0,gpu:0};state.instances.code.last_seen=0
    fixture.state.mockResolvedValue(state);start();await screen.findByText('Build host');expect(screen.getByText(/等待 AX 自动检测机器配置/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab',{name:'AX 实例'}));expect((screen.getByRole('button',{name:'配置能力'}) as HTMLButtonElement).disabled).toBe(true)
  })
  it('submits logical project placement constraints and keeps failed actions visible',async()=>{
    fixture.submit.mockRejectedValue(new Error('project policy denied'))
    start();await screen.findByText('Build host');fireEvent.click(screen.getByRole('button',{name:'创建协作任务'}))
    fireEvent.change(screen.getByLabelText('任务标题'),{target:{value:'Compile'}});fireEvent.change(screen.getByLabelText('任务输入'),{target:{value:'cargo build'}})
    fireEvent.change(screen.getByLabelText('需要的角色'),{target:{value:'code'}});fireEvent.click(screen.getByRole('button',{name:'交由 AXCrew 调度'}))
    await screen.findByRole('alert');expect(screen.getByRole('alert').textContent).toContain('project policy denied')
    expect(fixture.submit.mock.calls[0][0]).toMatchObject({project_id:'project-ax',input:'cargo build',requirements:{capabilities:{roles:['code']},resources:{cpu:1}}})
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
