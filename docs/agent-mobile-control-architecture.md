# VS Code Agent 移动端控制方案

## 1. 目标

通过 **VS Code 插件 + 后端服务 + Android App**，在手机端远程控制运行在 VS Code 中的 Claude Code、Codex、Gemini CLI、Aider 等 Agent 工具。

目标不是简单把电脑终端投屏到手机，而是提供一个可审计、可恢复、可扩展的 Agent 控制通道：

- 在 Android App 中查看 VS Code 工作区、Agent 会话、终端输出、任务状态。
- 在 Android App 中发送 prompt、确认操作、暂停/继续/终止 Agent。
- 支持同一局域网内直接连接，也支持公网远程访问。
- 支持多种 Agent 工具，通过适配器层隔离 Claude Code/Codex 等 CLI 差异。
- 尽量保留 Agent 在 VS Code 内运行的上下文，包括当前 workspace、终端、文件系统权限、git 状态和 IDE 插件能力。

## 2. 推荐总体路线

推荐采用 **先局域网 MVP，后公网远程控制** 的两阶段架构。

### 阶段一：局域网 MVP

手机和电脑在同一 Wi-Fi 下使用。

- VS Code 插件在本机启动 Agent 会话。
- 本机后端服务监听 `127.0.0.1` 或局域网地址。
- Android App 通过二维码配对，拿到服务地址和一次性配对 token。
- App 通过 WebSocket 接收流式输出，通过 HTTP/WebSocket 发送用户输入和控制命令。

优点：

- 实现成本低。
- 调试链路短。
- 不依赖公网、云服务、内网穿透。
- 适合作为第一版验证真实交互体验。

限制：

- 只能在同一网络下稳定使用。
- 电脑端服务暴露到局域网时必须做强鉴权。

### 阶段二：公网远程控制

在局域网 MVP 稳定后增加云端 Relay 或自建网关。

- 电脑端 Agent Host 主动连接云端 Relay。
- Android App 也连接云端 Relay。
- Relay 只转发加密后的会话消息，不直接访问用户代码。
- App 和电脑端通过设备配对、短期访问 token、会话级权限控制建立安全通道。

优点：

- 手机不在同一 Wi-Fi 时也可以控制。
- 避免用户手动配置路由器端口映射。
- 可以加入多设备、多工作区、审计、通知、离线状态等能力。

代价：

- 需要云服务部署、鉴权、限流、审计和密钥管理。
- 安全设计复杂度明显上升。

## 3. 架构总览

```text
Android App
  ├─ 会话列表
  ├─ Agent 聊天/终端界面
  ├─ 文件变更/命令确认界面
  └─ 推送通知
        │
        │ HTTPS / WebSocket
        ▼
Backend Gateway
  ├─ 设备配对
  ├─ 鉴权与授权
  ├─ WebSocket 消息路由
  ├─ 会话状态存储
  ├─ 审计日志
  └─ 公网 Relay
        │
        │ 本机 loopback / 局域网 / 反向长连接
        ▼
VS Code Extension
  ├─ Agent 会话管理
  ├─ Terminal/Pseudoterminal 控制
  ├─ Workspace 状态采集
  ├─ SecretStorage 凭据保存
  ├─ Webview/二维码配对
  └─ Agent Adapter 层
        │
        ▼
Agent Tools
  ├─ Claude Code
  ├─ Codex
  ├─ Gemini CLI
  ├─ Aider
  └─ 其他 CLI/SDK Agent
```

## 4. 核心组件设计

### 4.1 VS Code 插件

VS Code 插件是电脑端的控制中枢。它负责把 VS Code 工作区、终端 Agent 和移动端控制通道连接起来。

主要职责：

- 发现当前 workspace、git 分支、脏文件、可用 Agent 工具。
- 启动、挂载或恢复 Agent 会话。
- 捕获 Agent 输出流，并转换成统一事件。
- 接收移动端输入，转发给对应 Agent。
- 在高风险操作前向移动端请求确认。
- 生成二维码，用于手机 App 配对。
- 管理本机 Agent Host 的生命周期。

关键 VS Code API：

