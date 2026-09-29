import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const crew = resolve(desktop, '..')
const ax = resolve(crew, '..', 'ax')
const ext = process.platform === 'win32' ? '.exe' : ''
for (const [cwd, command] of [[ax, ['build', '--release', '-p', 'cli']], [crew, ['build', '--release']]]) {
  const result = spawnSync('cargo', command, { cwd, stdio: 'inherit', shell: false })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const output = resolve(desktop, 'src-tauri', 'bin')
mkdirSync(output, { recursive: true })
copyFileSync(resolve(ax, 'target', 'release', `ax${ext}`), resolve(output, `ax${ext}`))
copyFileSync(resolve(crew, 'target', 'release', `ax-crew${ext}`), resolve(output, `ax-crew${ext}`))
