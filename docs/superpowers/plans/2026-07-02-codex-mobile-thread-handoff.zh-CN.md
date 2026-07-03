# Codex 移动端线程接管实现计划

> **给 agentic worker：** 实施本计划时应使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，并按任务逐项执行。

## 目标

让移动端可以跟随并继续操作电脑端已经启动的 Codex thread，同时禁止移动端创建新的 Codex 会话。

## 架构

在 Agent Host 中增加 Codex app-server thread gateway：

- 通过 `thread/list` 发现当前 workspace 的 Codex threads。
- 通过 `thread/resume` 恢复已有 thread。
- 把已恢复的桌面 thread 表示为 Agent Mobile session。
- 保持现有 HTTP/WebSocket 移动端 API 尽量不变。

Android 不再主动创建 Codex session，而是在连接后选择 Host 返回的最新可用桌面 session。

## 实施任务

### 任务 1：扩展 app-server 客户端

- 在 `agent-host/src/codex/appServerClient.ts` 中增加：
  - `listThreads`
  - `resumeThread`
  - 历史输出解析
  - attached process 工厂
- 在测试中覆盖 JSON-RPC 映射和历史输出。

### 任务 2：扩展 SessionManager

- 增加 `syncDesktopSessions()`。
- 增加 `discoverSessions` 和 `attachSession` adapter 能力。
- 已发现但未 attach 的 Codex thread 在发送输入前自动 attach。
- 恢复后的输出进入现有事件流。

### 任务 3：更新 Host API

- `/sessions` 和 `/status` 返回前同步桌面 Codex sessions。
- 禁用移动端创建 Codex sessions。
- `POST /sessions` 返回冲突或明确提示。

### 任务 4：更新 Android 流程

- 连接后调用 `listSessions`。
- 选择最新的可运行 Codex session。
- `send` 使用已发现 session。
- `createSession` 不再创建 Codex 会话，并提示用户先在桌面启动 Codex。

## 验证

运行：

```powershell
npm run test -w @agent-mobile/agent-host
npm run test -w agent-mobile-control
npm run build
npm run test
```

Android 相关改动还需运行 Android app 构建。

## 验收标准

- Host 能发现桌面 Codex thread。
- 移动端能向已发现 thread 发送输入。
- 移动端不能创建新的 Codex 会话。
- 历史输出和新输出都进入统一事件流。
