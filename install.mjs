#!/usr/bin/env node
// 把扩展装进已有的 qq-bridge 目录，并注册两个 MCP server 到 DSH profile。
//
// 用法：
//   node install.mjs --bridge "C:\path\to\qq-bridge" [--profile desktop]
//
// 做的事：
//   1. mcp/*.js   → <bridge>/src/
//   2. tools/*.mjs → <bridge>/
//   3. 在 <dshHome>/profiles/<profile>/cordis.patch.yml 里插入两个 MCP 条目
//
// 不做的（需要手动，见 patches/）：
//   - 给 qq-tool-restrict.mjs 的 SAFE_PREFIXES 加两行
//   - 把 start.bat 的端口同步挪进循环

import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const BRIDGE = arg('--bridge', null)
const PROFILE = arg('--profile', 'desktop')
if (!BRIDGE) {
  console.error('用法: node install.mjs --bridge "<qq-bridge 目录>" [--profile desktop]')
  process.exit(1)
}
const bridge = resolve(BRIDGE)
if (!existsSync(join(bridge, 'src', 'bridge.js'))) {
  console.error(`看起来不是 qq-bridge 目录（缺少 src/bridge.js）: ${bridge}`)
  process.exit(1)
}

// 1) 复制文件
mkdirSync(join(bridge, 'src'), { recursive: true })
for (const f of ['mcp-voice-tts.js', 'mcp-bili-digest.js']) {
  cpSync(join(HERE, 'mcp', f), join(bridge, 'src', f))
  console.log(`✓ ${join(bridge, 'src', f)}`)
}
for (const f of ['video-digest.mjs', 'sync-dsh-url.mjs']) {
  cpSync(join(HERE, 'tools', f), join(bridge, f))
  console.log(`✓ ${join(bridge, f)}`)
}

// 2) 注册 MCP
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const patchPath = join(dshHome, 'profiles', PROFILE, 'cordis.patch.yml')
if (!existsSync(patchPath)) {
  console.error(`找不到 profile patch: ${patchPath}`)
  process.exit(1)
}

const nodeExe = process.execPath
const block = (id, serverName, script) => `- insert:
    - id: ${id}
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: ${serverName}
        transport: stdio
        command: '${nodeExe.replace(/\\/g, '\\')}'
        args:
          - '${join(bridge, 'src', script).replace(/\\/g, '\\')}'
`

let yaml = readFileSync(patchPath, 'utf8')
const additions = []
if (!yaml.includes('mcp-voice-tts')) additions.push(block('mcp-voice-tts', 'voice-tts', 'mcp-voice-tts.js'))
if (!yaml.includes('mcp-bili-digest')) additions.push(block('mcp-bili-digest', 'bili-digest', 'mcp-bili-digest.js'))

if (additions.length === 0) {
  console.log('- MCP 条目已存在，跳过')
} else {
  const marker = '# === qq-bridge MCP END ==='
  const text = additions.join('\n')
  yaml = yaml.includes(marker) ? yaml.replace(marker, text + marker) : yaml + '\n' + text
  writeFileSync(patchPath, yaml, 'utf8')
  console.log(`✓ 已写入 ${patchPath}`)
}

console.log(`
下一步（必须手动，否则 QQ 会话里调不到）：
  1. 编辑 ${join(bridge, 'plugins', 'qq-agent-presets', 'qq-tool-restrict.mjs')}
     在 SAFE_PREFIXES 里加两行：
        'mcp__voice-tts__',
        'mcp__bili-digest__',
  2. 重启 DSH（MCP 与 preset 只在启动时加载）
  3. 语音功能还需要：OpenAI/GPT-SoVITS 服务在 127.0.0.1:9880 跑着，
     并设置环境变量 GPT_SOVITS_REF（参考音频）、GPT_SOVITS_REF_TEXT（参考音频对应的文字）
`)
