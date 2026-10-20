// AI 语音 MCP server（stdio）：把文字用 GPT-SoVITS 合成，再交给桥接发成 QQ 语音条。
//
// 工具：qq_say_voice(text, target?)
//   1. POST http://127.0.0.1:9880/tts 合成 wav
//   2. 落到 audio/generated/（桥接语音库目录内，避免越权路径）
//   3. spawn node scripts/send-voice.mjs send <file> <target>
//      —— 复用桥接自己那套白名单/限流/审计，不另开一条发送通道
//
// 安全边界：只发到白名单群/私聊；text 长度上限 80 字；单次合成超时 60 秒。

import path from 'node:path'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

function projectRoot() {
  try {
    const entry = String(process.argv[1] ?? '')
    if (entry) {
      const dir = path.dirname(path.resolve(entry))
      if (path.basename(dir) === 'src') return path.dirname(dir)
    }
  } catch { /* 忽略 */ }
  return process.cwd()
}

const ROOT = projectRoot()
const CONFIG_PATH = path.join(ROOT, 'config.json')
const AUDIO_DIR = path.join(ROOT, 'audio')
const GEN_DIR = path.join(AUDIO_DIR, 'generated')
const TTS_URL = process.env.GPT_SOVITS_URL ?? 'http://127.0.0.1:9880'
// 参考音频：优先环境变量，其次 <桥接目录>/ref/reference.wav。
prompt_text 必须与该音频内容逐字一致。
const REF_AUDIO = process.env.GPT_SOVITS_REF ?? path.join(ROOT, 'ref', 'reference.wav')
const REF_TEXT = process.env.GPT_SOVITS_REF_TEXT
  ?? '大家好，我是小鲸鱼，平时就在群里闲聊。今天天气还不错，等会儿准备去吃个饭，顺便看看有没有什么新消息。'
const MAX_CHARS = 80

const server = new McpServer({ name: 'qq-voice', version: '1.0.0' })

server.tool(
  'qq_say_voice',
  '把一句话用本地 GPT-SoVITS 合成成语音，并以 QQ 语音条发到指定群/私聊。只用于短句（不超过 80 字），适合语气词、吐槽、一句话回应。发送仍然受桥接白名单与限流约束。',
  {
    text: z.string().describe('要说的内容，短句，不超过 80 字'),
    target: z.string().optional().describe('目标，格式 group:群号 或 private:QQ号；省略则发到配置里第一个白名单群'),
  },
  async ({ text, target }) => {
    const say = String(text ?? '').trim()
    if (!say) return { content: [{ type: 'text', text: 'text 为空' }], isError: true }
    if (say.length > MAX_CHARS) {
      return { content: [{ type: 'text', text: `太长（${say.length} 字），上限 ${MAX_CHARS}` }], isError: true }
    }

    let cfg
    try { cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) } catch (e) {
      return { content: [{ type: 'text', text: `读 config.json 失败：${e.message}` }], isError: true }
    }

    let dest = String(target ?? '').trim()
    if (!dest) {
      const first = (cfg.allow?.groups ?? [])[0]
      if (!first) return { content: [{ type: 'text', text: '没有指定 target，且白名单为空' }], isError: true }
      dest = `group:${first}`
    }

    if (!existsSync(REF_AUDIO)) {
      return { content: [{ type: 'text', text: `参考音频缺失：${REF_AUDIO}` }], isError: true }
    }

    // 1) 合成
    let audio
    try {
      const res = await fetch(`${TTS_URL}/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: say,
          text_lang: 'zh',
          ref_audio_path: REF_AUDIO,
          prompt_text: REF_TEXT,
          prompt_lang: 'zh',
          media_type: 'wav',
          streaming_mode: false,
        }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      audio = Buffer.from(await res.arrayBuffer())
      if (audio.length < 1000) throw new Error(`返回数据过小（${audio.length} 字节）`)
    } catch (error) {
      return {
        content: [{ type: 'text', text: `GPT-SoVITS 合成失败：${error.message}（服务是否已启动？端口 9880）` }],
        isError: true,
      }
    }

    // 2) 落盘（文件名用内容哈希，避免重复堆积）
    mkdirSync(GEN_DIR, { recursive: true })
    const name = `${createHash('sha1').update(say).digest('hex').slice(0, 12)}.wav`
    const file = path.join(GEN_DIR, name)
    writeFileSync(file, audio)

    // 3) 交给桥接发送
    const script = path.join(ROOT, 'scripts', 'send-voice.mjs')
    const run = spawnSync(process.execPath, [script, 'send', `generated/${name}`, dest], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
    })
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
    if (run.status !== 0) {
      return { content: [{ type: 'text', text: `发送失败（exit ${run.status}）：\n${out.slice(-600)}` }], isError: true }
    }
    return {
      content: [{
        type: 'text',
        text: `已发送语音到 ${dest}：${say}\n${out.split(/\r?\n/).filter(l => l.includes('✅') || l.includes('messageId')).join('\n')}`,
      }],
    }
  },
)

await server.connect(new StdioServerTransport())
