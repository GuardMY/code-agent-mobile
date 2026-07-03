# Codex VS Code 直连实现计划

> **给 agentic worker：** 实施本计划时应使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，并按任务逐项执行。

## 目标

把原本直接启动交互式 `codex` CLI 的路径，替换为 `codex app-server` 客户端。这样 VS Code 插件通过 Codex 官方 app-server 协议驱动 Codex，而不是启动独立的终端式 CLI 会话。

## 架构

`agent-host` 保留 Android 使用的 HTTP/WebSocket 桥接层，但 Codex 后端改为 JSON-RPC 客户端：

- 启动 `codex app-server --listen stdio://`。
- 初始化 app-server 连接。
- 创建或恢复 Codex thread。
- 把移动端输入映射为 `turn/start` 或 `turn/steer`。
- 把 app-server 通知映射回现有 Host 事件流。

VS Code 插件表面行为保持不变，后端执行模型切换为 app-server。

## 实施任务

### 任务 1：用回归测试锁定 app-server 启动方式

- 修改 `agent-host/src/adapters/codexAdapter.test.ts`。
- 断言 Codex adapter 启动的是：

```text
codex app-server --listen stdio://
```

- 期望旧的交互式 CLI 路径测试失败。
- 实现 adapter 启动 app-server。
- 运行：

```powershell
npm run test -w @agent-mobile/agent-host -- src/adapters/codexAdapter.test.ts
```

### 任务 2：新增 app-server 客户端层

- 新增 `agent-host/src/codex/appServerClient.ts`。
- 新增 `agent-host/src/codex/appServerClient.test.ts`。
- 覆盖：
  - `initialize`
  - `thread/start`
  - `turn/start`
  - `turn/steer`
  - 输出 delta 事件解析
  - 进程退出和请求失败处理

运行：

```powershell
npm run test -w @agent-mobile/agent-host -- src/codex/appServerClient.test.ts
```

### 任务 3：改造 Host CLI 和扩展配置语义

- 保留 `agentMobile.codexCommand` 默认值为 `codex`。
- Host 内部固定追加 `app-server --listen stdio://`。
- 移除或忽略旧的交互式 CLI 参数路径。
- 更新相关测试和说明文案。

### 任务 4：端到端验证

运行：

```powershell
npm run build
npm run test
npm run test -w @agent-mobile/agent-host
npm run test -w agent-mobile-control
```

## 验收标准

- Codex adapter 不再启动交互式 TTY 会话。
- Agent Host 通过 app-server JSON-RPC 管理 Codex turn。
- 移动端和 VS Code 插件仍使用原有 session/event API。
- 构建和测试通过。
