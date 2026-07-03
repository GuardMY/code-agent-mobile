# Codex 移动端线程接管设计

## 目标

Agent Mobile 应允许手机跟随并继续发送消息到电脑端已经启动的 Codex 会话。手机不能创建新的 Codex 会话。

## 行为

- Agent Host 通过 Codex app-server 发现当前 workspace 的 threads。
- Host 把可接管的 Codex thread 映射为 Agent Mobile session。
- 手机连接后读取 session 列表，并选择最新可运行的 Codex session。
- 手机发送文本时，Host 恢复对应 thread 并启动新的 Codex turn。
- 如果没有桌面 Codex thread，手机显示空状态，不自动创建会话。

## 选定方案

Host 拥有一个 Codex thread gateway，用 app-server JSON-RPC 与 Codex 通信：

- `thread/list`：列出已有 threads。
- `thread/resume`：恢复指定 thread，并尽可能读取历史内容。
- `turn/start`：发送新的用户输入。
- `turn/steer`：在已有 turn 进行中时追加输入。

`SessionManager` 仍然暴露移动端熟悉的 session 模型，但 Codex session 可以是一个 attached desktop thread，而不是由 Agent Mobile 新建的子进程。

## 范围

第一版只支持当前 workspace 的 Codex threads，并优先选择最新 session。暂不支持：

- 移动端新建 Codex thread。
- 多 thread 切换 UI 的复杂筛选。
- 多客户端同时写入冲突处理。
- 全局 `~/.codex` 会话浏览。

## 错误处理

- Codex app-server 不可用时，Host 返回空 session 列表，并在状态中暴露可用性失败。
- 没有桌面 thread 时，移动端显示需要先在电脑端启动 Codex。
- 已恢复但没有 live process 的旧 Agent Mobile session 视为 exited。
- 对非 running session 发送输入返回冲突错误。

## 测试

- app-server 客户端测试覆盖 `thread/list`、`thread/resume`、历史解析和 `turn/start`。
- SessionManager 测试覆盖发现 desktop session、attach 和输入转发。
- Server 测试覆盖 `/sessions` 同步 desktop sessions，以及禁用 `POST /sessions` 创建。
- Android ViewModel 测试覆盖连接时不创建 session，并向已发现 session 发送输入。
