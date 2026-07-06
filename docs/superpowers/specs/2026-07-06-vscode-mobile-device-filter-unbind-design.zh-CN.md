# VS Code 移动设备过滤与解绑设计

**目标：** 让 VS Code 插件连接不再显示在移动设备列表中，并允许插件直接解绑已配对的移动设备。

**范围**

- VS Code 的“移动设备”面板只展示仍处于活跃状态的移动端客户端。
- 在不改变 host 端设备记录语义的前提下，将 `desktop-extension` 客户端从该面板隐藏。
- 已解绑设备不再以灰态保留，直接从该面板隐藏。
- 在插件界面中为可见的移动设备增加“解绑”操作。

**设计**

- host dashboard 继续作为完整设备状态的真实来源，但 VS Code webview 在渲染“移动设备”列表前先做过滤。
- 可见移动设备定义为 `android-app`、`ios-app`、`wechat-mini-program` 且 `revokedAt` 为空的记录。
- `desktop-extension` 记录继续保留在 host 状态中，避免影响桌面端配对与鉴权逻辑。
- webview 为每个可见设备行增加 `解绑` 按钮，并把选中的 `deviceId` 通过消息回传给扩展宿主。
- 本地 host client 增加 revoke 请求，调用 `POST /devices/:deviceId/revoke`。
- revoke 成功后立即刷新 dashboard，使该设备从过滤后的列表中消失。
- revoke 失败时复用现有控制台错误展示通道，不新增额外通知机制。

**测试**

- 为 webview 增加覆盖：验证 `desktop-extension` 被过滤、已解绑设备被隐藏，以及只有活跃移动设备会显示解绑按钮。
- 为 host client 增加覆盖：验证 revoke 请求路径与鉴权头行为。
- 视需要为扩展侧补充覆盖，确保解绑成功后通过现有刷新流程更新界面状态。
