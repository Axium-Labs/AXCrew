import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AxCatalog } from '../lib/ax'

const fixture = vi.hoisted(() => ({ catalog: vi.fn(), import:vi.fn(), open:vi.fn(), scan:vi.fn(), manage:vi.fn() }))
vi.mock('../lib/ax', () => ({ axAvailable: true, axCatalog: fixture.catalog, axImportCapability:fixture.import, axScanCapabilitySources:fixture.scan, axManageCapability:fixture.manage }))

vi.mock('@tauri-apps/plugin-dialog',()=>({open:fixture.open}))
import { AxCapabilities } from './AxCapabilities'
import { CapabilityImports } from './CapabilityImports'

const catalog = (patch: Partial<AxCatalog> = {}): AxCatalog => ({
  cwd: 'C:/work/demo',
  skills: [{ name: 'code-review', description: '检查代码改动', missing_tools: [] }],
  mcp_servers: [{ name: 'files', description: '本地文件服务', enabled: true, capabilities: ['tools'] }],
  tools: [{ name: 'shell', description: '运行命令' }],
  warnings: [],
  ...patch,
})

const mount = (imports=false) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {imports?<CapabilityImports workspace="C:/work/demo"/>:<AxCapabilities workspace="C:/work/demo" home="C:/Users/me/.ax"/>}
  </QueryClientProvider>,
)

beforeEach(() => { fixture.catalog.mockReset();fixture.scan.mockReset();fixture.scan.mockResolvedValue([]);fixture.import.mockReset() })
afterEach(cleanup)

describe('AX 能力面板', () => {
  it('按类别列出技能与 MCP 服务器，不展示内置工具', async () => {
    fixture.catalog.mockResolvedValue(catalog())
    mount()

    expect(await screen.findByText('code-review')).toBeTruthy()
    expect(screen.getByText('检查代码改动')).toBeTruthy()
    await userEvent.click(screen.getByRole('tab',{name:/MCP/}));expect(screen.getByText('files')).toBeTruthy()
    expect(screen.getByText('tools')).toBeTruthy()
    expect(screen.queryByRole('tab',{name:/内置工具/})).toBeNull()
    expect(screen.queryByText('shell')).toBeNull()
    expect(screen.getByRole('tab',{name:/技能 1/})).toBeTruthy()
    // 目录随工作目录变化：项目技能与 MCP 配置都按 cwd 解析。
    expect(fixture.catalog).toHaveBeenCalledWith('C:/work/demo', 'project')
  })

  it('没有 MCP 服务器时说明该在哪里配置', async () => {
    fixture.catalog.mockResolvedValue(catalog({ mcp_servers: [] }))
    mount()
    await screen.findByText('code-review');await userEvent.click(screen.getByRole('tab',{name:/MCP/}));expect(screen.getByText(/\.ax\/mcp\.toml/)).toBeTruthy()
  })

  it('技能缺少工具时标出来', async () => {
    fixture.catalog.mockResolvedValue(catalog({ skills: [{ name: 'deploy', description: '', missing_tools: ['kubectl', 'helm'] }] }))
    mount()
    expect(await screen.findByText('缺少工具：kubectl、helm')).toBeTruthy()
  })

  it('单项查询失败只影响那一项，内置工具目录失败不打扰用户', async () => {
    fixture.catalog.mockResolvedValue(catalog({ mcp_servers: [], tools: [], warnings: ['工具：method not found', 'MCP 服务器：method not found'] }))
    mount()
    expect((await screen.findByRole('alert')).textContent).toBe('MCP 服务器：method not found')
    expect(screen.getByText('code-review')).toBeTruthy()
  })

  it('整体读取失败时报错', async () => {
    fixture.catalog.mockRejectedValue('AX 没有响应能力查询，请确认本机 ax 支持 Crew（ax acp）')
    mount()
    expect((await screen.findByRole('alert')).textContent).toContain('AX 没有响应能力查询')
  })
})

it('imports a Skill into the selected scope and refreshes the AX catalog',async()=>{
  fixture.catalog.mockResolvedValue(catalog());fixture.open.mockResolvedValue('C:/download/code-review');fixture.import.mockResolvedValue('Imported')
  mount(true);fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByText('手动选择文件或目录'));fireEvent.click(screen.getByRole('button',{name:'导入 Skill 目录'}))
  await waitFor(()=>expect(fixture.import).toHaveBeenCalledWith('C:/work/demo','C:/download/code-review','skill',true))
  expect(await screen.findByRole('status')).toHaveProperty('textContent','Imported')
  expect(fixture.import).toHaveBeenCalledTimes(1)
})

 it('imports selected discovered items and retains failed items for retry',async()=>{
  fixture.catalog.mockResolvedValue(catalog())
  fixture.scan.mockResolvedValue([{id:'codex',name:'Codex',items:[{name:'review',path:'C:/Users/me/.codex/skills/review',kind:'skill'},{name:'MCP · User',path:'C:/Users/me/.codex/config.toml',kind:'mcp'}]}])
  fixture.import.mockResolvedValueOnce('Imported').mockRejectedValueOnce('Name conflict')
  mount(true)
  fireEvent.click(await screen.findByRole('button',{name:/Codex/}))
  fireEvent.click((await screen.findByText('Skill · review')).closest('label')!)
  fireEvent.click(screen.getByText('MCP · 用户配置').closest('label')!)
  fireEvent.click(screen.getByRole('button',{name:'导入所选（2）'}))
  await waitFor(()=>expect(fixture.import).toHaveBeenCalledTimes(2))
  expect(fixture.import).toHaveBeenNthCalledWith(1,'C:/work/demo','C:/Users/me/.codex/skills/review','skill',false)
  expect(fixture.import).toHaveBeenNthCalledWith(2,'C:/work/demo','C:/Users/me/.codex/config.toml','mcp',false)
  expect((await screen.findByRole('status')).textContent).toContain('Name conflict')
  expect(screen.getByRole('button',{name:'导入所选（1）'})).toBeTruthy()
 })