- `vscode.window.createTerminal`：创建或复用 VS Code 终端。
- `vscode.Pseudoterminal`：需要更强控制时，用自定义伪终端代理 Agent 的输入输出。
- `vscode.SecretStorage`：保存配对 token、设备密钥、Relay 凭据。
- `vscode.WebviewView`：显示连接状态、二维码、会话列表。
- `vscode.workspace`：读取 workspace、文件变更、配置。

插件不应该直接把所有终端字节原样暴露给 App。更稳妥的方式是引入 Agent Adapter，把不同 Agent 的输入输出规范化。

### 4.2 Agent Host

Agent Host 是运行在电脑端的本地服务，可以由 VS Code 插件内嵌启动，也可以作为独立 Node.js/Go/Rust 进程运行。

推荐第一版使用 Node.js：

- 与 VS Code 插件生态一致。
- WebSocket、PTY、JSON-RPC 实现简单。
- 方便封装 CLI Agent。

Agent Host 职责：

- 管理 Agent 进程生命周期。
- 维护会话状态和事件序列号。
- 处理输入输出流。
- 提供 HTTP/WebSocket API。
- 与 VS Code 插件通信。
- 与公网 Relay 建立反向连接。

本地接口建议：

- `GET /health`：健康检查。
- `GET /sessions`：会话列表。
- `POST /sessions`：创建 Agent 会话。
- `POST /sessions/{id}/input`：发送用户输入。
- `POST /sessions/{id}/control`：暂停、继续、终止、确认。
- `GET /sessions/{id}/events`：SSE 或 WebSocket 事件流。
- `WS /stream`：双向实时通道。

### 4.3 Backend Gateway / Relay

公网阶段需要独立后端服务。它不应该执行 Agent，也不应该直接访问本地文件系统，只负责安全通信和会话路由。

职责：

- 用户账号登录。
- 设备注册和配对。
- 电脑端 Agent Host 在线状态管理。
- App 与 Agent Host 的消息转发。
- 会话元数据存储。
- 审计日志。
- 限流和异常检测。
- 推送通知。

公网连接推荐使用 **反向 WebSocket 长连接**：

- 电脑端 Agent Host 主动连 Relay。
- Android App 主动连 Relay。
- Relay 根据 `userId/deviceId/sessionId` 路由消息。
- 不要求用户开放电脑端端口。

生产环境可以再升级为：

- gRPC streaming。
- MQTT over WebSocket。
- QUIC/WebTransport。
- 自建端到端加密信道。

### 4.4 Android App

Android App 是远程控制界面。

核心页面：

- 设备页：显示已配对电脑、在线状态、最近 workspace。
- 会话页：显示 Agent 会话列表、运行状态、耗时、最后输出。
- 控制台页：聊天式输入 + 终端输出 + 操作按钮。
- 文件变更页：展示 Agent 修改了哪些文件、diff 摘要、git 状态。
- 确认页：对执行 shell、写文件、安装依赖、提交 git 等高风险动作做二次确认。
- 设置页：Relay 地址、局域网扫描、通知、锁屏保护。

App 技术选型：

- Kotlin + Jetpack Compose。
- OkHttp WebSocket。
- Room 保存本地会话缓存。
- DataStore 保存配置。
- Firebase Cloud Messaging 或自建推送用于远程通知。
- Android Keystore 保存设备私钥和刷新 token。

## 5. Agent Adapter 设计

不要让 Android App 直接绑定 Claude Code 或 Codex 的终端输出格式。应该定义统一接口：

```ts
interface AgentAdapter {
  id: string;
  displayName: string;
  detect(): Promise<boolean>;
  start(options: StartAgentOptions): Promise<AgentSession>;
  sendInput(sessionId: string, input: AgentInput): Promise<void>;
  sendControl(sessionId: string, control: AgentControl): Promise<void>;
  stop(sessionId: string): Promise<void>;
}
```

统一事件模型：

