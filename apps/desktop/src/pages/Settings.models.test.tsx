import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const fixture = vi.hoisted(()=>({
  refresh: vi.fn(), store: vi.fn(), remove:vi.fn(), select:vi.fn(),
  state: {active_path:'ax.exe', providers:[
    {auth_kind:'api_key',id:'deepseek',name:'DeepSeek',configured:true,supported:true,source:'AX',model_source:'fallback',models:[{provider:'deepseek',id:'deepseek-chat',display_name:'DeepSeek Chat'}]},
    {auth_kind:'api_key',id:'anthropic',name:'Anthropic',configured:true,supported:false,source:'AX',unsupported_reason:'No adapter',models:[]},
    {auth_kind:'oauth',id:'workbuddy',name:'WorkBuddy International',configured:false,supported:true,source:null,models:[]},
    {auth_kind:'oauth',id:'workbuddy-cn',name:'WorkBuddy China',configured:false,supported:true,source:null,models:[]},
    {auth_kind:'ambient',id:'amazon-bedrock',name:'Bedrock',configured:false,supported:false,source:null,models:[]},
  ]},
}))
vi.mock('../lib/ax',()=>({axAvailable:true,axLocalState:async()=>fixture.state,axRefreshModels:fixture.refresh,axStoreApiKey:fixture.store,axRemoveCredential:fixture.remove,axSelectModel:fixture.select,axExport:vi.fn(),axImport:vi.fn()}))
vi.mock('../lib/api',()=>({endpoints:{settings:async()=>({}),health:async()=>({}),authorizations:async()=>({pending:[],authorized:[]})}}))
vi.mock('../lib/query',()=>({useSessions:()=>({data:[]}),useTasks:()=>({data:[]}),useDevices:()=>({data:[]})}))
vi.mock('../lib/live',()=>({useLive:()=> 'Connected'}))
vi.mock('../components/AxUpdater',()=>({AxUpdater:()=>null}))
vi.mock('../components/CapabilityImports',()=>({CapabilityImports:()=>null}))
vi.mock('../components/ui/settings-select',()=>({SettingsSelect:({label,value,onChange,options,disabled}:any)=><select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{[...new Set(options.map((option:any)=>option.group??''))].map((group:any)=>group?<optgroup label={group} key={group}>{options.filter((option:any)=>option.group===group).map((option:any)=><option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>:options.filter((option:any)=>!option.group).map((option:any)=><option key={option.value} value={option.value}>{option.label}</option>))}</select>}))
vi.mock('../components/AxCapabilities',()=>({AxCapabilities:()=>null}))
vi.mock('../components/AndroidConnection',()=>({AndroidConnection:()=>null}))
vi.mock('../lib/connections',()=>({connections:{ssh:async()=>[],discover:async()=>[]}}))
import { act } from '@testing-library/react'
import { useLang } from '../lib/i18n'
import { Settings } from './Settings'
afterEach(()=>{cleanup();vi.clearAllMocks()})
async function start(){
  const client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})
  render(<QueryClientProvider client={client}><MemoryRouter><Settings/></MemoryRouter></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button',{name:'模型与登录'}))
  await screen.findByRole('option',{name:'DeepSeek · 凭据已保存'})
}
describe('model settings',()=>{
  it('keeps providers visible when older AX omits authentication metadata',async()=>{
    const providers=fixture.state.providers
    fixture.state.providers=providers.map(provider=>({...provider,auth_kind:''}))
    try{
      await start()
      expect(screen.getByRole('option',{name:'WorkBuddy 国区'})).toBeTruthy()
      expect((screen.getByLabelText('模型提供商') as HTMLSelectElement).selectedOptions[0].textContent).toContain('DeepSeek')
    }finally{fixture.state.providers=providers}
  })
  it('shows a useful disabled placeholder when the AX catalog is empty',async()=>{
    const providers=fixture.state.providers
    fixture.state.providers=[]
    try{
      const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})
      render(<QueryClientProvider client={client}><MemoryRouter><Settings/></MemoryRouter></QueryClientProvider>)
      fireEvent.click(screen.getByRole('button',{name:'模型与登录'}))
      const select=await screen.findByLabelText('模型提供商') as HTMLSelectElement
      await waitFor(()=>expect(select.selectedOptions[0].textContent).toContain('暂无模型提供商'))
      expect(select.disabled).toBe(true)
      expect(select.querySelectorAll('optgroup').length).toBe(0)
    }finally{fixture.state.providers=providers}
  })
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

describe('authentication and settings pages',()=>{
  it('allows removal of environment providers and refreshes the provider list',async()=>{
    const providers=fixture.state.providers
    fixture.state.providers=providers.map(provider=>provider.id==='deepseek'?{...provider,source:'environment'}:provider)
    fixture.remove.mockImplementation(async()=>{fixture.state.providers=fixture.state.providers.map(provider=>provider.id==='deepseek'?{...provider,configured:false}:provider);return fixture.state})
    try{
      await start()
      const row=screen.getByText('DeepSeek',{exact:true}).closest('div')!
      const remove=within(row).getByRole('button',{name:'移除提供商'}) as HTMLButtonElement
      expect(remove.disabled).toBe(false)
      fireEvent.click(remove)
      await waitFor(()=>expect(fixture.remove).toHaveBeenCalledWith('deepseek'))
      await waitFor(()=>expect(row.isConnected).toBe(false))
      expect(await screen.findByRole('status')).toHaveProperty('textContent','提供商已移除。')
    }finally{fixture.state.providers=providers}
  })
  it('expires success notices and clears them when navigating to another settings page',async()=>{
    fixture.select.mockResolvedValue(fixture.state)
    await start()
    const choose=()=>fireEvent.change(screen.getByLabelText('AX 默认模型'),{target:{value:'deepseek::deepseek-chat'}})
    choose();await screen.findByText('已保存到本地 AX。')
    await waitFor(()=>expect(screen.queryByText('已保存到本地 AX。')).toBeNull(),{timeout:5000})
    choose();await screen.findByText('已保存到本地 AX。')
    fireEvent.click(screen.getByRole('button',{name:'系统'}))
    expect(screen.queryByText('已保存到本地 AX。')).toBeNull()
  })
  it('keeps failed removals visible without reporting success',async()=>{
    fixture.remove.mockRejectedValueOnce(Error('removal failed'))
    await start()
    fireEvent.click(within(screen.getByText('DeepSeek',{exact:true}).closest('div')!).getByRole('button',{name:'移除提供商'}))
    expect((await screen.findByRole('alert')).textContent).toContain('removal failed')
    expect(screen.queryByText('提供商已移除。')).toBeNull()
  })
  it('does not put a late save result onto the newly opened settings page',async()=>{
    let finish!: (value:unknown)=>void
    fixture.select.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    await start()
    fireEvent.change(screen.getByLabelText('AX 默认模型'),{target:{value:'deepseek::deepseek-chat'}})
    fireEvent.click(screen.getByRole('button',{name:'系统'}))
    await act(async()=>{finish(fixture.state)})
    expect(screen.queryByText('已保存到本地 AX。')).toBeNull()
  })
  it('separates regional account login from API keys and environment credentials',async()=>{
    await start()
    const select=screen.getByLabelText('模型提供商')
    fireEvent.change(select,{target:{value:'workbuddy-cn'}})
    expect(screen.queryByLabelText('API Key')).toBeNull()
    expect(screen.getByRole('button',{name:'登录账号'})).toBeTruthy()
    expect(screen.getByRole('option',{name:'WorkBuddy 国区'})).toBeTruthy()
    expect(screen.getByRole('option',{name:'WorkBuddy 国际版'})).toBeTruthy()
    fireEvent.change(select,{target:{value:'amazon-bedrock'}})
    expect(screen.queryByLabelText('API Key')).toBeNull()
    expect(screen.queryByRole('button',{name:'登录账号'})).toBeNull()
    fireEvent.change(select,{target:{value:'deepseek'}})
    expect(screen.getByLabelText('API Key')).toBeTruthy()
  })
  it('reveals each speech credential independently',async()=>{
    await start();fireEvent.click(screen.getByRole('button',{name:'语音识别'}))
    const key=screen.getByLabelText('APIKey') as HTMLInputElement,secret=screen.getByLabelText('APISecret') as HTMLInputElement
    fireEvent.change(key,{target:{value:'key-to-see'}});fireEvent.change(secret,{target:{value:'secret-to-see'}})
    expect(key.type).toBe('password');expect(secret.type).toBe('password')
    fireEvent.click(screen.getAllByRole('button',{name:'显示密钥'})[0])
    expect(key.type).toBe('text');expect(secret.type).toBe('password');expect(key.value).toBe('key-to-see')
    fireEvent.click(screen.getByRole('button',{name:'隐藏密钥'}));expect(key.type).toBe('password')
  })
  it('keeps system controls on their own page and translates without remounting',async()=>{
    await start();expect(screen.queryByRole('button',{name:'连接'})).toBeNull();expect(screen.queryByText('桌面行为')).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'系统'}))
    expect(screen.getByText('桌面行为')).toBeTruthy();expect(screen.queryByText('公共网关 URL')).toBeNull()
    act(()=>useLang.setState({lang:'en'}))
    expect(screen.getByText('Desktop behavior')).toBeTruthy();expect(screen.queryByText('桌面行为')).toBeNull()
    expect(screen.queryByRole('button',{name:'Connections'})).toBeNull()
    act(()=>useLang.setState({lang:'zh'}));expect(screen.getByText('桌面行为')).toBeTruthy()
  })
})
