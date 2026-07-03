# Agent Mobile 各组件使用教程

本文档面向本地开发、联调和二次开发，按组件说明 `protocol`、`agent-host`、`vscode-extension`、`android`、`gateway` 的用途、启动方式、配置项和常见验证方法。

## 1. 组件总览

当前仓库由五个主要组件组成：

| 组件 | 路径 | 作用 | 什么时候使用 |
| --- | --- | --- | --- |
| 协议包 | `protocol` | 定义消息类型、配对数据、会话摘要、审批请求等共享类型和 Zod schema | 修改 App、Host、Gateway 的通信字段时 |
| Agent Host | `agent-host` | 本地 HTTP/WebSocket 服务，负责配对、会话管理、启动 Codex、转发输入输出 | 本地联调、VS Code 插件启动主机、Android 直连电脑 |
| VS Code 插件 | `vscode-extension` | 在 VS Code 侧启动/停止 Host，生成配对 JSON 和二维码，展示连接面板 | 推荐的电脑端入口 |
| Android App | `android` | 手机端界面，扫码或粘贴配对 JSON，创建会话、发送 Prompt、查看输出、处理审批 | 手机控制 Agent 会话 |
| Gateway/Relay | `gateway` | 可选的 WebSocket 中继，把 Host 和 App 的消息按 `hostId` 转发 | 不在同一局域网、验证远程 Relay 链路时 |

最常用的 MVP 链路是：

```text
VS Code 插件 -> 启动 Agent Host -> Android App 扫码配对 -> 创建 Codex 会话 -> 发送 Prompt -> WebSocket 接收输出
```

可选远程链路是：

```text
Agent Host --WebSocket--> Gateway/Relay <--WebSocket-- Android App
```

## 2. 环境准备

### 2.1 Node.js 工作区

根目录是 npm workspace，包含 `protocol`、`agent-host`、`gateway`、`vscode-extension`。

```powershell
npm install
npm run build
npm run test
```

常用脚本：

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 构建所有 workspace |
| `npm run test` | 运行所有 TypeScript 测试 |
| `npm run dev:host` | 以源码模式启动 Agent Host |
| `npm run dev:gateway` | 以源码模式启动 Gateway |
| `npm run package:extension` | 打包 VS Code 插件 VSIX |

### 2.2 Codex CLI

Agent Host 当前真实接入的是 Codex，启动会话时会执行：

```powershell
codex app-server --listen stdio://
```

请确保 `codex` 命令可在 `PATH` 中直接调用。若命令名或路径不同，可以在 VS Code 设置里修改 `agentMobile.codexCommand`，或启动 Host 时使用 `--codex-command`。

### 2.3 Android 环境

Android App 使用 Kotlin、Jetpack Compose、OkHttp、CameraX、ZXing。

要求：

- Android Studio 可用。
- Android SDK 35 可用。
- JDK 17 可用。
- 手机和开发机处于同一 Wi-Fi，或使用可访问开发机 IP 的网络。

构建命令：

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

如果仓库里还没有 Gradle Wrapper，可让 Android Studio 创建，或本地执行：

```powershell
gradle wrapper --gradle-version 8.10.2
```

## 3. 协议包 protocol

路径：`protocol`

协议包提供所有端共享的 TypeScript 类型和运行时校验：

- `Envelope`：所有跨端消息的统一外壳。
- `PairingPayload`：二维码或粘贴配对 JSON 的格式。
- `SessionSummary`：会话列表和当前会话状态。
- `HostDashboardStatus`：VS Code 插件面板展示的 Host 状态。
- `ApprovalRequest`：高风险操作审批请求。
- `AgentEvent`：Agent 输出、会话完成、文件变化等事件模型。

### 3.1 构建与测试

```powershell
npm run build -w @agent-mobile/protocol
npm run test -w @agent-mobile/protocol
```

### 3.2 配对 JSON 格式

VS Code 插件和 Agent Host 生成的配对数据形如：

