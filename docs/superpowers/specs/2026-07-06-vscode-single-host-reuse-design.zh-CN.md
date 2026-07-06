# VS Code 单 Host 复用设计

**目标：** 让同一台电脑只运行一个 `agent-host` 实例，并由所有 VS Code 窗口自动复用。

**范围**

- 发现本地已有 host 时直接复用，而不是再启动第二个进程。
- 在多个 VS Code 窗口之间自动同步 host 状态和 session 列表。
- 选中的 session 与控制台输出仍保持为窗口本地 UI 状态。

**设计**

- 将本地 host 作为配对状态、局域网模式和 sessions 的唯一真源。
- 扩展启动后和定时刷新时，探测 `127.0.0.1:<port>/status`。
- 如果 host 可达，就使用返回的 dashboard 数据更新 webview 状态，并复用已有 pairing token，而不是重新生成新的 token。
- 如果 host 不可达，点击启动时仍按现有方式启动本地 `agent-host` 进程。
- 增加一个 host stop 接口，使任意窗口在发现共享 pairing token 后都可以干净地停止单例 host。
- 允许 `/status` 在 loopback 本地访问时免认证，这样其他本地 VS Code 窗口无需预先知道 pairing token 也能发现并复用共享 host。

**测试**

- 为仅限 loopback 的本地状态发现和远程 stop 请求补充 server 测试。
- 为复用已有 host 而不是重新 spawn 的逻辑补充扩展或 controller 测试。
- 为刷新时按 dashboard 自动同步状态补充扩展测试。
