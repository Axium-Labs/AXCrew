import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SubagentSettings } from './SubagentSettings'
import { useLang } from '../lib/i18n'
import type { AxLocalState } from '../lib/ax'

afterEach(() => { cleanup(); useLang.setState({ lang: 'zh' }) })
const state = {} as AxLocalState

describe('subagent settings', () => {
  it('defaults off and requests enabling through the controlled switch', async () => {
    useLang.setState({ lang: 'zh' })
    const change = vi.fn()
    render(<SubagentSettings value={state} disabled={false} onChange={change}/>)
    const toggle = screen.getByRole('switch', { name: '子智能体（Subagent）' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(toggle)
    expect(change).toHaveBeenCalledWith(true)
    // A failed save must not optimistically change the displayed persisted state.
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('shows the saved state and supports turning it off in English', async () => {
    useLang.setState({ lang: 'en' })
    const change = vi.fn()
    render(<SubagentSettings value={{...state, subagent_enabled: true}} disabled={false} onChange={change}/>)
    const toggle = screen.getByRole('switch', { name: 'Subagents' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(/next agent turn/)).toBeTruthy()
    await userEvent.click(toggle)
    expect(change).toHaveBeenCalledWith(false)
  })

  it('blocks changes while loading or saving', async () => {
    const change = vi.fn()
    const {rerender} = render(<SubagentSettings disabled={false} onChange={change}/>)
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    rerender(<SubagentSettings value={state} disabled={true} onChange={change}/>)
    await userEvent.click(screen.getByRole('switch'))
    expect(change).not.toHaveBeenCalled()
  })
})
