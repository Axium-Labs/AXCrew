import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TranscriptLine, TranscriptLines } from './SessionTranscript'
import { useLang } from '../lib/i18n'
import type { SessionLine } from '../lib/sessionTranscript'

beforeEach(() => { useLang.setState({ lang: 'zh' }) })
afterEach(cleanup)

const head = () => screen.getByRole('button', { name: '思考过程' })

describe('user turns',()=>{
  it('renders on the right in a bubble without an avatar',()=>{
    const { container } = render(<TranscriptLine line={{type:'user',text:'找鲁迅的作品',key:'u1'}}/>)
    expect(container.querySelector('.session-transcript-line.is-user')).not.toBeNull()
    expect(container.querySelector('.session-transcript-user .session-transcript-bubble')).not.toBeNull()
    expect(container.querySelector('.session-transcript-avatar')).toBeNull()
    expect(screen.getByText('找鲁迅的作品')).toBeTruthy()
  })
})

describe('the activity timeline',()=>{
  const turn:SessionLine[]=[
    {type:'thought',text:'先看文件系统',key:'k1'},
    {type:'agent',text:'我先看看当前环境里有没有相关的文件。',key:'a1'},
    {type:'tool',text:'read src/main.rs',output:'fn main(){}',status:'completed',key:'t1'},
    {type:'agent',text:'这个目录只有 Rust 构建产物。',key:'a2'},
  ]

  it('lists one compact row per step and leaves the last answer open',()=>{
    const { container } = render(<TranscriptLines lines={turn}/>)
    expect(container.querySelectorAll('.session-activity')).toHaveLength(1)
    expect(container.querySelectorAll('.session-activity-item')).toHaveLength(3)
    // The step itself is on screen, its payload is not.
    expect(screen.getByText('先看文件系统')).toBeTruthy()
    expect(container.querySelector('.session-activity-output')).toBeNull()
    // The turn's answer is the only thing rendered at full weight.
    expect(screen.getByText('这个目录只有 Rust 构建产物。')).toBeTruthy()
  })

  it('reports what it did and how long it took in one muted line',()=>{
    render(<TranscriptLines lines={turn}/>)
    expect(head().textContent).toContain('已完成')
    expect(head().textContent).toContain('3 步')
  })

  it('says it is thinking while a tool is in flight, with a live indicator',()=>{
    const { container } = render(<TranscriptLines lines={[{type:'tool',text:'',status:'in_progress',key:'t9'}]}/>)
    expect(container.querySelector('.session-activity')?.className).toContain('is-running')
    expect(head().textContent).toContain('思考中')
    expect(container.querySelector('.session-activity-pulse')).not.toBeNull()
  })

  it('folds the whole timeline away and back',()=>{
    const { container } = render(<TranscriptLines lines={turn}/>)
    expect(head().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(head())
    expect(container.querySelectorAll('.session-activity-item')).toHaveLength(0)
    expect(head().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(head())
    expect(container.querySelectorAll('.session-activity-item')).toHaveLength(3)
  })

  it('reveals a tool result only once its row is opened',()=>{
    const { container } = render(<TranscriptLines lines={turn}/>)
    fireEvent.click(screen.getByRole('button', { name: /读取文件/ }))
    expect(container.querySelector('.session-activity-output')?.textContent).toBe('fn main(){}')
  })

  it('reveals the full thought only once its row is opened',()=>{
    const { container } = render(<TranscriptLines lines={turn}/>)
    fireEvent.click(screen.getByRole('button', { name: /先看文件系统/ }))
    expect(container.querySelector('.session-activity-detail')?.textContent).toContain('先看文件系统')
    expect(container.querySelectorAll('.session-activity-item')).toHaveLength(3)
  })

  it('keeps a step without anything to reveal as a plain row',()=>{
    const { container } = render(<TranscriptLines lines={[{type:'tool',text:'',status:'completed',key:'t1'}]}/>)
    expect(screen.getByText('工具')).toBeTruthy()
    expect(container.querySelector('.session-activity-row.is-static')?.textContent).toContain('工具')
  })

  it('translates the block copy',()=>{
    useLang.setState({ lang: 'en' })
    render(<TranscriptLines lines={turn}/>)
    expect(screen.getByRole('button', { name: 'Process' }).textContent).toContain('3 steps')
  })
})

describe('tool labels',()=>{
  const label = (text:string)=>{
    const { container } = render(<TranscriptLines lines={[{type:'tool',text,status:'completed',key:'t1'}]}/>)
    return { verb:container.querySelector('.session-activity-verb')?.textContent, rest:container.querySelector('.session-activity-target')?.textContent }
  }

  it('never shows the provider call id as a label',()=>{
    const { container } = render(<TranscriptLines lines={[{type:'tool',text:'',output:'ok',status:'completed',key:'call_00_x'}]}/>)
    expect(container.textContent).not.toContain('call_00_x')
    expect(container.querySelector('.session-activity-verb')?.textContent).toBe('工具')
  })

  it('names the action in Chinese and keeps the argument muted',()=>{
    expect(label('read src/main.rs')).toEqual({ verb:'读取文件', rest:'src/main.rs' })
    expect(label('running cargo test')).toEqual({ verb:'执行命令', rest:'cargo test' })
    expect(label("searching 'fn main' in src")).toEqual({ verb:'搜索代码', rest:"'fn main' in src" })
    expect(label('editing src/lib.rs')).toEqual({ verb:'编辑文件', rest:'src/lib.rs' })
    expect(label('write notes.md')).toEqual({ verb:'写入文件', rest:'notes.md' })
    expect(label('list src')).toEqual({ verb:'列出目录', rest:'src' })
    expect(label('fetch 1 url: https://example.com')).toEqual({ verb:'访问网页', rest:'https://example.com' })
    expect(label('calling mcp__github')).toEqual({ verb:'调用工具', rest:'mcp__github' })
  })

  it('leaves English activity as it came when the UI is in English',()=>{
    useLang.setState({ lang: 'en' })
    expect(label('read src/main.rs')).toEqual({ verb:'read src/main.rs', rest:undefined })
  })

  it('falls back to a generic label for an unknown action',()=>{
    expect(label('reticulating splines')).toEqual({ verb:'工具', rest:'reticulating splines' })
  })
})

describe('agent turns',()=>{
  it('shows the answer immediately without a toggle',()=>{
    const { container } = render(<TranscriptLine line={{type:'agent',text:'我先看看环境',key:'a1'}}/>)
    expect(screen.getByText('AX Crew')).toBeTruthy()
    expect(container.querySelector('.session-activity-row')).toBeNull()
    expect(screen.getByText('我先看看环境')).toBeTruthy()
  })
})

describe('time',()=>{
  it('renders the local clock for a stamped message',()=>{
    // Same-day messages show only the clock, so the stamp has to be today.
    const at = new Date()
    at.setHours(14, 5, 0, 0)
    render(<TranscriptLine line={{type:'agent',text:'hi',key:'a2',at:at.getTime()}}/>)
    expect(screen.getByText('14:05')).toBeTruthy()
  })

  it('omits the clock when AX reported no time',()=>{
    const { container } = render(<TranscriptLine line={{type:'agent',text:'hi',key:'a3'}}/>)
    expect(container.querySelector('.session-transcript-time')).toBeNull()
  })

  it('times a block from its first to its last step',()=>{
    const start = new Date(2026, 8, 29, 14, 5).getTime()
    render(<TranscriptLines lines={[
      {type:'thought',text:'想想',key:'k1',at:start},
      {type:'agent',text:'好了',key:'a1',at:start+41_000},
    ]}/>)
    expect(head().textContent).toContain('41s')
  })
})