```ts
type AgentEvent =
  | { type: "session_started"; sessionId: string; workspace: string }
  | { type: "stdout"; sessionId: string; text: string; seq: number }
  | { type: "stderr"; sessionId: string; text: string; seq: number }
  | { type: "assistant_message"; sessionId: string; text: string; seq: number }
  | { type: "tool_call"; sessionId: string; tool: string; args: unknown; seq: number }
  | { type: "approval_required"; sessionId: string; action: ApprovalAction; seq: number }
  | { type: "file_changed"; sessionId: string; path: string; changeType: string; seq: number }
  | { type: "session_finished"; sessionId: string; exitCode: number; seq: number };
```

适配策略：

- 如果 Agent 提供 SDK 或结构化输出，优先使用 SDK/JSON/SSE。
- 如果 Agent 只有 CLI，则用 PTY 包装，并尽量开启机器可读输出模式。
- 如果只能解析终端文本，则解析层必须隔离在对应 Adapter 内，不向上泄漏。
- 所有 Adapter 输出都转换成统一 `AgentEvent`。

Claude Code 可以优先研究官方 SDK/CLI 的 headless 或结构化能力；Codex 则优先按官方 Codex CLI/IDE 能力和当前可用命令封装。由于这类工具迭代很快，方案中应把具体命令行参数视为 Adapter 配置，而不是写死在 App 或 Gateway。

## 6. 通信协议

### 6.1 消息 envelope

所有 App、Gateway、Agent Host 之间的消息使用统一 envelope：

```json
{
  "id": "msg_01",
  "type": "agent.input",
  "sessionId": "sess_01",
  "deviceId": "android_01",
  "timestamp": "2026-06-30T14:30:00Z",
  "seq": 128,
  "payload": {}
}
```

字段说明：

- `id`：消息唯一 ID，用于幂等和追踪。
- `type`：消息类型。
- `sessionId`：目标 Agent 会话。
- `deviceId`：来源设备。
- `timestamp`：客户端生成时间。
- `seq`：会话内递增序号。
- `payload`：具体内容。

### 6.2 常用消息类型

App 到电脑端：

- `agent.start`
- `agent.input`
- `agent.control.pause`
- `agent.control.resume`
- `agent.control.stop`
- `approval.approve`
- `approval.deny`
- `workspace.status.request`

电脑端到 App：

- `agent.output`
- `agent.status`
- `approval.required`
- `workspace.status`
- `file.changed`
- `git.status`
- `error`

### 6.3 断线恢复

每个事件都有 `seq`。App 断线重连时发送最后收到的 `seq`：

```json
{
  "type": "session.resume",
  "sessionId": "sess_01",
  "lastSeq": 120
}
```

Agent Host 或 Gateway 从事件缓存中补发 `seq > 120` 的事件。缓存策略：

- 局域网 MVP：本机内存 + 文件落盘。
- 公网阶段：Gateway 存最近 N 条事件，完整日志由 Agent Host 本地保存。

## 7. 安全设计

这是整个系统最重要的部分。移动端控制 Agent 本质上等价于远程控制开发机和代码仓库。

### 7.1 配对流程

局域网配对：

1. VS Code 插件生成一次性配对 token。
2. 插件 Webview 显示二维码。
3. Android App 扫描二维码，获取电脑地址、设备公钥、一次性 token。
4. App 调用 `/pair`。
5. Agent Host 校验 token，登记 Android 设备公钥。
6. 后续请求使用短期 access token + 设备签名。

公网配对：

1. 用户在 VS Code 插件和 App 登录同一账号。
2. 插件向 Relay 注册电脑设备。
3. App 扫描插件二维码或输入配对码。
4. Relay 完成设备绑定。
5. 后续 App 控制请求必须经过用户账号、设备、会话三层授权。

### 7.2 权限模型

建议定义以下权限：

- `session.read`：查看会话输出。
- `session.input`：发送普通 prompt。
- `session.control`：暂停、继续、终止。
- `workspace.read`：查看 workspace 状态。
- `file.diff.read`：查看 diff。
- `approval.respond`：批准或拒绝高风险动作。
- `shell.execute`：允许执行 shell 命令。
- `git.write`：允许提交、rebase、push 等。

默认策略：

- App 可以查看和输入。
- 写文件、执行命令、安装依赖、git push、删除文件必须显式确认。
- 公网连接下默认更保守。

### 7.3 高风险操作确认

