# Agent Mobile 组件使用指南

本文档说明仓库各组件的用途、本地运行方式，以及常见开发流程的验证方法。

## 1. 组件

| 组件 | 路径 | 用途 | 什么时候使用 |
| --- | --- | --- | --- |
| 协议包 | `protocol` | 共享消息类型、配对载荷、会话摘要、审批请求和 Zod schema | 修改跨组件 API 字段时 |
| Agent Host | `agent-host` | 本地 HTTP/WebSocket 服务，负责配对、会话管理、启动 Codex、转发输入输出 | 本地联调、VS Code 插件主机、Android 直连 |
| VS Code 插件 | `vscode-extension` | 启停 Host，显示配对 JSON/二维码，展示状态和 Codex 会话 | 推荐的桌面端入口 |
| Android App | `android` | 移动端配对、会话控制、Prompt 输入、输出查看和审批处理 | 手机端控制界面 |
| Gateway / Relay | `gateway` | 可选的按 `hostId` 转发的 WebSocket 中继 | 远程访问或中继链路验证 |

最常见的本地开发链路是：

```text
VS Code 插件 -> Agent Host -> Android App -> Codex 会话 -> WebSocket 输出
```

## 2. 环境准备

安装 Node 依赖，并构建/测试所有 TypeScript workspace：

```powershell
npm install
npm run build
npm run test
```

`codex` 必须在 `PATH` 中可用，或通过 `agentMobile.codexCommand` 配置。

Agent Host 会用以下命令启动 Codex：

```powershell
codex app-server --listen stdio://
```

## 3. 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 构建所有 workspace |
| `npm run test` | 运行所有 TypeScript 测试 |
| `npm run dev:host` | 从源码运行 Agent Host |
| `npm run dev:gateway` | 从源码运行 Gateway |
| `npm run package:extension` | 构建 VS Code 插件 VSIX |

## 4. Agent Host

直接运行 Host：

```powershell
npm run build
npm run dev:host -- --host 127.0.0.1 --port 17365 --workspace E:\Code\code-agent-mobile --pairing-token pairing-token-123
```

局域网模式：

```powershell
npm run dev:host -- --host 0.0.0.0 --port 17365 --workspace E:\Code\code-agent-mobile
```

常用 API：

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| `GET` | `/health` | 无 | 健康检查 |
| `POST` | `/pair` | 配对 token | 将配对 token 换成访问 token |
| `GET` | `/status` | 配对 token 或 Bearer token | 仪表盘状态 |
| `GET` | `/sessions` | Bearer token | 列出会话 |
| `POST` | `/sessions/:id/attach` | Bearer token | 恢复已发现的 Codex 线程并流式返回历史 |
| `POST` | `/sessions/:id/input` | Bearer token | 发送 Prompt 文本 |
| `POST` | `/sessions/:id/control` | Bearer token | 停止会话 |
| `GET` | `/stream` | 查询参数中的 access token | 事件流 |

## 5. VS Code 插件

开发流程：

1. 在 VS Code 中打开仓库根目录。
2. 运行 `npm install`。
3. 运行 `npm run build`。
4. 启动 Extension Development Host。
5. 打开 `Agent Mobile` Activity Bar 视图。
6. 运行 `Agent Mobile: Start Host` 或 `Agent Mobile: Enable LAN Pairing`。
7. 使用二维码或配对 JSON 配对移动端客户端。

打包插件：

```powershell
npm run package:extension
```

安装生成的 VSIX：

```powershell
code --install-extension vscode-extension/agent-mobile-control-0.2.0.vsix
```

## 6. Android App

使用 Android Studio 或 Gradle 构建应用：

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

如果仓库中没有 Gradle wrapper，请使用本机 Gradle 安装，或生成 wrapper。

## 7. Gateway / Relay

可选的 Gateway 可在不暴露 Agent Host HTTP 端口的前提下，让 Android 通过公网访问。请将它部署在 TLS 反向代理之后，并将 `/host` 和 `/app` 的 WebSocket Upgrade 转发给 Gateway。Android 配对只接受具有有效证书的 `wss://` 端点。

使用按主机绑定的通道 token 运行 Gateway：

```powershell
npm run dev:gateway -- --host 0.0.0.0 --port 17366
```

或者传入 `--relay-token <唯一密钥>`，为所有通道使用同一个静态 token。默认模式会将第一个 Host 的 token 绑定到其 `hostId`。

启动 Host 前，请在 VS Code 插件中配置唯一的主机 ID 和 token：

```json
{
  "agentMobile.relayUrl": "wss://relay.example.com",
  "agentMobile.relayHostId": "host_8c02d1f5b2c84a58",
  "agentMobile.relayToken": "replace-with-a-unique-secret-at-least-16-characters"
}
```

Host 会建立出站中继连接，并将中继字段写入二维码和配对 JSON。请不要暴露本地 Host 端口。部署细节和安全注意事项见[公网中继连接](public-relay.zh-CN.md)。

## 8. 验证

提交前运行相关检查：

```powershell
npm run build
npm run test
```

如果改动涉及 Android，请遵循根目录 `AGENTS.md` 的重建规则并运行 Android 应用构建。

如果改动涉及 VS Code 插件，请运行：

```powershell
npm run package:extension
```