```json
{
  "host": "192.168.1.10",
  "port": 17365,
  "pairingToken": "pair_0123456789abcdef",
  "deviceName": "VS Code",
  "expiresAt": "2026-07-02T10:00:00.000Z"
}
```

Android App 会读取 `host`、`port`、`pairingToken`，调用 Host 的 `/pair` 接口换取 `accessToken`。

### 3.3 修改协议的注意事项

修改协议字段时，建议按这个顺序联动：

1. 修改 `protocol/src/index.ts` 的 schema 和导出类型。
2. 更新 `agent-host` 或 `gateway` 的请求解析逻辑。
3. 更新 Android 侧 `model` 和 `net` 解析逻辑。
4. 运行 `npm run test`，再运行 Android 单元测试。

## 4. Agent Host

路径：`agent-host`

Agent Host 是本地控制服务，默认监听 `127.0.0.1:17365`。它负责：

- 校验一次性配对 token。
- 颁发短期 `accessToken`。
- 创建、停止 Codex 会话。
- 接收 Android 输入并写入 Agent。
- 缓存事件并通过 WebSocket 推送输出。
- 保存最近会话、事件和审批状态。
- 可选连接 Gateway/Relay。

### 4.1 直接启动

在仓库根目录执行：

```powershell
npm run build
npm run dev:host -- --host 127.0.0.1 --port 17365 --workspace E:\Code\code-agent-mobile --pairing-token pairing-token-123
```

启动成功后会输出：

```json
{
  "type": "agent-mobile.ready",
  "host": "127.0.0.1",
  "port": 17365,
  "pairingToken": "pairing-token-123",
  "expiresAt": "..."
}
```

### 4.2 局域网模式

Android 真机要访问电脑时，Host 需要监听 `0.0.0.0`：

```powershell
npm run dev:host -- --host 0.0.0.0 --port 17365 --workspace E:\Code\code-agent-mobile
```

Host 会自动把输出里的 `host` 改为第一块局域网 IPv4 地址。防火墙如果拦截端口 `17365`，需要允许当前 Node.js 进程的局域网访问。

### 4.3 常用启动参数

| 参数/环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `--host` / `AGENT_MOBILE_HOST` | `127.0.0.1` | 监听地址。局域网联调用 `0.0.0.0` |
| `--port` / `AGENT_MOBILE_PORT` | `17365` | Host HTTP/WebSocket 端口 |
| `--workspace` | 当前目录 | Codex 会话工作目录 |
| `--codex-command` | `codex` | Codex CLI 命令 |
| `--event-cache-size` | `500` | 内存事件缓存条数 |
| `--pairing-token` | 自动生成 | 一次性配对 token |
| `--relay-url` / `AGENT_MOBILE_RELAY_URL` | 无 | Relay 地址，例如 `ws://127.0.0.1:17366` |
| `--relay-host-id` / `AGENT_MOBILE_RELAY_HOST_ID` | 无 | Relay 路由使用的主机 ID |
| `--relay-token` / `AGENT_MOBILE_RELAY_TOKEN` | 无 | Relay 鉴权 token |

### 4.4 HTTP 接口

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/health` | 无 | 健康检查 |
| `POST` | `/pair` | `pairingToken` | 用配对 token 换 `accessToken` |
| `GET` | `/status` | Pairing token 或 Bearer token | Host 面板状态 |
| `GET` | `/devices` | Bearer token | 已配对设备 |
| `POST` | `/devices/:deviceId/revoke` | Bearer token | 撤销设备 |
| `GET` | `/sessions` | Bearer token | 会话列表 |
| `POST` | `/sessions` | Bearer token | 创建 Codex 会话 |
| `POST` | `/sessions/:id/input` | Bearer token | 发送 Prompt |
| `POST` | `/sessions/:id/control` | Bearer token | 停止会话，当前支持 `{"command":"stop"}` |
| `GET` | `/approvals` | Bearer token | 待处理审批 |
| `POST` | `/approvals/:approvalId/respond` | Bearer token | 审批通过或拒绝 |
| `WS` | `/stream?token=...&lastSeq=0` | access token | 实时事件流 |

### 4.5 curl 快速验证

启动 Host 后，先检查健康状态：

```powershell
curl http://127.0.0.1:17365/health
```

配对：

```powershell
curl -Method POST http://127.0.0.1:17365/pair `
  -ContentType "application/json" `
  -Body '{"pairingToken":"pairing-token-123","deviceId":"dev-phone-1","clientType":"android-app"}'
```