Agent Adapter 或 VS Code 插件应识别高风险操作：

- 执行 shell 命令。
- 安装依赖。
- 修改大量文件。
- 删除文件。
- 修改 `.env`、密钥、配置文件。
- git commit、push、reset、clean。
- 启动本地服务暴露端口。

确认事件示例：

```json
{
  "type": "approval.required",
  "payload": {
    "approvalId": "appr_01",
    "risk": "high",
    "action": "shell.execute",
    "summary": "npm install && npm run build",
    "timeoutSeconds": 300
  }
}
```

Android App 必须展示清楚：

- Agent 想做什么。
- 影响范围。
- 是否来自公网会话。
- 允许、拒绝、仅本次允许、终止会话。

### 7.4 网络安全

局域网：

- 默认只监听 `127.0.0.1`。
- 用户启用局域网模式后才监听 LAN IP。
- 必须使用配对 token。
- Token 有效期建议 5 分钟。
- 所有控制请求必须鉴权。

公网：

- 全链路 TLS。
- Access token 短期有效。
- Refresh token 存 Android Keystore。
- Relay 不保存 Agent 明文密钥。
- 敏感事件可做端到端加密。
- 后端必须有审计日志和限流。

## 8. 数据存储

### 8.1 本机 Agent Host

保存：

- 会话元数据。
- 最近事件日志。
- 已配对设备。
- Agent 配置。
- 工作区历史。

建议存储：

- SQLite：会话、事件、设备。
- 文件系统：长日志、大输出、附件。
- VS Code SecretStorage：密钥和 token。

### 8.2 Backend Gateway

保存：

- 用户。
- 设备。
- 设备在线状态。
- 会话索引。
- 审计日志。
- 推送 token。

不建议保存：

- 源代码全文。
- `.env` 内容。
- Agent API Key。
- 完整终端明文日志，除非用户明确开启。

## 9. 技术选型建议

### 9.1 VS Code 插件

- TypeScript。
- VS Code Extension API。
- WebviewView 显示连接状态和二维码。
- `node-pty` 或 VS Code Pseudoterminal 控制 CLI。
- `ws` 或原生 WebSocket 客户端连接 Agent Host/Relay。
- `zod` 校验消息协议。

### 9.2 Agent Host

MVP 推荐：

- Node.js + Fastify + WebSocket。
- SQLite。
- node-pty。

生产可选：

- Go：部署简单、并发强、单文件分发。
- Rust：安全性和性能更强，但开发成本更高。

### 9.3 Backend Gateway

推荐：

- Node.js/NestJS 或 Go。
- PostgreSQL。
- Redis 管理在线连接和临时事件。
- WebSocket Gateway。
- 对象存储保存可选日志附件。

### 9.4 Android App

- Kotlin。
- Jetpack Compose。
- OkHttp WebSocket。
- Room。
- DataStore。
- Android Keystore。
- FCM 或自建推送。

## 10. MVP 范围

第一版不要做太大，建议只实现以下能力：

1. VS Code 插件启动本地 Agent Host。
2. 插件显示二维码。
3. Android App 扫码配对。
4. App 查看一个 workspace 的会话。
5. App 创建一个 Agent 会话。
6. App 发送 prompt。
7. App 实时查看输出。
8. App 可以停止会话。
9. 插件/Host 记录最近事件，支持断线重连。
10. 支持一个 Agent，例如先支持 Codex 或 Claude Code 中的一个。

暂不做：

- 多用户组织权限。
- 完整文件浏览器。
- 复杂 diff 编辑。
- 多 Agent 协作。
- 公网 Relay。
- 端到端加密。
- 计费。

MVP 成功标准：

- 手机扫码后 30 秒内完成连接。
- App 发送 prompt 后 1 秒内能看到 Agent 开始响应。
- 断网重连后能恢复最近输出。
- 终止会话可靠生效。
- 未配对设备无法访问。

## 11. 公网扩展路线

在 MVP 稳定后增加：

1. 用户账号系统。
2. 电脑端设备注册。
3. Relay WebSocket 长连接。
4. App 远程连接 Relay。
5. 会话路由。
6. 设备在线状态。
7. 推送通知。
8. 审计日志。
9. 权限策略。
10. 高风险操作确认。

