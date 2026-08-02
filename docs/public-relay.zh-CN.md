# 公网中继连接

Code Agent Mobile 通过主动建立的 WebSocket 中继支持公网访问。桌面 Host 仍按原有配置监听本机或局域网地址，无需开放任何入站公网端口。

## 部署中继

在可访问的服务器上运行 Gateway，并在前方终止 TLS。移动端必须使用带有效证书的 `wss://` 地址。

```powershell
npm run dev:gateway -- --host 0.0.0.0 --port 17366
```

生产部署时，请配置反向代理，把 `/host` 和 `/app` 的 WebSocket Upgrade 转发给 Gateway。不要将 Agent Host 的 HTTP 端口暴露到公网。

Gateway 支持两种模式：

- 动态通道：不传入 `--relay-token`。第一个使用某个 `hostId` 连接的 Host 会绑定该通道令牌，令牌匹配的客户端才能加入。
- 固定通道：传入 `--relay-token <token>`。所有 Host 与移动端都必须使用这个令牌。

## VS Code 配置

三个配置项必须同时设置。配置完成后，执行 `Agent Mobile: Start Host` 或启用局域网配对都会让 Host 自动建立出站中继连接。

```json
{
  "agentMobile.relayUrl": "wss://relay.example.com",
  "agentMobile.relayHostId": "host_8c02d1f5b2c84a58",
  "agentMobile.relayToken": "replace-with-a-unique-secret-at-least-16-characters"
}
```

每台桌面主机都应使用唯一且高熵的 `relayHostId` 与 `relayToken`。扩展会校验完整配置，并把中继信息写入配对二维码和 JSON。

## 移动端流程

1. 配置中继后，从 VS Code 启动 Host。
2. 在 Android 中扫描生成的二维码，或粘贴配对 JSON。
3. Android 会经中继执行配对、重新认证、会话读取、命令、审批和实时事件接收。

现有仅局域网配对 JSON 无需改动。Android 只接受包含全部中继字段且使用 `wss://` 的公网配对信息。

## 安全说明

- 所有公网中继端点都必须使用 TLS 和有效证书。
- 中继令牌和配对二维码/JSON 都属于凭据，不要提交到源代码或写入日志。
- 请及时升级 Gateway 与 Agent Host。手机丢失或不再受信任时，请从桌面仪表盘撤销设备。由于中继 token 是通道级凭据，丢失的设备曾获取该 token 时，还应轮换它并重新配对其余设备。
- Host 仅代理移动端所需且已认证的 API 操作；公网中继不提供 Host 生命周期控制。
