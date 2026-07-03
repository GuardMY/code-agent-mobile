# VS Code 连接仪表盘设计

## 目标

为 VS Code 插件增加连接仪表盘，展示本地 Agent Host、已配对移动客户端和桌面 Agent 后端的状态。首次使用时，仪表盘应突出二维码/配对 JSON；配对后，它继续作为状态面板使用。

## 选定方案

使用 Host 聚合状态接口：

```text
GET /status
```

VS Code Webview 周期性拉取该接口并渲染状态。第一版使用轮询而不是 WebSocket，以降低实现复杂度，并保持测试简单。未来可在不改变状态模型的前提下替换为订阅。

## 信息模型

`/status` 返回：

- `server`：Host 是否运行、监听地址、端口、设备名、版本。
- `pairing`：配对是否可用、过期时间、配对 payload。
- `devices`：已配对设备列表，包含客户端类型、配对时间、token 过期时间和撤销状态。
- `agents`：Codex、Claude Code、OpenCode 的能力状态和活跃 session 数。
- `sessions`：当前 Host 认识的 session 摘要。

## Webview 行为

- Host 未启动：显示 stopped 状态和启动入口。
- Host 启动中：显示 starting 状态。
- Host 运行中：显示 server、pairing、devices、agents、sessions。
- 无设备时：提示扫描二维码连接第一台移动设备。
- 有设备时：展示设备状态，并保留添加设备入口。
- Host 不可达：显示错误信息和刷新按钮。

## UI 原则

- 保留单个 `agentMobile.pairingView` Webview。
- 使用 VS Code 主题变量，避免自定义品牌色破坏编辑器环境。
- 信息密度适中，适合侧边栏窄面板。
- 按服务、配对、设备、Agent、会话分组。
- 所有控制按钮使用明确动作文案。

## 测试

- 协议测试验证 dashboard status schema。
- Host 测试验证 `/status` 返回完整结构。
- Webview 测试验证：
  - 不加载远程脚本。
  - 渲染 first-time pairing 状态。
  - 渲染 Android 和微信小程序设备标签。
  - 渲染 Codex、Claude Code、OpenCode 能力状态。
  - 渲染 session 摘要。

## 非目标

- 不在第一版加入完整会话控制台。
- 不实现远程 Relay 状态配置 UI。
- 不实现设备 token 刷新流程。
- 不实现 Claude Code 或 OpenCode adapter。
