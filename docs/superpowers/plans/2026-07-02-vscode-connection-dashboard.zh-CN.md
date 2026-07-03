# VS Code 连接仪表盘实现计划

> **给 agentic worker：** 实施本计划时应使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，并按任务逐项执行。

## 目标

在 VS Code 插件中构建连接仪表盘，展示：

- Agent Host 状态。
- 移动 App / 微信小程序配对状态。
- 桌面 Agent 能力和会话状态。

## 架构

Agent Host 暴露聚合状态接口：

```text
GET /status
```

VS Code Webview 定时轮询该接口并渲染仪表盘。第一版使用轮询保持简单和可测试，未来可替换为 WebSocket 订阅。

## 实施任务

### 任务 1：扩展协议类型

- 在 `protocol` 中加入客户端类型：
  - Android App
  - iOS App
  - 微信小程序
  - unknown
- 增加 Host dashboard status schema。
- 测试协议字段校验。

### 任务 2：实现 Host `/status`

`/status` 返回：

- server 状态。
- pairing 状态。
- devices 列表。
- agents 摘要。
- sessions 摘要。

Codex 可用性基于配置的 `agentMobile.codexCommand` 或 Host adapter 状态。

### 任务 3：扩展 VS Code Webview

- 渲染 Host 状态。
- 渲染配对二维码和 JSON。
- 渲染移动设备列表。
- 渲染 Codex、Claude Code、OpenCode 的能力状态。
- 渲染 session 摘要。

### 任务 4：刷新和错误状态

- Webview 每隔数秒刷新。
- Host 停止时显示 stopped 状态。
- Host 不可达时显示错误。
- 保留原有启用/停用 LAN 和复制配对 JSON 操作。

## 验证

运行：

```powershell
npm run test -w @agent-mobile/protocol
npm run test -w @agent-mobile/agent-host
npm run test -w agent-mobile-control
npm run build
```

## 验收标准

- `/status` 返回 server、pairing、devices、agents、sessions。
- Webview 能展示连接状态和会话摘要。
- Host 停止、不可达、无设备、无会话等状态都有明确 UI。
- 现有配对流程保持兼容。
