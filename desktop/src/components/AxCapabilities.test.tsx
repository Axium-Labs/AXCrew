import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AxCatalog } from '../lib/ax'

const fixture = vi.hoisted(() => ({ catalog: vi.fn(), import:vi.fn(), open:vi.fn(), scan:vi.fn() }))
vi.mock('../lib/ax', () => ({ axAvailable: true, axCatalog: fixture.catalog, axImportCapability:fixture.import, axScanCapabilitySources:fixture.scan }))

vi.mock('@tauri-apps/plugin-dialog',()=>({open:fixture.open}))
import { AxCapabilities } from './AxCapabilities'

const catalog = (patch: Partial<AxCatalog> = {}): AxCatalog => ({
  cwd: 'C:/work/demo',
  skills: [{ name: 'code-review', description: '检查代码改动', missing_tools: [] }],
  mcp_servers: [{ name: 'files', description: '本地文件服务', enabled: true, capabilities: ['tools'] }],
  tools: [{ name: 'shell', description: '运行命令' }],
  warnings: [],
  ...patch,
})

const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AxCapabilities workspace="C:/work/demo" home="C:/Users/me/.ax" />
  </QueryClientProvider>,
)

beforeEach(() => { fixture.catalog.mockReset();fixture.scan.mockReset();fixture.scan.mockResolvedValue([]);fixture.import.mockReset() })
afterEach(cleanup)

describe('AX 能力面板', () => {
  it('按类别列出技能、MCP 服务器与内置工具', async () => {
    fixture.catalog.mockResolvedValue(catalog())
    mount()

    expect(await screen.findByText('code-review')).toBeTruthy()
    expect(screen.getByText('检查代码改动')).toBeTruthy()
    expect(screen.getByText('files')).toBeTruthy()
    expect(screen.getByText('tools')).toBeTruthy()
    expect(screen.getByText('shell')).toBeTruthy()
    expect(screen.getByText('运行命令')).toBeTruthy()
    expect(screen.getByText('1 个技能 · 1 个 MCP 服务器 · 1 个内置工具')).toBeTruthy()
    // 目录随工作目录变化：项目技能与 MCP 配置都按 cwd 解析。
    expect(fixture.catalog).toHaveBeenCalledWith('C:/work/demo')
  })

  it('没有 MCP 服务器时说明该在哪里配置', async () => {
    fixture.catalog.mockResolvedValue(catalog({ mcp_servers: [] }))
    mount()
    expect(await screen.findByText(/\.ax\/mcp\.toml/)).toBeTruthy()
  })

  it('技能缺少工具时标出来', async () => {
    fixture.catalog.mockResolvedValue(catalog({ skills: [{ name: 'deploy', description: '', missing_tools: ['kubectl', 'helm'] }] }))
    mount()
    expect(await screen.findByText('缺少工具：kubectl、helm')).toBeTruthy()
  })

  it('单项查询失败只影响那一项', async () => {
    fixture.catalog.mockResolvedValue(catalog({ tools: [], warnings: ['工具：method not found'] }))
    mount()
    expect((await screen.findByRole('alert')).textContent).toBe('工具：method not found')
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
  mount();await screen.findByText('code-review');fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByText('手动选择文件或目录'));fireEvent.click(screen.getByRole('button',{name:'导入 Skill 目录'}))
  await waitFor(()=>expect(fixture.import).toHaveBeenCalledWith('C:/work/demo','C:/download/code-review','skill',true))
  expect(await screen.findByRole('status')).toHaveProperty('textContent','Imported')
  expect(fixture.catalog.mock.calls.length).toBeGreaterThan(1)
})

 it('imports selected discovered items and retains failed items for retry',async()=>{
  fixture.catalog.mockResolvedValue(catalog())
  fixture.scan.mockResolvedValue([{id:'codex',name:'Codex',items:[{name:'review',path:'C:/Users/me/.codex/skills/review',kind:'skill'},{name:'MCP · User',path:'C:/Users/me/.codex/config.toml',kind:'mcp'}]}])
  fixture.import.mockResolvedValueOnce('Imported').mockRejectedValueOnce('Name conflict')
  mount()
  fireEvent.click((await screen.findByText('Skill · review')).closest('label')!)
  fireEvent.click(screen.getByText('MCP · 用户配置').closest('label')!)
  fireEvent.click(screen.getByRole('button',{name:'导入所选（2）'}))
  await waitFor(()=>expect(fixture.import).toHaveBeenCalledTimes(2))
  expect(fixture.import).toHaveBeenNthCalledWith(1,'C:/work/demo','C:/Users/me/.codex/skills/review','skill',false)
  expect(fixture.import).toHaveBeenNthCalledWith(2,'C:/work/demo','C:/Users/me/.codex/config.toml','mcp',false)
  expect((await screen.findByRole('status')).textContent).toContain('Name conflict')
  expect(screen.getByRole('button',{name:'导入所选（1）'})).toBeTruthy()
 })
