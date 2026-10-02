// 准备 Crew 发行包需要的二进制：只打包 Crew 自己的后端网关（ax-crew.exe）。
//
// AX 可执行文件不再随包捆绑：Crew 使用的 AX 通过 GitHub 官方安装脚本或
// `ax --update` 安装（Windows 为 %LOCALAPPDATA%\Programs\AX\bin，并写入 PATH），
// 设置页的「AX 更新」负责检测与更新它。因此这里不再从本地 ax 工作区编译并拷贝
// ax.exe —— 发行包里的 AX 一律来自 GitHub 安装的位置。
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// 发行脚本位于仓库根的 scripts/：`crew` 是 Cargo workspace 根（后端产物落在
// 它的 target/release/），`desktop` 是 Tauri 应用所在目录。
const crew = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktop = resolve(crew, 'apps', 'desktop')
const ext = process.platform === 'win32' ? '.exe' : ''
{
  const result = spawnSync('cargo', ['build', '--release'], { cwd: crew, stdio: 'inherit', shell: false })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const output = resolve(desktop, 'src-tauri', 'bin')
mkdirSync(output, { recursive: true })
copyFileSync(resolve(crew, 'target', 'release', `ax-crew${ext}`), resolve(output, `ax-crew${ext}`))

