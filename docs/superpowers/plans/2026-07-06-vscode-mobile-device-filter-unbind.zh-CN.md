# VS Code 移动设备过滤与解绑实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 更新 VS Code 扩展，使移动设备面板只显示活跃移动设备，并支持在列表中直接解绑。

**架构：** host server 已经负责记录所有已配对设备并暴露 revoke 接口，所以这次改动主要留在插件侧。webview 在渲染前过滤 dashboard 返回的设备，扩展宿主负责把解绑按钮点击转发到本地 host client，然后刷新 dashboard。

**技术栈：** TypeScript、VS Code Extension API、Vitest

---

### Task 1: 为过滤后的移动设备列表补失败测试

**Files:**
- Modify: `vscode-extension/src/webview.test.ts`
- Modify: `vscode-extension/src/webview.ts`

- [ ] **Step 1: 编写失败测试**

```ts
it("shows only active mobile devices in the mobile device panel", async () => {
  // 构造 android、wechat、desktop-extension 和已解绑 android。
  // 断言最终 HTML 中只保留活跃的 android/wechat 行。
});

it("renders an unbind button for each visible mobile device", async () => {
  // 断言存在 data-command="revokeDevice" 和对应的 data-device-id。
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: FAIL，因为当前 webview 仍会渲染 desktop-extension、已解绑设备，且还没有解绑按钮。

- [ ] **Step 3: 编写最小实现**

```ts
const mobileDevices = status.devices.filter(
  (device) => isMobileClient(device.clientType) && !device.revokedAt
);
```

```ts
<button data-command="revokeDevice" data-device-id="${escapeHtml(device.deviceId)}">解绑</button>
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: PASS

### Task 2: 为 revoke 请求补 client 失败测试

**Files:**
- Modify: `vscode-extension/src/hostClient.test.ts`
- Modify: `vscode-extension/src/hostClient.ts`

- [ ] **Step 1: 编写失败测试**

```ts
it("revokes a paired mobile device with the current access token", async () => {
  // 先完成一次配对，再调用 revokeDevice("android_1")。
  // 断言请求为 POST /devices/android_1/revoke 且带有 bearer token。
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test --workspace vscode-extension -- hostClient.test.ts`
Expected: FAIL，因为 LocalHostSessionClient 还没有 revokeDevice 方法。

- [ ] **Step 3: 编写最小实现**

```ts
async revokeDevice(deviceId: string): Promise<void> {
  await this.authorizedRequest(`/devices/${encodeURIComponent(deviceId)}/revoke`, {
    method: "POST"
  });
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test --workspace vscode-extension -- hostClient.test.ts`
Expected: PASS

### Task 3: 将 webview 的解绑动作接入扩展宿主

**Files:**
- Modify: `vscode-extension/src/extension.ts`
- Modify: `vscode-extension/src/extension.test.ts`

- [ ] **Step 1: 编写失败测试**

```ts
it("routes revokeDevice messages through the local host client and refreshes the view", async () => {
  // 模拟 webview 发出 revokeDevice + deviceId 消息。
  // 断言会调用 hostClient.revokeDevice，并触发 safeRefresh。
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: FAIL，因为 provider 还没有处理 revokeDevice 消息。

- [ ] **Step 3: 编写最小实现**

```ts
} else if (message.command === "revokeDevice" && message.deviceId) {
  void this.revokeDevice(message.deviceId);
}
```

```ts
private async revokeDevice(deviceId: string): Promise<void> {
  await this.requireHostClient().revokeDevice(deviceId);
  await this.safeRefresh();
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: PASS

### Task 4: 验证扩展并打包 VSIX

**Files:**
- Modify: `docs/superpowers/specs/2026-07-06-vscode-mobile-device-filter-unbind-design.md`
- Modify: `docs/superpowers/specs/2026-07-06-vscode-mobile-device-filter-unbind-design.zh-CN.md`
- Modify: `docs/superpowers/plans/2026-07-06-vscode-mobile-device-filter-unbind.md`

- [ ] **Step 1: 运行聚焦测试**

Run: `npm test --workspace vscode-extension -- webview.test.ts hostClient.test.ts extension.test.ts`
Expected: PASS

- [ ] **Step 2: 打包 VS Code 扩展**

Run: `npm run package:extension`
Expected: PASS，并在 `vscode-extension/` 下生成 `.vsix`

- [ ] **Step 3: 检查最终 diff**

Run: `git diff -- vscode-extension/src/webview.ts vscode-extension/src/webview.test.ts vscode-extension/src/hostClient.ts vscode-extension/src/hostClient.test.ts vscode-extension/src/extension.ts docs/superpowers/specs/2026-07-06-vscode-mobile-device-filter-unbind-design.md docs/superpowers/specs/2026-07-06-vscode-mobile-device-filter-unbind-design.zh-CN.md docs/superpowers/plans/2026-07-06-vscode-mobile-device-filter-unbind.md`
Expected: 只包含设备过滤渲染、解绑链路和中英文文档相关改动。
