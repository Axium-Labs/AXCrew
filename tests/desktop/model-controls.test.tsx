import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelControls } from '../../apps/desktop/src/components/ModelControls'
import { modelEfforts, selectedEffort } from '../../apps/desktop/src/lib/modelControls'
import type { AxModel } from '../../apps/desktop/src/lib/ax'
import { useSessionUi } from '../../apps/desktop/src/store/sessions'

const model: AxModel = {provider:'vendor', id:'reasoner', display_name:'Reasoner', reasoning_efforts:['minimal','high','ultra'], default_reasoning_effort:'high'}
afterEach(cleanup)
describe('provider model controls', () => {
  it('uses only catalogue choices and handles stale selections or absent capabilities', () => {
    expect(modelEfforts(model)).toEqual(['minimal','high','ultra'])
    expect(selectedEffort(model,'medium')).toBe('high')
    expect(selectedEffort(model,'ultra')).toBe('ultra')
    expect(selectedEffort({...model,reasoning_efforts:[]},'high')).toBe('')
    expect(selectedEffort({...model,reasoning_effort:'minimal'},'')).toBe('minimal')
  })
  it('opens a single panel, selects actual effort, toggles Fast and selects another model', async () => {
    const user=userEvent.setup(), onEffort=vi.fn(),onFast=vi.fn(),onModel=vi.fn().mockResolvedValue(undefined)
    render(<ModelControls models={[model,{provider:'vendor',id:'plain',display_name:'Plain'}]} model={model} effort="high" onEffort={onEffort} fast={false} fastDisabled={false} onFast={onFast} onModel={onModel} emptyHint="配置模型" onConfigure={()=>{}}/>)
    await user.click(screen.getByRole('button',{name:'选择 AX 模型'}))
    expect(screen.getByLabelText('思考强度').getAttribute('max')).toBe('2')
    expect(screen.queryByText('默认')).toBeNull();expect(screen.queryByText('重置默认')).toBeNull()
    fireEvent.change(screen.getByRole('slider'),{target:{value:'2'}})
    expect(onEffort).toHaveBeenCalledWith('ultra')
    await user.click(screen.getByRole('button',{name:'更快',exact:true}));expect(onFast).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button',{name:'Reasoner',exact:true}))
    await user.click(screen.getByRole('button',{name:'Plain vendor'}))
    expect(onModel).toHaveBeenCalledWith('vendor','plain')
  })
  it('persists unsent text separately from layout state', () => {
    useSessionUi.getState().setDraft('draft-regression','中文未发送内容')
    const persisted=JSON.parse(localStorage.getItem('ax-crew-session-layout')!).state
    expect(persisted.drafts['draft-regression']).toBe('中文未发送内容')
    expect(persisted.draftUpdatedAt['draft-regression']).toBeGreaterThan(0)
  })
})