拿到 `accessToken` 后创建会话：

```powershell
curl -Method POST http://127.0.0.1:17365/sessions `
  -Headers @{ Authorization = "Bearer <accessToken>" } `
  -ContentType "application/json" `
  -Body '{}'
```

发送输入：

```powershell
curl -Method POST http://127.0.0.1:17365/sessions/<sessionId>/input `
  -Headers @{ Authorization = "Bearer <accessToken>" } `
  -ContentType "application/json" `
  -Body '{"text":"请介绍一下当前项目"}'
```

## 5. VS Code 插件

路径：`vscode-extension`

VS Code 插件是推荐的电脑端入口。它会：

- 在 Activity Bar 添加 `Agent Mobile` 面板。
- 启动或停止本地 Agent Host。
- 生成一次性配对 token。
- 显示二维码和配对 JSON。
- 切换 loopback 和 LAN 配对模式。
- 定时刷新 Host 状态、设备、会话、Agent 能力。

### 5.1 开发调试流程

1. 在 VS Code 打开仓库根目录。
2. 执行：

```powershell
npm install
npm run build
```

3. 在 VS Code 里以 Extension Development Host 方式启动插件。
4. 打开 Activity Bar 中的 `Agent Mobile`。
5. 执行命令 `Agent Mobile: 启动主机`。
6. 如果要让 Android 真机连接，执行 `Agent Mobile: 启用局域网配对`。
7. 用 Android App 扫描二维码，或复制配对 JSON 粘贴到 App。

### 5.2 打包与安装

```powershell
npm run package:extension
```

产物位于 `vscode-extension`，文件名类似：

```text
agent-mobile-control-0.1.0.vsix
```

安装：

```powershell
code --install-extension vscode-extension/agent-mobile-control-0.1.0.vsix
```

如果 `code` 命令不可用，可以在 VS Code 中执行 `Extensions: Install from VSIX...`，选择该 VSIX 文件。

### 5.3 插件命令

| 命令 | 作用 |
| --- | --- |
| `Agent Mobile: 启动主机` | 以当前配置启动 Host |
| `Agent Mobile: 停止主机` | 停止 Host |
| `Agent Mobile: 启用局域网配对` | Host 监听 `0.0.0.0`，二维码使用局域网 IP |
| `Agent Mobile: 停用局域网配对` | Host 回到 `127.0.0.1` |
| `Agent Mobile: 复制配对 JSON` | 复制当前二维码对应的 JSON |

### 5.4 插件配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `agentMobile.port` | `17365` | Host 监听端口 |
| `agentMobile.codexCommand` | `codex` | Codex CLI 命令 |
| `agentMobile.eventCacheSize` | `500` | Host 事件缓存条数 |

### 5.5 常见问题

- App 扫码后连接失败：确认已启用局域网配对，而不是只启动了 loopback 模式。
- 二维码过期：重新执行启动主机或启用局域网配对，生成新的配对 token。
- 找不到 Codex：检查 `agentMobile.codexCommand`，或在终端执行 `codex --version` 验证命令可用。
- 端口占用：修改 `agentMobile.port`，然后重新启动 Host。

## 6. Android App

路径：`android`

Android App 是移动端控制台，目前提供：

- 扫描二维码。
- 粘贴配对 JSON。
- 与 Host 配对并保存连接状态。
- 创建 Codex 会话。
- 发送 Prompt。
- 查看事件输出流。
- 停止当前会话。
- 查看并处理审批请求。

### 6.1 构建安装

使用 Android Studio 打开 `android` 目录，等待 Gradle 同步完成，然后运行 `app`。

命令行构建：

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

安装到已连接设备：

```powershell
.\gradlew.bat :app:installDebug
```

### 6.2 连接 Host

推荐流程：

1. 手机和电脑连接同一 Wi-Fi。
2. VS Code 插件执行 `Agent Mobile: 启用局域网配对`。
3. 打开 Android App。
4. 点击 `Scan QR` 扫描插件面板二维码。
5. 如果扫码不可用，点击 `复制配对 JSON`，手动粘贴到 App 的 `Pairing JSON` 输入框。
6. 点击 `Connect`。

连接成功后，App 会显示：

```text
Connected to <host>:<port>
Session: none (not started)
```

### 6.3 创建并控制会话

连接成功后：

1. 点击 `Create session`。
2. 等待状态变为 `running`。
3. 在 `Prompt` 输入框输入内容。
4. 点击 `Send`。
5. 输出会按事件序号显示在列表中。
6. 如需结束会话，点击 `Stop`。

### 6.4 App 调用的接口

Android 侧 `AgentMobileClient` 调用以下接口：

| App 操作 | Host 接口 |
| --- | --- |
| 配对 | `POST /pair` |
| 列出会话 | `GET /sessions` |
| 创建会话 | `POST /sessions` |
| 发送输入 | `POST /sessions/:id/input` |
| 停止会话 | `POST /sessions/:id/control` |
| 列出审批 | `GET /approvals` |
| 处理审批 | `POST /approvals/:approvalId/respond` |
| 列出设备 | `GET /devices` |
| 撤销设备 | `POST /devices/:deviceId/revoke` |
| 事件流 | `WS /stream?token=...&lastSeq=...` |

### 6.5 Android 常见问题

- 扫码后无响应：确认二维码内容是完整 JSON，且 `expiresAt` 未过期。
- 连接失败：确认手机能访问电脑局域网 IP，Windows 防火墙允许 Node.js 监听端口。
- 创建会话失败：确认电脑端 Codex CLI 可运行，并且 Host 的工作目录有效。
- 输出中断：重新进入 App 或重新连接时，`lastSeq` 用于补发未收到的事件；若 Host 已重启，内存 token 会失效，需要重新配对。

## 7. Gateway / Relay

路径：`gateway`

Gateway 是可选中继服务。它不执行 Agent，也不访问本地文件，只按 `hostId` 把 WebSocket 消息在 Host 和 App 之间转发。

### 7.1 启动 Gateway

```powershell
npm run dev:gateway -- --host 127.0.0.1 --port 17366 --relay-token dev-relay-token
```

启动成功后输出：

```json
{
  "type": "agent-mobile.gateway.ready",
  "host": "127.0.0.1",
  "port": 17366
}
```

### 7.2 Gateway 参数

| 参数/环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `--host` / `AGENT_MOBILE_GATEWAY_HOST` | `127.0.0.1` | Gateway 监听地址 |
| `--port` / `AGENT_MOBILE_GATEWAY_PORT` | `17366` | Gateway 端口 |
| `--relay-token` / `AGENT_MOBILE_RELAY_TOKEN` | `dev-relay-token` | Host 和 App 连接 Gateway 的共享 token |

### 7.3 Host 连接 Relay

启动 Host 时添加 Relay 参数：

```powershell
npm run dev:host -- `
  --host 127.0.0.1 `
  --port 17365 `
  --workspace E:\Code\code-agent-mobile `
  --relay-url ws://127.0.0.1:17366 `
  --relay-host-id dev-host-1 `
  --relay-token dev-relay-token
```

