// Collect native installers under the filenames understood by crew_update.rs.
// Run after a native Tauri build. This does not publish or install anything.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const crew = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.env.AX_CREW_TARGET || process.env.CARGO_BUILD_TARGET
const arch = target?.startsWith('aarch64-') ? 'arm64' : target?.startsWith('x86_64-') ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
if (!arch) throw new Error('Unsupported architecture')
const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : null
if (!platform) throw new Error('Unsupported platform')
const version = JSON.parse(readFileSync(resolve(crew, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')).version
const targetDir = resolve(crew, 'apps/desktop/src-tauri', process.env.CARGO_TARGET_DIR || 'target', ...(target ? [target] : []), 'release/bundle')
const output = resolve(crew, 'dist-platform', `${platform}-${arch}`)
mkdirSync(output, { recursive: true })
const formats = platform === 'windows' ? [['nsis', '.exe', '-setup.exe']] : platform === 'macos' ? [['dmg', '.dmg', '.dmg']] : [['deb', '.deb', '.deb'], ['appimage', '.AppImage', '.AppImage']]
const sums = []
for (const [folder, extension, suffix] of formats) {
  const directory = resolve(targetDir, folder)
  let files
  try { files = readdirSync(directory).filter(name => name.endsWith(extension)) }
  catch (error) { if (platform === 'linux' && folder === 'appimage' && error.code === 'ENOENT') continue; throw error }
  if (files.length !== 1) throw new Error(`Expected exactly one ${extension} in ${directory}, got ${files.length}`)
  const name = `AX-Crew-${version}-${platform}-${arch}${suffix}`
  const path = resolve(output, name)
  copyFileSync(resolve(directory, files[0]), path)
  sums.push(`${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${name}`)
}
writeFileSync(resolve(output, 'SHA256SUMS'), `${sums.join('\n')}\n`)
console.log(`Installers and SHA256SUMS: ${output}`)
