import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SessionInteractions, MessageActions, MessageImage } from './SessionInteractions'
import { TranscriptLines } from './SessionTranscript'

afterEach(()=>{cleanup();vi.useRealTimers()})
describe('session message actions',()=>{
  it('copies both roles and passes the selected model message to branching',async()=>{
    const writeText=vi.fn().mockResolvedValue(undefined),branch=vi.fn()
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}})
    const user={type:'user' as const,text:'用户消息',key:'u'},answer={type:'agent' as const,text:'**模型回答**',key:'a'}
    render(<SessionInteractions value={{onBranch:branch}}><MessageActions line={user}/><MessageActions line={answer}/></SessionInteractions>)
    fireEvent.click(screen.getAllByRole('button',{name:'复制消息'})[0])
    fireEvent.click(screen.getAllByRole('button',{name:'复制消息'})[1])
    expect(writeText.mock.calls.map(call=>call[0])).toEqual(['用户消息','**模型回答**'])
    fireEvent.click(screen.getByRole('button',{name:'创建聊天分支'}))
    expect(branch).toHaveBeenCalledWith(answer)
  })
  it('opens an image viewer from a sent thumbnail',()=>{
    render(<MessageImage image={{name:'sample.png',src:'data:image/png;base64,iVBORw0KGgo='}}/>)
    fireEvent.click(screen.getByRole('button',{name:'查看图片 sample.png'}))
    expect(screen.getByRole('dialog',{name:'sample.png'})).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'关闭图片'}))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('opens the right panel for a specific changed file',()=>{
    const changes=vi.fn(),files=[{path:'src/a.py',additions:2,deletions:1}]
    render(<SessionInteractions value={{onChanges:changes}}><TranscriptLines lines={[{type:'agent',text:'完成',key:'a'},{type:'agent',text:'',key:'changes',changedFiles:files,status:'completed'}]}/></SessionInteractions>)
    fireEvent.click(screen.getByRole('button',{name:/src\/a.py/}))
    expect(changes).toHaveBeenCalledWith(files,'src/a.py')
    fireEvent.click(screen.getByRole('button',{name:'查看变更'}))
    expect(changes).toHaveBeenLastCalledWith(files)
  })
  it('shows thinking and a ticking duration before the first model output',()=>{
    vi.useFakeTimers();vi.setSystemTime(100000)
    const {rerender}=render(<TranscriptLines active lines={[{type:'user',text:'提问',key:'u',at:100000}]}/>)
    expect(screen.getByText('思考中')).toBeTruthy()
    expect(screen.getByText('用时 0 秒')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'思考中 用时 0 秒'}))
    act(()=>vi.advanceTimersByTime(3000))
    expect(screen.getByText('用时 3 秒')).toBeTruthy()
    expect(screen.getByRole('button',{name:'思考中 用时 3 秒'}).getAttribute('aria-expanded')).toBe('false')
    rerender(<TranscriptLines finishedAt={104000} lines={[{type:'user',text:'提问',key:'u',at:100000},{type:'agent',text:'完成',key:'a'}]}/>)
    act(()=>vi.advanceTimersByTime(2000))
    expect(screen.getByText('用时 4 秒')).toBeTruthy()
    expect(screen.queryByText('思考中')).toBeNull()
  })
})
