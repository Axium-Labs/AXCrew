import { afterEach, expect, it, vi } from 'vitest'
const native=vi.hoisted(()=>({invoke:vi.fn()}))
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}))
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();native.invoke.mockReset()})

it('allows retry after the native connection lookup fails',async()=>{
  native.invoke.mockRejectedValueOnce(new Error('starting')).mockResolvedValueOnce({endpoint:'http://localhost',token:'test'})
  const {getConnection}=await import('./api')
  await expect(getConnection()).rejects.toThrow('starting')
  await expect(getConnection()).resolves.toEqual({endpoint:'http://localhost',token:'test'})
})

it('shows a plain-text service error without attempting to read the body twice',async()=>{
  native.invoke.mockResolvedValue({endpoint:'http://localhost',token:'test'})
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('Gateway unavailable',{status:503})))
  const {api}=await import('./api')
  await expect(api('/api/tasks')).rejects.toThrow('Gateway unavailable')
})
