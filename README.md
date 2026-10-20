# qq-bridge-addons

给 [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge) 加两个能力：

1. **动态语音**——用本地 GPT-SoVITS 把任意短句合成成语音，发成 QQ 语音条（不再限于语音库里那几条固定台词）
2. **B 站视频摘要**——给它一个 BV 号/链接，它能读到标题、数据、字幕和关键帧图片，然后像群友一样聊这个视频

同时附带一个解决「DSH 端口每次启动都变」的小工具，避免桥接静默失联。

> 本仓库只包含**扩展**，不含 qq-bridge 本体。请先自行安装上游：<https://github.com/Derpyu520/qq-bridge>。
> 上游为 MIT，署名见 [NOTICE-upstream-LICENSE.txt](NOTICE-upstream-LICENSE.txt)。

## 装了什么

| 文件 | 位置（装完后） | 作用 |
|---|---|---|
| `mcp/mcp-voice-tts.js` | `<bridge>/src/` | MCP 工具 `qq_say_voice(text, target?)`：文字 → GPT-SoVITS(9880) → 桥接发语音 |
| `mcp/mcp-bili-digest.js` | `<bridge>/src/` | MCP 工具 `bili_video_digest(url, frames?)`：B 站视频摘要，可带关键帧图片 |
| `tools/video-digest.mjs` | `<bridge>/` | 摘要生成器（yt-dlp + ffmpeg） |
| `tools/sync-dsh-url.mjs` | `<bridge>/` | 扫描本机端口，把 `config.json` 的 `dsh.baseUrl` 指到当前 DSH |
| `persona/小鲸鱼.example.md` | 参考 | 人格卡范例，可直接放 `<bridge>/roles/` |

## 前置条件

- 已装好并跑通 **qq-bridge**（SnowLuma + DSH 都能连上）
- **Node 22+**（桥接本来就需要）
- 语音功能额外需要：**GPT-SoVITS API** 在 `127.0.0.1:9880` 跑着
- 视频摘要额外需要：**yt-dlp**（`C:\yt-dlp\yt-dlp.exe` 或 PATH）、**ffmpeg**

## 安装

```sh
# 1. 装扩展文件 + 注册 MCP
node install.mjs --bridge "C:\path\to\qq-bridge" --profile desktop

# 2. 放行工具（手动）
#    编辑 <bridge>/plugins/qq-agent-presets/qq-tool-restrict.mjs
#    在 SAFE_PREFIXES 里加：
#        'mcp__voice-tts__',
#        'mcp__bili-digest__',

# 3. 重启 DSH
```

重启后，DSH 的工具清单里会出现 `mcp__voice-tts__qq_say_voice` 和 `mcp__bili-digest__bili_video_digest`。

## 语音功能配置

需要三样环境变量（或用默认路径）：

| 变量 | 说明 |
|---|---|
| `GPT_SOVITS_URL` | 默认 `http://127.0.0.1:9880` |
| `GPT_SOVITS_REF` | 参考音频路径；默认 `<bridge>/ref/reference.wav` |
| `GPT_SOVITS_REF_TEXT` | 参考音频里说的那句话（必须逐字一致，否则音色会漂） |

参考音频建议：**5～10 秒、无背景音乐、单人、口齿清楚**。用谁的声音自己决定，别用没授权的他人声音。

## 让模型真的去用

光装上工具不够——模型经常只记得「语音库」那个老工具，会说“库里没这句”。
在人格卡里把规则写死（见 `persona/小鲸鱼.example.md` 第十二、十三节）：

```
- 用户让你“用语音念某句话”时，必须用 mcp__voice-tts__qq_say_voice，参数 text 就是那句话；
  不要用 qq_send_voice 代替，也不要说“语音库里没这句”。
```

## 端口自愈

DSH 桌面版每次启动随机分配端口，桥接的 `dsh.baseUrl` 会失效且**不报错**（事件流 0 帧）。
`sync-dsh-url.mjs` 扫描本机监听端口，用 DSH 的 401 固定文案做指纹，找到就写回配置。

建议放在启动脚本里，**每次（重）启动前都跑一遍**：

```bat
:loop
"%NODE_EXE%" sync-dsh-url.mjs
"%NODE_EXE%" src/bridge.js
```

## 安全边界

- `qq_say_voice`：文本上限 80 字，只发到桥接白名单内的群/私聊，复用桥接自己的限流与审计
- `bili_video_digest`：只接受 `bilibili.com` / `b23.tv` / BV 号；只读，不执行命令
- 两个工具都不读写用户文件，也不改变桥接的发送闸门

## 已知坑

| 现象 | 原因 |
|---|---|
| 工具装好但群里调不到 | `qq-tool-restrict.mjs` 的白名单没加前缀 |
| 合成报 `cp932 codec can't encode` | 服务端控制台是日文编码，启动时设 `PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8` |
| 抽帧报 `format is not available` | 竖屏视频高度是 852，筛选条件别用 `height<=480` |
| 桥接连不上 DSH | 端口变了，跑 `sync-dsh-url.mjs` |

## License

MIT，见 [LICENSE](LICENSE)。上游 qq-bridge 的 MIT 声明见 [NOTICE-upstream-LICENSE.txt](NOTICE-upstream-LICENSE.txt)。
