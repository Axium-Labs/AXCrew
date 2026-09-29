import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({invoke:vi.fn(),open:vi.fn()}))
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}))
vi.mock('@tauri-apps/plugin-dialog',()=>({open:mocks.open}))
import { resolveSendWorkspace } from './workspace'
beforeEach(()=>{mocks.invoke.mockReset();mocks.open.mockReset()})
describe('send workspace recovery',()=>{
  it('uses a valid persisted directory without opening a picker',async()=>{
    mocks.invoke.mockResolvedValue('C:/project')
    expect(await resolveSendWorkspace('C:/project')).toBe('C:/project')
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('replaces a deleted directory only with the user selected directory',async()=>{
    mocks.invoke.mockRejectedValueOnce('missing').mockResolvedValueOnce('C:/new')
    mocks.open.mockResolvedValue('C:/new')
    expect(await resolveSendWorkspace('C:/deleted')).toBe('C:/new')
    expect(mocks.open.mock.calls[0][0]).not.toHaveProperty('defaultPath')
    expect(mocks.invoke).toHaveBeenLastCalledWith('validate_workspace',{path:'C:/new'})
  })
  it('cancels without supplying a fallback that might run in the wrong folder',async()=>{
    mocks.invoke.mockRejectedValue('missing');mocks.open.mockResolvedValue(null)
    expect(await resolveSendWorkspace('C:/deleted')).toBeNull()
  })
  it('rejects a selected folder removed before validation completes',async()=>{
    mocks.open.mockResolvedValue('C:/gone');mocks.invoke.mockRejectedValue('missing')
    await expect(resolveSendWorkspace()).rejects.toBe('missing')
  })
})
