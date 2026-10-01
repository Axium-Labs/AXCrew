import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExecutionSettings } from './ExecutionSettings'
import { useLang } from '../lib/i18n'
import type { AxLocalState } from '../lib/ax'

afterEach(cleanup)
// jsdom does not implement the scrolling used by Radix keyboard navigation.
HTMLElement.prototype.scrollIntoView = vi.fn()
const state = { windows: true, agent_environment: 'native', terminal_shell: 'powershell' } as AxLocalState

describe('execution settings', () => {
  it('selects the terminal independently from the agent environment', async () => {
    useLang.setState({ lang: 'zh' })
    const change = vi.fn()
    const user = userEvent.setup()
    render(<ExecutionSettings value={state} disabled={false} onChange={change}/>)
    screen.getByRole('combobox', { name: '集成终端 Shell' }).focus()
    await user.keyboard('{Enter}{ArrowDown}{Enter}')
    expect(change).toHaveBeenCalledWith(undefined, 'cmd')
    expect(screen.getByRole('combobox', { name: '智能体环境' }).textContent).toContain('Windows 原生')
  })
  it('selects WSL as the agent environment', async () => {
    useLang.setState({ lang: 'zh' })
    const change = vi.fn()
    const user = userEvent.setup()
    render(<ExecutionSettings value={state} disabled={false} onChange={change}/>)
    screen.getByRole('combobox', { name: '智能体环境' }).focus()
    await user.keyboard('{Enter}{ArrowDown}{Enter}')
    expect(change).toHaveBeenCalledWith('wsl')
  })
  it('disables unavailable platform shells and pending settings', () => {
    useLang.setState({ lang: 'en' })
    const { rerender } = render(<ExecutionSettings value={{...state, windows: false}} disabled={false} onChange={vi.fn()}/>)
    expect((screen.getByRole('combobox', {name: 'Integrated terminal shell'}) as HTMLButtonElement).disabled).toBe(true)
    rerender(<ExecutionSettings value={state} disabled={true} onChange={vi.fn()}/>)
    expect((screen.getByRole('combobox', {name: 'Agent environment'}) as HTMLButtonElement).disabled).toBe(true)
    useLang.setState({ lang: 'zh' })
  })
})
