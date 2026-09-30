import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const fixture = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: fixture.invoke }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.2.1' }))
vi.mock('../lib/ax', () => ({ axAvailable: true }))
import { CrewUpdater } from './CrewUpdater'
const mount = () => render(<QueryClientProvider client={new QueryClient()}><CrewUpdater/></QueryClientProvider>)
beforeEach(() => fixture.invoke.mockReset())
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Crew installer updates', () => {
  it('requires confirmation before exiting for an available installer', async () => {
    fixture.invoke.mockResolvedValue({ current_version: '0.2.1', latest_version: 'v0.2.2', available: true })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: '检查 AX Crew 更新' }))
    await user.click(await screen.findByRole('button', { name: /下载并更新到/ }))
    expect(fixture.invoke).toHaveBeenCalledTimes(1)
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: /下载并更新到/ }))
    expect(fixture.invoke).toHaveBeenLastCalledWith('crew_apply_update')
  })
  it('does not offer installation when current, and exposes check failures', async () => {
    const user = userEvent.setup()
    fixture.invoke.mockResolvedValueOnce({ current_version: '0.2.1', latest_version: 'v0.2.1', available: false })
    mount()
    await user.click(screen.getByRole('button', { name: '检查 AX Crew 更新' }))
    expect(await screen.findByRole('status')).toHaveProperty('textContent', '已是最新版本。')
    expect(screen.queryByRole('button', { name: /下载并更新到/ })).toBeNull()
    fixture.invoke.mockRejectedValueOnce('GitHub 无法访问')
    await user.click(screen.getByRole('button', { name: '检查 AX Crew 更新' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'GitHub 无法访问')
  })
})
