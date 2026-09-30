import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { formatDuration, TranscriptLine, TranscriptLines } from './SessionTranscript'
import { useLang } from '../lib/i18n'
import type { SessionLine } from '../lib/sessionTranscript'
beforeEach(()=>useLang.setState({lang:'zh'}))
afterEach(cleanup)
describe('Codex style transcript',()=>{
  const tool:SessionLine={type:'tool',text:'running rg -n needle src',toolKind:'shell',output:'src/main.rs:4: needle',rawOutput:'{"large":"raw json"}',status:'in_progress',key:'c1',at:100000}
  it('shows thoughts and narration as ordinary prose and one collapsed tool row',()=>{
    const {container}=render(<TranscriptLines lines={[{type:'thought',text:'先检查实现',key:'k1'},{type:'agent',text:'我会读取命中的代码',key:'a1'},tool]}/> )
    expect(screen.getByText('先检查实现')).toBeTruthy()
    expect(screen.getByText('我会读取命中的代码')).toBeTruthy()
    expect(container.querySelectorAll('.session-tool-row')).toHaveLength(1)
    expect(container.querySelector('.session-tool-card')).toBeNull()
    expect(container.querySelector('.session-activity')).toBeNull()
  })
  it('updates the same call without resetting expansion, including failure',()=>{
    const {container,rerender}=render(<TranscriptLines lines={[tool]}/> )
    const row=screen.getByRole('button')
    fireEvent.click(row)
    expect(screen.getByText('Shell')).toBeTruthy()
    expect(screen.getByText('src/main.rs:4: needle')).toBeTruthy()
    expect(screen.queryByText('{"large":"raw json"}')).toBeNull()
    rerender(<TranscriptLines lines={[{...tool,status:'failed',end:171000,output:'error: bad path'}]}/> )
    expect(container.querySelectorAll('.session-tool-row')).toHaveLength(1)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('✕ 失败')).toBeTruthy()
    expect(screen.queryByText('✓ 成功')).toBeNull()
    expect(screen.getByText('1 分 11 秒')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'展开原始输出'}))
    expect(screen.getByText('{"large":"raw json"}')).toBeTruthy()
    fireEvent.click(row)
    expect(container.querySelector('.session-tool-card')).toBeNull()
  })
  it('shows success only for success and keeps individual tools visible',()=>{
    const {container}=render(<TranscriptLines lines={[{...tool,status:'completed'}, {...tool,key:'c2',text:'read main.rs',toolKind:'filesystem',status:'completed'}]}/> )
    expect(container.querySelectorAll('.session-tool-row')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(screen.getByText('✓ 成功')).toBeTruthy()
  })
  it('shows changed files at the end with a reveal for remaining files',()=>{
    const files=Array.from({length:5},(_,i)=>({path:`src/${i}.rs`,additions:i+1,deletions:1}))
    render(<TranscriptLines lines={[{...tool,status:'completed',changedFiles:files},{type:'agent',text:'已修改',key:'a1'}]}/> )
    expect(screen.getByText('已编辑 5 个文件')).toBeTruthy()
    expect(screen.queryByText('src/4.rs')).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'再显示 2 个文件'}))
    expect(screen.getByText('src/4.rs')).toBeTruthy()
  })
  it('keeps user bubbles and answer prose',()=>{
    const {container}=render(<TranscriptLine line={{type:'user',text:'hello',key:'u1'}}/> )
    expect(container.querySelector('.session-transcript-bubble')?.textContent).toBe('hello')
  })
  it('formats seconds, minutes and hours',()=>{
    expect(formatDuration(59000)).toBe('59 秒')
    expect(formatDuration(60000)).toBe('1 分 0 秒')
    expect(formatDuration(3660000)).toBe('1 小时 1 分')
  })
})
