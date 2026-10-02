import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
const fixture=vi.hoisted(()=>({invoke:vi.fn(),handler:undefined as undefined|((event:{payload:unknown})=>void),unlisten:vi.fn()}))
vi.mock('@tauri-apps/api/core',()=>({invoke:fixture.invoke}))
vi.mock('@tauri-apps/api/event',()=>({listen:async(_name:string,handler:typeof fixture.handler)=>{fixture.handler=handler;return fixture.unlisten}}))
import { ProviderLogin } from './ProviderLogin'
afterEach(()=>{cleanup();vi.clearAllMocks()})
describe('native AX account sign-in',()=>{
  it('shows a URL without opening the browser, opens on click and cancels on unmount',async()=>{
    fixture.invoke.mockResolvedValue('login-id')
    const success=vi.fn(),view=render(<ProviderLogin provider="workbuddy-cn" name="WorkBuddy China" onClose={vi.fn()} onSuccess={success}/>)
    await waitFor(()=>expect(fixture.invoke).toHaveBeenCalledWith('ax_begin_login',{provider:'workbuddy-cn'}))
    act(()=>fixture.handler?.({payload:{id:'other',url:'https://evil.test',done:false}}))
    expect(screen.queryByRole('link')).toBeNull()
    act(()=>fixture.handler?.({payload:{id:'login-id',url:'https://copilot.tencent.com/login?state=random',done:false}}))
    const link=await screen.findByRole('link')
    expect(fixture.invoke.mock.calls.some(call=>call[0]==='ax_open_login_url')).toBe(false)
    fireEvent.click(link)
    expect(fixture.invoke).toHaveBeenCalledWith('ax_open_login_url',{url:'https://copilot.tencent.com/login?state=random'})
    act(()=>fixture.handler?.({payload:{id:'login-id',url:null,done:true,success:true}}))
    expect(success).toHaveBeenCalledOnce()
    view.unmount()
    expect(fixture.invoke).toHaveBeenCalledWith('ax_cancel_login',{id:'login-id'})
    expect(fixture.unlisten).toHaveBeenCalledOnce()
  })
})
