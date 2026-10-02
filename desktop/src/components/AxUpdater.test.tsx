import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AxUpdateStatus } from '../lib/ax'

// 面板只做两件事：调这两个命令、把结果画出来。这里替掉 lib/ax，避免真的去碰 Tauri。
const fixture = vi.hoisted(() => ({ check: vi.fn(), apply: vi.fn() }))
vi.mock('../lib/ax', () => ({ axAvailable: true, axCheckUpdate: fixture.check, axApplyUpdate: fixture.apply }))

import { AxUpdater } from './AxUpdater'

const status = (patch: Partial<AxUpdateStatus> = {}): AxUpdateStatus => ({
  binary: 'C:/Users/me/.local/bin/ax.exe',
  local_version: 'ax 0.1.0',
  latest_version: 'v0.1.1',
  up_to_date: false,
  action: 'update',
  install_dir: 'C:/Users/me/AppData/Local/Programs/AX/bin',
  ...patch,
})

const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AxUpdater/></QueryClientProvider>,
)

beforeEach(() => { fixture.check.mockReset(); fixture.apply.mockReset() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('AX 更新面板', () => {
  it('检查后显示版本差异，确认过才替换', async () => {
    const user = userEvent.setup()
    fixture.check.mockResolvedValue(status())
    fixture.apply.mockResolvedValue(status({ up_to_date: true, action: 'none', local_version: 'ax 0.1.1', report: 'AX: updated C:/Users/me/.local/bin/ax.exe.' }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    mount()

    await user.click(screen.getByRole('button', { name: /检查更新/ }))
    expect(await screen.findByText('v0.1.1')).toBeTruthy()
    expect(screen.getByText('C:/Users/me/.local/bin/ax.exe')).toBeTruthy()

    const update = screen.getByRole('button', { name: /更新到 v0.1.1/ })
    await user.click(update)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(fixture.apply).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await user.click(update)
    await waitFor(() => expect(fixture.apply).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/AX: updated/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /重启 AX Crew，使用系统 AX/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /已是最新版本/ })).toHaveProperty('disabled', true)
  })

  it('目标已是最新时不给出可点的更新按钮', async () => {
    const user = userEvent.setup()
    fixture.check.mockResolvedValue(status({ up_to_date: true, action: 'none', local_version: 'ax 0.1.1' }))
    mount()

    await user.click(screen.getByRole('button', { name: /检查更新/ }))
    expect(await screen.findByText(/已是最新版本。/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /已是最新版本/ })).toHaveProperty('disabled', true)
  })

  it('本机没装 AX 时提示安装目录', async () => {
    const user = userEvent.setup()
    fixture.check.mockResolvedValue(status({ binary: null, local_version: null, action: 'install' }))
    mount()

    await user.click(screen.getByRole('button', { name: /检查更新/ }))
    expect(await screen.findByRole('button', { name: /下载并安装 AX/ })).toHaveProperty('disabled', false)
    expect(screen.getByText('未安装')).toBeTruthy()
    expect(screen.getByText(/Programs\/AX\/bin/)).toBeTruthy()
  })

  it('命令报错时把原因显示出来', async () => {
    const user = userEvent.setup()
    fixture.check.mockRejectedValue('无法访问 GitHub Releases：连接超时')
    mount()

    await user.click(screen.getByRole('button', { name: /检查更新/ }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('无法访问 GitHub Releases')
    expect(screen.queryByRole('button', { name: /已是最新版本/ })).toBeNull()
    expect(screen.getByRole('button', { name: /尚未检查/ })).toHaveProperty('disabled', true)
  })
})
