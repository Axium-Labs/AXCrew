import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const fixture = vi.hoisted(()=>({
  refresh: vi.fn(), store: vi.fn(),
  state: {active_path:'ax.exe', providers:[
    {id:'deepseek',name:'DeepSeek',configured:true,supported:true,source:'AX',model_source:'fallback',models:[{provider:'deepseek',id:'deepseek-chat',display_name:'DeepSeek Chat'}]},
    {id:'anthropic',name:'Anthropic',configured:true,supported:false,source:'AX',unsupported_reason:'No adapter',models:[]},
  ]},
}))
vi.mock('../lib/ax',()=>({axAvailable:true,axLocalState:async()=>fixture.state,axRefreshModels:fixture.refresh,axStoreApiKey:fixture.store,axRemoveCredential:vi.fn(),axSelectModel:vi.fn(),axExport:vi.fn(),axImport:vi.fn()}))
vi.mock('../lib/api',()=>({endpoints:{settings:async()=>({}),health:async()=>({})}}))
vi.mock('../lib/query',()=>({useSessions:()=>({data:[]}),useTasks:()=>({data:[]})}))
vi.mock('../lib/live',()=>({useLive:()=> 'Connected'}))
vi.mock('../components/AxUpdater',()=>({AxUpdater:()=>null}))
vi.mock('../components/AxCapabilities',()=>({AxCapabilities:()=>null}))
vi.mock('../components/AndroidConnection',()=>({AndroidConnection:()=>null}))
import { Settings } from './Settings'
afterEach(()=>{cleanup();vi.clearAllMocks()})
async function start(){
  const client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})
  render(<QueryClientProvider client={client}><MemoryRouter><Settings/></MemoryRouter></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button',{name:'模型与登录'}))
  await screen.findByRole('option',{name:'DeepSeek · 凭据已保存'})
}
describe('model settings',()=>{
  it('distinguishes saved credentials and offline models from a verified connection',async()=>{
    await start()
    expect(screen.queryByText(/已通过.*连接/)).toBeNull()
    expect(screen.getByText(/1 个内置模型 · 推理未验证/)).toBeTruthy()
    const select=screen.getByLabelText('AX 默认模型') as HTMLSelectElement
    expect([...select.options].some(option=>option.value.startsWith('anthropic::'))).toBe(false)
  })
  it('refreshes a configured provider even when models already exist',async()=>{
    fixture.refresh.mockResolvedValue({...fixture.state,discovery:{provider:'deepseek',models:0,warning:'401 invalid key'}})
    await start()
    fireEvent.click(screen.getAllByRole('button',{name:'在线刷新'})[0])
    await waitFor(()=>expect(fixture.refresh).toHaveBeenCalledWith('deepseek'))
    expect(await screen.findByText(/在线刷新未完成：401 invalid key/)).toBeTruthy()
  })
  it('disables unsupported provider login',async()=>{
    await start()
    fireEvent.change(screen.getByLabelText('模型提供商'),{target:{value:'anthropic'}})
    fireEvent.change(screen.getByLabelText('API Key'),{target:{value:'fake-key'}})
    expect((screen.getByRole('button',{name:'保存并发现模型'}) as HTMLButtonElement).disabled).toBe(true)
  })
})
