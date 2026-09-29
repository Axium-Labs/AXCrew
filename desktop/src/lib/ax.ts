import { invoke, isTauri } from '@tauri-apps/api/core'

export type AxModel = { provider: string; id: string; display_name: string }
export type AxProvider = { id: string; name: string; configured: boolean; source: string | null; supported: boolean; unsupported_reason: string | null; model_source?: 'cache' | 'fallback' | 'none'; models: AxModel[] }
/** Result of the model discovery run that follows storing an API key. */
export type AxDiscovery = { provider: string; models: number; warning: string | null }
/** 检查 / 下载 / 更新系统中安装的 AX 的结果。 */
export type AxUpdateStatus = {
  /** 这次检查或更新对应的 AX 路径；null 表示这台机器上还没装 AX。 */
  binary: string | null
  local_version: string | null
  /** GitHub 上的最新 tag，形如 v0.1.1。 */
  latest_version: string
  up_to_date: boolean
  /** 下一步该做什么：不用动 / 更新已有的 / 下载安装。 */
  action: 'none' | 'update' | 'install'
  install_dir: string
  /** 只在真正下载或更新之后带上：安装脚本或 ax --update 的原始输出。 */
  report?: string
}
export type AxLocalState = {
  installed_path: string | null
  installed_version: string | null
  installed_compatible: boolean
  active_path: string
  active_version: string | null
  home: string
  selected_model: AxModel | null
  providers: AxProvider[]
  discovery?: AxDiscovery
}
export type AxSkill = { name: string; description: string; missing_tools: string[] }
export type AxMcpServer = { name: string; description: string; enabled: boolean; capabilities: string[] }
export type AxToolInfo = { name: string; description: string }
/** AX 的只读目录扩展：技能 / MCP 服务器 / 内置工具。 */
export type AxCatalog = {
  /** 查询用的工作目录；null 表示没指定，只看得到全局技能与内置工具。 */
  cwd: string | null
  skills: AxSkill[]
  mcp_servers: AxMcpServer[]
  tools: AxToolInfo[]
  /** 单项查不到时的原因，其余目录照常返回。 */
  warnings: string[]
}

export const axAvailable = isTauri()
export const axLocalState = () => invoke<AxLocalState>('ax_local_state')
export const axStoreApiKey = (provider: string, key: string) => invoke<AxLocalState>('ax_store_api_key', { provider, key })
export const axRefreshModels = (provider?: string) => invoke<AxLocalState>('ax_refresh_models', { provider: provider ?? null })
export const axRemoveCredential = (provider: string) => invoke<AxLocalState>('ax_remove_credential', { provider })
export const axSelectModel = (provider: string, model: string) => invoke<AxLocalState>('ax_select_model', { provider, model })
export const axExport = (cwd: string, path: string, scope: 'all' | 'memory' | 'sessions') => invoke<string>('ax_export', { cwd, path, scope })
export const axImport = (cwd: string, path: string, dryRun: boolean) => invoke<string>('ax_import', { cwd, path, dryRun })
/** 读 GitHub Releases 上的最新 AX，和本机装的那份比一比。 */
export const axCheckUpdate = () => invoke<AxUpdateStatus>('ax_check_update')
/** 下载或更新系统中安装的 AX（`ax --update`，没有就退回官方安装脚本）。 */
export const axApplyUpdate = () => invoke<AxUpdateStatus>('ax_apply_update')
/** 读 AX 已装的技能、MCP 服务器与内置工具；cwd 决定看到哪些项目级配置。 */
export const axCatalog = (cwd?: string) => invoke<AxCatalog>('ax_catalog', { cwd: cwd ?? null })
export const workspaceFileExists = (root: string, relative: string) => invoke<boolean>('workspace_file_exists', { root, relative })
