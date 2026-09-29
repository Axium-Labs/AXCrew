// 把 AX Crew 打成「便携版」zip：dist-pack/AX-Crew-<version>-win-x64-portable.zip
//
// 为什么要有这个脚本：便携版坏过一次（0.3.0）——那次是拿 `cargo build --release` 的产物
// 去打包的，没有 `tauri/custom-protocol`，webview 被编成 dev 模式，运行时去找
// http://localhost:1420，双击打开就是 ERR_CONNECTION_REFUSED。
// 所以这里固定走 `cargo tauri build --no-bundle`，并且在打包前**校验 exe 里确实内嵌了前端**。
//
// 用法：cd desktop && npm run pack:portable

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktop = resolve(scriptDir, '..')
const crew = resolve(desktop, '..')
const srcTauri = resolve(desktop, 'src-tauri')
const isWin = process.platform === 'win32'
const ext = isWin ? '.exe' : ''

const version = JSON.parse(readFileSync(resolve(srcTauri, 'tauri.conf.json'), 'utf8')).version
const stamp = new Date().toISOString().slice(0, 10)
const folder = `AX-Crew-${version}-${isWin ? 'win-x64' : `${process.platform}-${process.arch}`}`
const outDir = resolve(crew, 'dist-pack', folder)
const zipPath = resolve(crew, 'dist-pack', `${folder}-portable.zip`)
const exePath = resolve(srcTauri, 'target', 'release', `ax-crew-desktop${ext}`)

function run(command, args, cwd) {
  console.log(`\n$ ${command} ${args.join(' ')}\n  (cwd=${cwd})`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false })
  if (result.status !== 0) {
    console.error(`\n✗ 失败（exit ${result.status}）：${command} ${args.join(' ')}`)
    process.exit(result.status ?? 1)
  }
}

console.log(`\n=== 打包 AX Crew ${version} → ${folder} ===`)

// --pack-only：跳过两步编译，只重新组装/压缩（改说明文字时用）
const packOnly = process.argv.includes('--pack-only')

if (packOnly) {
  console.log('（--pack-only：跳过编译，直接重新组装）')
} else {
  // 1. ax.exe / ax-crew.exe → src-tauri/bin/（tauri.conf.json 的 bundle.resources 只认这里）
  run('node', [resolve(scriptDir, 'prepare-binaries.mjs')], scriptDir)

  // 2. Tauri 壳。必须走 CLI：它才会带上 tauri/custom-protocol。
  run('cargo', ['tauri', 'build', '--no-bundle'], srcTauri)
}

// 3. 校验：exe 里必须内嵌前端资源（dev 构建没有，打包出去就是一片 ERR_CONNECTION_REFUSED）
const embedded = [
  ...new Set(readFileSync(exePath).toString('latin1').match(/index-[A-Za-z0-9_-]{8}\.(?:js|css)/g) ?? []),
]
if (!embedded.some((asset) => asset.endsWith('.js'))) {
  console.error(
    `\n✗ ${exePath} 里没有内嵌前端资源 —— 这是一个 dev 构建，打包出去会打不开。\n` +
      '  请确认构建走的是 cargo tauri build（本脚本第 2 步），而不是 cargo build --release。',
  )
  process.exit(1)
}
console.log(`\n✓ 前端已内嵌进 exe：${embedded.join('  ')}`)

// 4. 组装便携目录（只放 2 个产物，别把开发期残留的 crew.sqlite3 带出去）。
//    AX 可执行文件不随包捆绑 —— Crew 用通过 GitHub 安装/更新的 AX
//    （设置 → 本地 AX → AX 更新），所以这里只带 Crew 自己的后端网关。
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
mkdirSync(resolve(outDir, 'bin'), { recursive: true })
copyFileSync(exePath, resolve(outDir, `ax-crew-desktop${ext}`))
for (const name of ['ax-crew']) {
  const from = resolve(srcTauri, 'bin', `${name}${ext}`)
  if (!existsSync(from)) {
    console.error(`\n✗ 缺少 ${from}，prepare-binaries 没有正常完成`)
    process.exit(1)
  }
  copyFileSync(from, resolve(outDir, 'bin', `${name}${ext}`))
}

const notes = readFileSync(resolve(scriptDir, 'pack-notes.txt'), 'utf8')
  .replaceAll('{{VERSION}}', version)
  .replaceAll('{{DATE}}', stamp)
writeFileSync(resolve(outDir, '使用说明.txt'), notes.replace(/\n{3,}/g, '\n\n'))

// 5. 压 zip（用 Windows 自带的 bsdtar，不依赖 PATH 里的 powershell/zip）
if (existsSync(zipPath)) rmSync(zipPath, { force: true })
if (isWin) {
  const tarExe = resolve(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  run(tarExe, ['-a', '-c', '-f', zipPath, folder], resolve(crew, 'dist-pack'))
} else {
  run('zip', ['-qr', zipPath, folder], resolve(crew, 'dist-pack'))
}

const size = statSync(zipPath).size
console.log(`\n✓ 打包完成：${outDir}`)
console.log(`✓ ${zipPath}（${(size / 1024 / 1024).toFixed(1)} MB）`)
console.log('  记得更新 scripts/pack-notes.txt 里的「改了什么」再发出去。\n')
