# VS Code SecretStorage 设备持久化设计

## 目标

让已经配对过的移动设备在 VS Code 插件、VS Code 窗口或 Agent Host 进程重启后仍然有效。配对信任关系由 VS Code 插件持久化保存，运行期短期 `accessToken` 仍然由 Agent Host 负责签发。

## 范围

本设计覆盖：

- 在 VS Code 插件中通过 `SecretStorage` 持久化已配对设备信任关系
- Host 启动时恢复运行期设备状态
- 已配对移动设备无需重新扫码即可重新认证
- 在 VS Code 面板中解绑已持久化设备

本设计不覆盖：

- 脱离 VS Code 插件的电脑级持久化
- Relay 或非局域网连接
- 局域网链路的端到端 TLS

## 需求

- 移动设备首次成功配对后，在用户手动解绑前都应保持受信任状态。
- 重启 VS Code 插件、VS Code 窗口或 Agent Host 后，不应要求重新配对。
- 运行期 `accessToken` 必须保持短生命周期/内存态，不能作为长期信任锚点。
- 已解绑设备后续重新认证必须失败，除非再次重新配对。
- 面板在重启后仍应展示已持久化保存的配对设备列表。

## 选定方案

在 `vscode.SecretStorage` 中持久化已配对设备信任关系，并由 VS Code 插件在 Host 启动时把这些信任关系重新注入 Agent Host。

Host 仍然是运行期授权服务：

- 校验首次 `/pair` 请求中的配对 token
- 在首次配对时为设备生成长期 `deviceSecret`
- 校验已配对设备的重新认证请求
- 在重新认证成功后签发新的短期 `accessToken`

插件成为受信任设备注册表的事实来源：

- 负责把设备记录写入 `SecretStorage`
- 在启动时恢复并回灌 Host 状态
- 在用户从面板解绑设备时删除持久化记录

## 为什么选这个方案

这个方案符合当前已确认的产品方向：

- 插件重启和 Host 重启后，设备信任关系仍然存在
- 持久化保留在 VS Code 插件内部，不额外引入独立 Host 本地存储层
- `accessToken` 继续保持短期有效，比长期 token 更安全
- 当前局域网扫码配对主流程基本不变，只是为后续重连增加重新认证路径

权衡点：

- 如果用户清空 VS Code 扩展密钥存储，所有已记住设备都会失效
- 如果未来需要脱离插件单独运行 Host，这套方案不够自然

## 数据模型

### 持久化设备记录

在 `SecretStorage` 中使用稳定 key，例如 `agentMobile.pairedDevices`，保存 JSON 数组。

每条记录包含：

- `deviceId: string`
- `clientType: "android-app" | "ios-app" | "wechat-mini-program" | "desktop-extension" | "unknown"`
- `displayName?: string`
- `pairedAt: string`
- `revokedAt?: string`
- `deviceSecretHash: string`
- `lastSeenAt?: string`

### Host 运行期状态

Host 在内存中维护两类映射：

- 按 `deviceId` 建立的受信任设备表
- 按 `accessToken` 建立的运行期访问令牌表

受信任设备由插件在 Host 启动时加载进来，并在新设备配对或设备解绑时同步更新。

## API 变更

### `POST /pair`

当前行为：

- 校验 pairing token
- 返回 `accessToken`

新行为：

- 校验 pairing token
- 创建或更新受信任设备记录
- 首次成功配对时生成设备级长期 `deviceSecret`
- Host 内存和插件持久化都只保存其哈希值
- 返回：
  - `accessToken`
  - `deviceId`
  - 首次配对时返回 `deviceSecret`

如果同一设备再次通过一次性 pairing token 配对，Host 可以轮换 `deviceSecret` 并覆盖持久化记录，保证行为可预测。

### `POST /devices/reauth`

为已配对设备新增重新认证接口。

请求体：

- `deviceId`
- `deviceSecret`

行为：

- 按 `deviceId` 查找受信任设备
- 如果不存在或已解绑则拒绝
- 将请求中的 secret 与 `deviceSecretHash` 比较
- 校验成功后签发新的运行期 `accessToken`
- 更新 `lastSeenAt`

返回：

- `accessToken`

### `POST /devices/:deviceId/revoke`

现有解绑流程保留，但必须同步删除或标记 `SecretStorage` 中的持久化记录。

## 插件职责

### 持久化层

在 `vscode-extension` 中新增一个小型持久化模块，负责：

