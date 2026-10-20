// B 站视频摘要 MCP server（stdio）。由 DSH 的 MCP 客户端 spawn。
//
// 暴露一个只读工具 `bili_video_digest`：
//   - 输入 B 站链接 / BV 号
//   - 后台跑 video-digest.mjs（yt-dlp 取元数据 + 字幕，可选 ffmpeg 抽帧）
//   - 返回 digest.md 全文；开启抽帧时，把关键帧作为图片内容一并交给多模态模型
//
// 安全边界：只接受 bilibili.com / b23.tv / BV 号；不读本地任意文件；不执行用户提供的命令。

import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

/** 项目根目录（与 mcp-web-search-safe 同款：argv[1] 是 src/ 下的本文件）。 */
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

const ALLOWED = /^(https?:\/\/(www\.|m\.)?bilibili\.com\/(video\/)?|https?:\/\/b23\.tv\/|https?:\/\/bili2233\.cn\/|BV[0-9A-Za-z]{10})/i
const MAX_IMAGES = 6

const server = new McpServer({ name: 'bili-digest', version: '1.0.0' })

server.tool(
  'bili_video_digest',
  '读取一个 B 站视频并生成摘要包：标题、UP主、播放/点赞数据、标签、简介、字幕全文，可选抽关键帧图片。返回 digest.md 文本；开了 frames 时会把关键帧图片一起返回，视觉模型可以直接“看”到画面。只读，不下载除该视频以外的任何东西。',
  {
    url: z.string().describe('B 站视频链接（含 b23.tv 短链）或 BV 号'),
    frames: z.number().int().min(0).max(MAX_IMAGES).optional().describe('抽几张关键帧，默认 0（不抽帧，最快）'),
    maxMinutes: z.number().min(1).max(180).optional().describe('超过这个时长就跳过抽帧，默认 30 分钟'),
  },
  async ({ url, frames, maxMinutes }) => {
    const input = String(url ?? '').trim()
    if (!ALLOWED.test(input)) {
      return { content: [{ type: 'text', text: `只支持 B 站链接或 BV 号，收到：${input.slice(0, 120)}` }], isError: true }
    }

    const root = projectRoot()
    const script = path.join(root, 'video-digest.mjs')
    if (!existsSync(script)) {
      return { content: [{ type: 'text', text: `找不到 video-digest.mjs：${script}` }], isError: true }
    }

    const wantFrames = Math.max(0, Math.min(MAX_IMAGES, Number(frames ?? 0)))
    const args = [script, input, '--frames', String(wantFrames), '--max-minutes', String(maxMinutes ?? 30),
      '--out', path.join(root, 'digest')]

    const run = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 20 * 60 * 1000,
      windowsHide: true,
    })

    if (run.status !== 0) {
      const tail = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim().split(/\r?\n/).slice(-6).join('\n')
      return { content: [{ type: 'text', text: `视频解析失败（exit ${run.status}）：\n${tail}` }], isError: true }
    }

    // 从输出里取产物目录（短链解析后的 BV 与输入不同，不能靠输入推断）
    const match = /输出目录:\s*(.+)$/m.exec(run.stdout ?? '')
    if (!match) {
      return { content: [{ type: 'text', text: `未能定位产物目录。输出：\n${(run.stdout ?? '').slice(-500)}` }], isError: true }
    }
    const outDir = match[1].trim()
    const mdPath = path.join(outDir, 'digest.md')
    if (!existsSync(mdPath)) {
      return { content: [{ type: 'text', text: `产物缺少 digest.md：${outDir}` }], isError: true }
    }

    const content = [{ type: 'text', text: readFileSync(mdPath, 'utf8') }]

    // 关键帧作为图片返回（视觉模型可直接看）
    const jsonPath = path.join(outDir, 'digest.json')
    if (wantFrames > 0 && existsSync(jsonPath)) {
      try {
        const digest = JSON.parse(readFileSync(jsonPath, 'utf8'))
        for (const frame of digest.frames ?? []) {
          const file = path.join(outDir, frame.file)
          if (!existsSync(file)) continue
          content.push({
            type: 'image',
            data: readFileSync(file).toString('base64'),
            mimeType: 'image/jpeg',
          })
        }
      } catch { /* 图片失败不影响文本结果 */ }
    }

    // 视频文件抽完帧就没用了，删掉省空间
    const video = ['video.mp4', 'video.webm', 'video.mkv']
      .map(name => path.join(outDir, name))
      .find(file => existsSync(file))
    if (video) {
      try { rmSync(video, { force: true }) } catch { /* 忽略 */ }
    }

    return { content }
  },
)

await server.connect(new StdioServerTransport())