it('starts every app collapsed and retains selected items across independent expansion',async()=>{
  fixture.catalog.mockResolvedValue(catalog())
  fixture.scan.mockResolvedValue([
    {id:'codex',name:'Codex',items:[{name:'review',path:'C:/codex/review',kind:'skill'}]},
    {id:'agents',name:'Agent Skills',items:Array.from({length:26},(_,i)=>({name:`skill-${i}`,path:`C:/agents/skill-${i}`,kind:'skill'}))},
  ])
  mount(true)
  const codex=await screen.findByRole('button',{name:/Codex/}),agents=screen.getByRole('button',{name:/Agent Skills/})
  expect(codex.getAttribute('aria-expanded')).toBe('false')
  expect(agents.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText('Skill · review')).toBeNull()
  expect(screen.queryByText('Skill · skill-25')).toBeNull()
  fireEvent.click(codex)
  fireEvent.click(screen.getByText('Skill · review').closest('label')!)
  fireEvent.click(agents)
  expect(screen.getByText('Skill · skill-25')).toBeTruthy()
  expect(codex.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(codex)
  expect(screen.queryByText('Skill · review')).toBeNull()
  expect(screen.getByRole('button',{name:'导入所选（1）'})).toBeTruthy()
  fireEvent.click(codex)
  expect((within(screen.getByText('Skill · review').closest('label')!).getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button',{name:'重新扫描'}))
  await waitFor(()=>expect(fixture.scan).toHaveBeenCalledTimes(2))
  expect(codex.getAttribute('aria-expanded')).toBe('false')
  expect(agents.getAttribute('aria-expanded')).toBe('false')
})


it('switches configuration scope and sends inherited disables only to the project', async () => {
 fixture.catalog.mockResolvedValue(catalog({ skills: [{name:'reviewer',description:'Review',missing_tools:[],scope:'global',enabled:true,status:'enabled'}], agents:[{name:'rust-dev',description:'Rust',scope:'project',enabled:true,status:'enabled'}] }))
 fixture.manage.mockResolvedValue('Saved')
 mount()
 const reviewer = (await screen.findByText('reviewer')).closest('article')!
 expect(within(reviewer).getByText('个人')).toBeTruthy()
 fireEvent.click(within(reviewer).getByRole('switch',{name:'启用 reviewer'}))
 await waitFor(()=>expect(fixture.manage).toHaveBeenCalledWith('C:/work/demo','skills','project','disable','reviewer',undefined))
 await waitFor(()=>expect(within(reviewer).getByRole('switch',{name:'启用 reviewer'}).hasAttribute('disabled')).toBe(false))
 fireEvent.click(screen.getByRole('combobox',{name:'配置作用域'}));fireEvent.click(await screen.findByRole('option',{name:'全局配置'}))
 await waitFor(()=>expect(fixture.catalog).toHaveBeenLastCalledWith('C:/work/demo','global'))
 fireEvent.click(within((await screen.findByText('reviewer')).closest('article')!).getByRole('switch',{name:'启用 reviewer'}))
 await waitFor(()=>expect(fixture.manage).toHaveBeenLastCalledWith('C:/work/demo','skills','global','disable','reviewer',undefined))
})

it('shows disabled here and enables an inherited MCP through the same manager', async () => {
 fixture.catalog.mockResolvedValue(catalog({mcp_servers:[{name:'browser',description:'Browser',capabilities:[],scope:'global',enabled:false,status:'disabled here'}]}))
 fixture.manage.mockResolvedValue('Saved')
 mount()
 await screen.findByText('code-review');await userEvent.click(screen.getByRole('tab',{name:/MCP/}));const row = (await screen.findByText('browser')).closest('article')!
 expect(within(row).getByText('已在此项目禁用')).toBeTruthy()
 fireEvent.click(within(row).getByRole('switch',{name:'启用 browser'}))
 await waitFor(()=>expect(fixture.manage).toHaveBeenCalledWith('C:/work/demo','mcp','project','enable','browser',undefined))
})