公网阶段推荐的连接拓扑：

```text
Agent Host --outbound WebSocket--> Relay <--WebSocket-- Android App
```

不要在第一版使用端口映射作为主方案。端口映射对普通用户不友好，也容易造成安全风险。

## 12. 关键风险与应对

### 12.1 Agent CLI 输出不稳定

风险：Claude Code、Codex 等 CLI 输出格式可能变化。

应对：

- 优先使用官方 SDK、JSON 输出或机器可读模式。
- 所有解析逻辑只放在 Agent Adapter 内。
- App 和 Gateway 只理解统一事件协议。

### 12.2 远程控制权限过大

风险：手机丢失或 token 泄露会导致开发机被远控。

应对：

- 设备级密钥。
- 短期 token。
- App 启动生物识别。
- 高风险操作二次确认。
- 可在 VS Code 插件中一键断开所有设备。

### 12.3 终端交互复杂

风险：CLI Agent 可能进入 vim、分页器、交互确认等复杂状态。

应对：

- MVP 限制为 prompt 输入和标准确认。
- Adapter 识别常见确认提示。
- 对复杂 TUI 状态提示用户回到电脑端处理。

### 12.4 公网 Relay 成本和安全

风险：长连接、日志、推送、鉴权都增加复杂度。

应对：

- Relay 只转发消息，不执行代码。
- 默认不保存明文输出。
- 使用 Redis 管理连接，不把大日志放 Redis。
- 为每个账号和设备限流。

## 13. 开发里程碑

### Milestone 1：本地闭环

- VS Code 插件启动 Agent Host。
- Host 能启动一个 Agent CLI。
- 插件可以看到输出。
- 本机 WebSocket 客户端可以发送输入。

### Milestone 2：Android 局域网控制

- 插件二维码配对。
- App 扫码连接。
- App 显示输出流。
- App 发送 prompt。
- App 停止会话。

### Milestone 3：会话可靠性

- 事件序号。
- 断线重连。
- 本地会话日志。
- 会话状态恢复。

### Milestone 4：安全增强

- 设备密钥。
- 短期 token。
- 高风险操作确认。
- 一键吊销设备。

### Milestone 5：公网 Relay

- 用户账号。
- 电脑端注册。
- App 远程连接。
- Relay 消息路由。
- 推送通知。
- 审计日志。

## 14. 推荐仓库结构

```text
repo/
  apps/
    android/
      app/
  packages/
    vscode-extension/
      src/
        extension.ts
        pairing/
        sessions/
        adapters/
          codexAdapter.ts
          claudeCodeAdapter.ts
        transport/
    agent-host/
      src/
        server.ts
        sessions/
        pty/
        adapters/
        storage/
        protocol/
    gateway/
      src/
        auth/
        devices/
        relay/
        sessions/
        audit/
  shared/
    protocol/
      messages.ts
      schemas.ts
  docs/
    agent-mobile-control-architecture.md
```

## 15. 参考资料

- VS Code Extension API：`vscode.window.createTerminal`、`Pseudoterminal`、`SecretStorage`、`WebviewView` 等能力见官方 API 文档：<https://code.visualstudio.com/api/references/vscode-api>
- VS Code Extension Webview 文档：<https://code.visualstudio.com/api/extension-guides/webview>
- Claude Code SDK 官方文档：<https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-overview>
- OpenAI Codex 官方入口：<https://developers.openai.com/codex>

## 16. 结论

推荐方案是：

1. **VS Code 插件负责 IDE 上下文和用户可见控制面。**
2. **本机 Agent Host 负责 Agent 进程、PTY、会话和协议转换。**
3. **Android App 负责移动端交互、确认和通知。**
4. **公网阶段增加 Relay，只做安全消息转发，不碰用户代码。**
5. **通过 Agent Adapter 层兼容 Claude Code、Codex 和其他 Agent。**

这个架构既能快速做出局域网可用版本，又能自然演进到公网远程控制，同时把安全风险、Agent 差异和移动端体验分别隔离在清晰的模块边界内。
