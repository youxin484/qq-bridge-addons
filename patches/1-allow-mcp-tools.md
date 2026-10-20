# 补丁 1：放行两个 MCP 工具

文件：\<bridge>/plugins/qq-agent-presets/qq-tool-restrict.mjs\

找到 \SAFE_PREFIXES\，加两行：

\\\js
const SAFE_PREFIXES = [
  'mcp__snowluma__',
  'mcp__snowluma-host__',
  'mcp__web-search-safe__',
  'mcp__voice-tts__',    // 动态语音
  'mcp__bili-digest__',  // B 站视频摘要
]
\\\

为什么要改：这个守卫是**执行期白名单**，不在名单里的工具调用会被直接拒绝——
即使工具已经注册进 schema，模型调了也会失败。