Host 会连接：

```text
ws://127.0.0.1:17366/host?hostId=dev-host-1&token=dev-relay-token
```

### 7.4 App 连接 Relay 的消息格式

Gateway 侧为 App 暴露：

```text
ws://127.0.0.1:17366/app?hostId=dev-host-1&token=dev-relay-token
```

通过 Relay 发给 Host 的消息仍使用 `Envelope`。例如创建会话：

```json
{
  "id": "msg_1",
  "type": "agent.start",
  "deviceId": "android-dev",
  "timestamp": "2026-07-02T10:00:00.000Z",
  "seq": 0,
  "payload": {}
}
```

发送输入：

```json
{
  "id": "msg_2",
  "type": "agent.input",
  "sessionId": "sess_demo123",
  "deviceId": "android-dev",
  "timestamp": "2026-07-02T10:00:10.000Z",
  "seq": 1,
  "payload": {
    "text": "继续完成当前任务"
  }
}
```

停止会话：

```json
{
  "id": "msg_3",
  "type": "agent.control.stop",
  "sessionId": "sess_demo123",
  "deviceId": "android-dev",
  "timestamp": "2026-07-02T10:01:00.000Z",
  "seq": 2,
  "payload": {}
}
```

当前 Android App 的主要流程仍是局域网直连 Host；Relay 链路适合开发者用 WebSocket 客户端或后续 App 远程模式进行验证。

