# 本地局域网 MVP 开发指南

## 前置条件

- Node.js 24 或更高版本。
- npm 11 或更高版本。
- `codex` CLI 可在 `PATH` 中调用，或在 VS Code 设置中配置 `agentMobile.codexCommand`。
- 构建 Android App 需要 Android Studio 和 Android SDK 35。

本仓库包含 TypeScript Host 和 VS Code 插件构建。Android 源码位于 `android`。

## 安装

```powershell
npm install
```

## 构建和测试 TypeScript 包

```powershell
npm run build
npm run test
```

## 直接运行 Agent Host

```powershell
npm run build
npm run dev:host -- --host 127.0.0.1 --port 17365 --workspace E:\Code\code-agent-mobile --pairing-token pairing-token-123
```

Host 启动后会输出一条 JSON ready 消息，其中包含对外地址、端口、配对 token 和过期时间。

## VS Code 插件调试流程

1. 在 VS Code 中打开仓库根目录。
2. 执行 `npm install`。
3. 执行 `npm run build`。
4. 以 Extension Development Host 模式启动插件。
5. 打开 `Agent Mobile` Activity Bar 面板。
6. 执行 `Agent Mobile: Start Host` 启动本机 loopback 模式。
7. 执行 `Agent Mobile: Enable LAN Pairing` 将 Host 暴露到 `0.0.0.0`。
8. 在 Android App 中扫描二维码或粘贴配对 JSON。

## VS Code 插件打包

构建插件并生成 `.vsix`：

```powershell
npm run package:extension
```

生成文件位于 `vscode-extension`，名称类似：

```text
agent-mobile-control-0.1.0.vsix
```

安装到已有 VS Code：

```powershell
code --install-extension vscode-extension/agent-mobile-control-0.1.0.vsix
```

如果 `code` 命令不可用，在 VS Code 中运行 `Extensions: Install from VSIX...`，然后选择生成的 VSIX 文件。

安装后重载 VS Code，打开 `Agent Mobile` 面板，执行 `Agent Mobile: Start Host`。插件会通过 `agentMobile.codexCommand` 启动 `codex app-server`，而不是启动独立的交互式 `codex` CLI 会话。

## 插件配置

- `agentMobile.port`：默认 `17365`。
- `agentMobile.codexCommand`：默认 `codex`。
- `agentMobile.eventCacheSize`：默认 `500`。

## Android 调试流程

1. 在 Android Studio 中打开 `android`。
2. 构建并安装 app。
3. 确保手机和开发机在同一网络。
4. 在 VS Code 插件中启用 LAN Pairing。
5. 在 App 中扫描二维码或粘贴配对 JSON。
6. 连接后选择 Codex 会话并发送 prompt。

构建命令：

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

如果没有 Gradle wrapper，可使用本机 Gradle 或通过 Android Studio 生成 wrapper。

## 验证

常用验证命令：

```powershell
npm run build
npm run test
npm run test -w @agent-mobile/agent-host
npm run test -w agent-mobile-control
```

如果改动触及 Android 或 VS Code 插件，必须遵守根目录 `AGENTS.md` 中的强制重建规则。
