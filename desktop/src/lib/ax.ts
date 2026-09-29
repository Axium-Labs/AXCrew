import { invoke, isTauri } from '@tauri-apps/api/core'

export type AxModel = { provider: string; id: string; display_name: string }
export type AxProvider = { id: string; name: string; configured: boolean; source: string | null; models: AxModel[] }
export type AxLocalState = {
  installed_path: string | null
  installed_version: string | null
  installed_compatible: boolean
  active_path: string
  active_version: string | null
  home: string
  selected_model: AxModel | null
  providers: AxProvider[]
}

export const axAvailable = isTauri()
export const axLocalState = () => invoke<AxLocalState>('ax_local_state')
export const axStoreApiKey = (provider: string, key: string) => invoke<AxLocalState>('ax_store_api_key', { provider, key })
export const axRemoveCredential = (provider: string) => invoke<AxLocalState>('ax_remove_credential', { provider })
export const axSelectModel = (provider: string, model: string) => invoke<AxLocalState>('ax_select_model', { provider, model })
export const axExport = (cwd: string, path: string, scope: 'all' | 'memory' | 'sessions') => invoke<string>('ax_export', { cwd, path, scope })
export const axImport = (cwd: string, path: string, dryRun: boolean) => invoke<string>('ax_import', { cwd, path, dryRun })
export const workspaceFileExists = (root: string, relative: string) => invoke<boolean>('workspace_file_exists', { root, relative })
