# Code Agent Mobile

Code Agent Mobile 是一个以局域网优先的智能编码代理控制方案。它把 VS Code 插件、本地主机服务和 Android 应用连接起来，让你可以在电脑运行代理时，直接通过手机查看会话、发送提示词并处理审批。

## 仓库内容

- `protocol`：桌面端与移动端共用的协议 Schema 和 TypeScript 类型。
- `agent-host`：本地 HTTP 与 WebSocket 主机服务，负责配对、会话管理和代理适配。
- `vscode-extension`：用于启动 Host，并提供配对与控制界面的 VS Code 插件。
- `android`：Android 客户端，用于配对、浏览会话、接收流式输出和远程输入。
- `gateway`：用于自建公网连接的可选 WebSocket 中继服务。
- `docs`：架构说明、本地 MVP 搭建文档和组件级使用文档。

## 当前范围

项目采用局域网优先的方式，桌面端与 Android 应用之间的本地配对仍是默认工作流。

- VS Code 插件负责启动本地主机服务。
- Android 应用通过二维码或配对 JSON 完成连接。
- 目前重点集成的编码代理路径是 Codex。
- 可通过自建公网中继实现远程连接；配置方式见[公网中继指南](docs/public-relay.zh-CN.md)。

## 前置要求

- Node.js 24 或更高版本
- npm 11 或更高版本
- `PATH` 中可直接使用 Codex CLI，或在 VS Code 里通过 `agentMobile.codexCommand` 指定自定义命令
- 用于构建 Android 应用的 Android Studio 和 Android SDK 35

## 快速开始

安装依赖：

```powershell
npm install
```

构建全部 TypeScript 工作区：

```powershell
npm run build
```

运行测试：

```powershell
npm run test
```

直接运行本地主机：

```powershell
npm run dev:host -- --host 127.0.0.1 --port 17365 --workspace E:\Code\code-agent-mobile --pairing-token pairing-token-123
```

## VS Code 插件打包

将插件构建并打包为 VSIX：

```powershell
npm run package:extension
```

产物会生成在 `vscode-extension/` 目录下。

## Android 构建

在 `android` 目录下执行调试包构建：

```powershell
.\gradlew.bat :app:assembleDebug
```

APK 通常会输出到 `android/app/build/outputs/apk/debug/`。

## 公网中继

可选的 Gateway 在不直接将 Host 暴露到互联网的前提下，转发 Agent Host 与 Android 应用之间的 WebSocket 流量。它支持共享的静态中继 token，也支持绑定到特定 `hostId` 的通道 token；请按[组件使用指南](docs/component-usage-guide.zh-CN.md)启动中继并配置 Host 与配对数据。

## 开发流程

1. 在 VS Code 中打开本仓库。
2. 运行 `npm install`。
3. 运行 `npm run build`。
4. 以扩展开发模式启动 VS Code 插件。
5. 在 `Agent Mobile` 视图中启动 Host 并启用局域网配对。
6. 在 Android 应用中扫描二维码或粘贴配对 JSON 完成连接。

## 相关文档

- 本地 MVP 搭建说明：[docs/dev-local-mvp.zh-CN.md](docs/dev-local-mvp.zh-CN.md)
- 架构总览：[docs/agent-mobile-control-architecture.md](docs/agent-mobile-control-architecture.md)
- 组件使用指南：[docs/component-usage-guide.zh-CN.md](docs/component-usage-guide.zh-CN.md)
- 公网中继指南：[docs/public-relay.zh-CN.md](docs/public-relay.zh-CN.md)

## 许可证

Apache-2.0