- 从 `SecretStorage` 读取全部已持久化设备
- 首次配对后 upsert 设备记录
- 解绑时删除或标记设备记录

读取时要做 schema 校验。若值无效或部分损坏，应安全回退为空列表，而不是让整个流程失败。

### Host 回灌

VS Code 插件启动 Agent Host 时：

1. 从 `SecretStorage` 读取已持久化设备记录
2. 按原流程启动 Host
3. 在正常 dashboard 轮询开始前，把受信任设备表注入 Host

优先实现方式：

- 扩展 Host controller / bootstrap 接口，让插件在 Host 启动时直接传入受信任设备列表

备选方式：

- 新增一个 Host 内部同步接口，在启动后立即把受信任设备列表推送进去

优先方案更干净，因为 Host 启动后立刻就是完整授权状态。

### 运行期更新

首次配对成功时：

1. Host 返回持久化所需的设备身份材料
2. 插件把受信任设备记录写入 `SecretStorage`
3. dashboard 刷新后展示该设备

解绑成功时：

1. 插件从 `SecretStorage` 删除或标记该设备
2. 插件通知 Host 删除该设备的运行期信任记录和全部访问 token

## Android 职责

### 本地存储

持久化保存：

- `deviceId`
- `deviceSecret`
- 最近一次桌面端 `host`
- 最近一次桌面端 `port`

`accessToken` 不作为长期信任状态保存。

### 重连行为

连接流程调整为：

1. 如果内存中已有 `accessToken`，优先尝试使用它
2. 如果启动时需要新会话，或任意授权请求返回 `401`，调用 `/devices/reauth`
3. 用返回的新 token 替换内存中的 `accessToken`
4. 重试原始请求并重新打开流连接

如果重新认证失败，则回退到当前错误路径，并提示用户重新配对。

### 体验预期

移动端体验应该是“桌面端被记住了”：

- 插件重启后不需要重新扫码
- Host 重启后可通过一次静默重新认证恢复
- 只有显式解绑或本地 App 数据被清除时，才需要重新配对

## 安全说明

- 插件持久化时只保存 `deviceSecretHash`，绝不保存明文 secret
- `accessToken` 保持短期、Host 作用域内有效
- 解绑必须同时失效：
  - 持久化信任关系
  - Host 运行期信任关系
  - 该设备所有运行期访问 token
- 未来即使补充 token TTL 与轮换，也不需要改变当前持久化模型

## 失败处理

### SecretStorage 读取失败

- 插件记录日志
- 安全回退为空的受信任设备列表
- dashboard 展示为无已记住设备
- 在存储恢复前，旧移动设备需要重新配对

### Host 在回灌前重启完成

- 插件在受信任设备注入完成前，不应把 Host 标记为完全可用
- dashboard 轮询应在回灌完成后再开始

### 持久化记录损坏

- 经过 schema 校验后忽略无效记录
- 保留有效记录
- 不能因为单条记录损坏就让整个启动流程失败

## 测试

### 协议与 Host

- `/pair` 在首次配对时返回 `deviceSecret` 和运行期 `accessToken`
- `/devices/reauth` 对已记住设备返回新的 `accessToken`
- 已解绑设备 `reauth` 失败
- Host 重启后旧运行期 token 失效，但插件回灌后仍可 `reauth`

### VS Code 插件

- 已持久化设备记录在插件重启后仍然存在
- Host 启动时会从 `SecretStorage` 加载受信任设备
- 解绑会同时更新 Host 运行期状态和 `SecretStorage`
- dashboard 在重启后仍展示已记住设备

### Android

- 首次配对后保存 `deviceId` 和 `deviceSecret`
- 收到 `401` 后自动执行静默 `reauth`
- `reauth` 成功后可恢复状态拉取和流式连接，无需重新扫码
- 已解绑设备会回退为需要显式重新配对

## 已确认决策

- 信任锚点位置：VS Code 插件 `SecretStorage`
- 运行期授权签发方：Agent Host
- 长期访问模型：记住设备身份，运行期重新签发 `accessToken`
- 设备生命周期：手动解绑前一直有效

## 实现顺序预览

建议的实现顺序：

1. 为受信任设备和重新认证补协议 schema
2. 为 Host 增加受信任设备启动注入和 `/devices/reauth`
3. 为 VS Code 插件增加 `SecretStorage` 持久化与 Host 回灌
4. 更新 Android，保存设备凭据并自动静默重新认证
5. 补齐 Host、插件和 Android 三端测试
