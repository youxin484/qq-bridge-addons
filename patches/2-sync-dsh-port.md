# 补丁 2：DSH 端口每次重启都同步

文件：\<bridge>/start.bat\

原来 \sync-dsh-url.mjs\ 只在循环外跑一次，桥接崩溃重启后不会重新同步端口。
把它挪进 \:loop\：

\\\at
:loop
rem re-sync DSH port on every restart
"%NODE_EXE%" sync-dsh-url.mjs
"%NODE_EXE%" src/bridge.js
\\\

另外 \start.bat\ 里**不要写中文注释**：cmd 按系统 ANSI 解析 .bat，
UTF-8 中文会把整行当成命令执行（表现为一堆 '\*\*\* is not recognized'）。
