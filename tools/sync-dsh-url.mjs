// 自动把 config.json 的 dsh.baseUrl 指向「当前正在运行的 DSH 实例」。
//
// 背景：DSH 桌面版每次启动会随机分配端口（今天见过 11230、1319），
// 而 qq-bridge 的配置是静态的，端口一变就静默连不上（事件流 0 帧）。
// 这里扫描本机监听端口，用 DSH 的 401 固定文案做指纹，找到就写回配置。
//
// 用法：node sync-dsh-url.mjs        （由 start.bat 自动调用）
//       node sync-dsh-url.mjs --print

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = import.meta.dirname
const CONFIG = join(ROOT, 'config.json')
const SIGNATURE = 'dsh web authentication required'

function listeningPorts() {
  let out = ''
  try {
    out = execFileSync('netstat', ['-an'], { encoding: 'utf8', windowsHide: true })
  } catch {
    return []
  }
  const ports = new Set()
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING/i.exec(line)
    if (!m) continue
    if (!/^(127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\])$/.test(m[1])) continue
    ports.add(Number(m[2]))
  }
  return [...ports]
}

async function isDsh(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(600) })
    if (res.status !== 401) return false
    const text = await res.text()
    return text.includes(SIGNATURE)
  } catch {
    return false
  }
}

const ports = listeningPorts()
const hits = []
await Promise.all(ports.map(async port => {
  if (await isDsh(port)) hits.push(port)
}))

if (hits.length === 0) {
  console.error('[dsh-url] 没找到运行中的 DSH（请确认 DSH 桌面版已打开）')
  process.exit(1)
}

// 端口小的通常是更早启动的实例；多个实例时取最小的那个
hits.sort((a, b) => a - b)
const baseUrl = `http://127.0.0.1:${hits[0]}`

if (process.argv.includes('--print')) {
  console.log(baseUrl)
  process.exit(0)
}

const config = JSON.parse(readFileSync(CONFIG, 'utf8'))
const before = config.dsh?.baseUrl
if (before === baseUrl) {
  console.log(`[dsh-url] ${baseUrl}（未变化）`)
  process.exit(0)
}
config.dsh = { ...(config.dsh ?? {}), baseUrl }
writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf8')
console.log(`[dsh-url] ${before ?? '(空)'} -> ${baseUrl}`)
