import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

/** Do not run a draft in a different folder without the user's selection. */
export async function resolveSendWorkspace(cwd?: string | null): Promise<string | null> {
  if (cwd) {
    try { return await invoke<string>('validate_workspace', { path: cwd }) }
    catch { /* Persisted project directories can be moved or deleted. */ }
  }
  // Do not pass the invalid path as defaultPath: native pickers may reject it.
  const selected = await open({ directory: true, multiple: false, title: '工作目录不可用，请选择现有文件夹' })
  if (typeof selected !== 'string') return null
  return invoke<string>('validate_workspace', { path: selected })
}