## 8. 端到端局域网联调流程

这是当前最推荐、最稳定的使用路径。

1. 安装依赖并构建：

```powershell
npm install
npm run build
```

2. 确认 Codex 可用：

```powershell
codex --version
```

3. 打开 VS Code 插件面板。

4. 执行 `Agent Mobile: 启用局域网配对`。

5. Android Studio 安装并打开 App。

6. 扫描插件二维码或粘贴配对 JSON。

7. 在 App 中点击 `Create session`。

8. 输入 Prompt 并点击 `Send`。

9. 在 App 输出区域查看 Codex 响应。

10. 点击 `Stop` 结束会话。

## 9. 开发者常用验证命令

### 9.1 TypeScript 构建与测试

```powershell
npm run build
npm run test
```

### 9.2 单独测试 Host

```powershell
npm run test -w @agent-mobile/agent-host
```

### 9.3 单独测试 Gateway

```powershell
npm run test -w @agent-mobile/gateway
```

### 9.4 单独测试 VS Code 插件

```powershell
npm run test -w agent-mobile-control
```

### 9.5 Android 单元测试

```powershell
cd android
.\gradlew.bat test
```

## 10. 故障排查清单

| 现象 | 优先检查 |
| --- | --- |
| App 无法配对 | 配对 token 是否过期；Host 是否为 LAN 模式；手机是否能访问电脑 IP |
| `/pair` 返回 401 | `pairingToken` 不匹配或已过期 |
| 其他接口返回 401 | `Authorization: Bearer <accessToken>` 缺失、过期或设备已撤销 |
| App 连接 WebSocket 被关闭 | `/stream` query 中的 `token` 无效 |
| 创建会话失败 | `codex` 命令是否可用；workspace 是否存在；Host 日志是否有启动错误 |
| 手机访问不到电脑 | Windows 防火墙、Wi-Fi 隔离、VPN、端口占用 |
| VS Code 面板没有二维码 | 先启动主机或启用局域网配对 |
| Relay 无法转发 | Host 和 App 的 `hostId` 是否相同；`relay-token` 是否一致 |

## 11. 二次开发建议

- 新增消息字段时，先改 `protocol`，再改 Host、App、Gateway。
- 新增 Agent 时，实现 `AgentAdapter`，让 App 继续只理解统一会话和事件模型。
- 涉及高风险动作时，优先走 `ApprovalRequest`，不要让 App 直接执行本地命令。
- 局域网模式只在用户显式启用时监听 `0.0.0.0`。
- 当前 token 和会话主要面向 MVP；如果要长期使用，应补持久化设备授权、短期 access token 刷新和更完整的审计日志。
