import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelControls } from '../../apps/desktop/src/components/ModelControls'
import { effortDragPosition, modelEfforts, selectedEffort } from '../../apps/desktop/src/lib/modelControls'
import type { AxModel } from '../../apps/desktop/src/lib/ax'
import { useSessionUi } from '../../apps/desktop/src/store/sessions'

const model: AxModel = {provider:'vendor', id:'reasoner', display_name:'Reasoner', reasoning_efforts:['minimal','high','ultra'], default_reasoning_effort:'high'}
afterEach(cleanup)
describe('provider model controls', () => {
  it('attracts smoothly near actual effort stops without trapping free dragging', () => {
    expect(effortDragPosition(.32,3)).toBe(.32)
    expect(effortDragPosition(.47,3)).toBeGreaterThan(.47)
    expect(effortDragPosition(.47,3)).toBeLessThan(.5)
    expect(effortDragPosition(.53,3)).toBeCloseTo(1-effortDragPosition(.47,3))
    for(const steps of [2,3,7]){
      for(let index=0;index<steps;index++) expect(effortDragPosition(index/(steps-1),steps)).toBeCloseTo(index/(steps-1))
      let previous=0
      for(let i=0;i<=1000;i++){
        const current=effortDragPosition(i/1000,steps)
        expect(current).toBeGreaterThanOrEqual(previous)
        expect(current-previous).toBeLessThan(.01)
        previous=current
      }
    }
    expect(effortDragPosition(-1,3)).toBe(0);expect(effortDragPosition(2,3)).toBe(1)
    expect(effortDragPosition(.5,1)).toBe(0)
  })
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
    await user.click(screen.getByRole('button',{name:'选择模型：Reasoner',exact:true}))
    expect(screen.getByRole('menuitem',{name:'Reasoner'}).classList.contains('is-selected')).toBe(true)
    await user.click(screen.getByRole('menuitem',{name:'Plain'}))
    expect(onModel).toHaveBeenCalledWith('vendor','plain')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('slider')).toBeTruthy()
  })
  it('has no reset control and leaves catalogue effort available', async () => {
    const user=userEvent.setup(), onEffort=vi.fn()
    render(<ModelControls models={[model]} model={{...model,reasoning_effort:'minimal'}} effort="ultra" onEffort={onEffort} fast={false} fastDisabled={false} onFast={()=>{}} onModel={async()=>{}} emptyHint="配置模型" onConfigure={()=>{}}/>)
    await user.click(screen.getByRole('button',{name:'选择 AX 模型'}))
    expect(screen.queryByRole('button',{name:'恢复默认思考强度'})).toBeNull()
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('极高')
    expect(onEffort).not.toHaveBeenCalled()
  })
  it('keeps model browsing accessible when effort is absent or the remote model is locked', async () => {
    const user=userEvent.setup(), onModel=vi.fn()
    render(<ModelControls models={[{...model,reasoning_efforts:[]}]} model={{...model,reasoning_efforts:[]}} effort="high" onEffort={()=>{}} modelDisabled fast={false} fastDisabled onFast={()=>{}} onModel={onModel} emptyHint="配置模型" onConfigure={()=>{}}/>)
    await user.click(screen.getByRole('button',{name:'选择 AX 模型'}))
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByRole('button',{name:'恢复默认思考强度'})).toBeNull()
    expect(screen.getByRole('button',{name:'更快',exact:true}).hasAttribute('disabled')).toBe(true)
    await user.click(screen.getByRole('button',{name:'选择模型：Reasoner'}))
    expect(screen.getByRole('menuitem',{name:'Reasoner'}).hasAttribute('data-disabled')).toBe(true)
    expect(screen.getByText('此会话沿用创建时的模型')).toBeTruthy()
    expect(onModel).not.toHaveBeenCalled()
  })
  it('persists unsent text separately from layout state', () => {
    useSessionUi.getState().setDraft('draft-regression','中文未发送内容')
    const persisted=JSON.parse(localStorage.getItem('ax-crew-session-layout')!).state
    expect(persisted.drafts['draft-regression']).toBe('中文未发送内容')
    expect(persisted.draftUpdatedAt['draft-regression']).toBeGreaterThan(0)
  })
})
