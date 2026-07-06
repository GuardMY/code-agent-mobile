# VS Code Mobile Device Filter And Unbind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the VS Code extension so the mobile device panel only shows active mobile devices and lets users unbind them inline.

**Architecture:** The host server already tracks every paired device and exposes a revoke endpoint, so the change stays plugin-side. The webview will filter dashboard devices before rendering, and the extension host will route unbind button clicks through the local host client and then refresh the dashboard.

**Tech Stack:** TypeScript, VS Code extension API, Vitest

---

### Task 1: Add failing UI tests for the filtered mobile device list

**Files:**
- Modify: `vscode-extension/src/webview.test.ts`
- Modify: `vscode-extension/src/webview.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("shows only active mobile devices in the mobile device panel", async () => {
  // Include android, wechat, desktop-extension, and revoked android entries.
  // Expect only active android/wechat rows in the rendered HTML.
});

it("renders an unbind button for each visible mobile device", async () => {
  // Expect data-command="revokeDevice" and matching data-device-id attributes.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: FAIL because the webview still renders desktop-extension and revoked devices, and there is no unbind button.

- [ ] **Step 3: Write minimal implementation**

```ts
const mobileDevices = status.devices.filter(
  (device) => isMobileClient(device.clientType) && !device.revokedAt
);
```

```ts
<button data-command="revokeDevice" data-device-id="${escapeHtml(device.deviceId)}">解绑</button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: PASS

### Task 2: Add failing client tests for revoke requests

**Files:**
- Modify: `vscode-extension/src/hostClient.test.ts`
- Modify: `vscode-extension/src/hostClient.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("revokes a paired mobile device with the current access token", async () => {
  // Pair once, call revokeDevice("android_1"), and expect POST /devices/android_1/revoke
  // with the bearer token header.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- hostClient.test.ts`
Expected: FAIL because LocalHostSessionClient does not expose revokeDevice yet.

- [ ] **Step 3: Write minimal implementation**

```ts
async revokeDevice(deviceId: string): Promise<void> {
  await this.authorizedRequest(`/devices/${encodeURIComponent(deviceId)}/revoke`, {
    method: "POST"
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- hostClient.test.ts`
Expected: PASS

### Task 3: Wire the webview revoke action through the extension host

**Files:**
- Modify: `vscode-extension/src/extension.ts`
- Modify: `vscode-extension/src/extension.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("routes revokeDevice messages through the local host client and refreshes the view", async () => {
  // Simulate a webview message with command revokeDevice and a deviceId.
  // Expect hostClient.revokeDevice to be called and safeRefresh to run.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: FAIL because the provider does not handle revokeDevice messages.

- [ ] **Step 3: Write minimal implementation**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: PASS

### Task 4: Verify the extension and package the VSIX

**Files:**
- Modify: `docs/superpowers/specs/2026-07-06-vscode-mobile-device-filter-unbind-design.md`
- Modify: `docs/superpowers/specs/2026-07-06-vscode-mobile-device-filter-unbind-design.zh-CN.md`
- Modify: `docs/superpowers/plans/2026-07-06-vscode-mobile-device-filter-unbind.md`

- [ ] **Step 1: Run focused tests**

Run: `npm test --workspace vscode-extension -- webview.test.ts hostClient.test.ts extension.test.ts`
Expected: PASS

- [ ] **Step 2: Package the VS Code extension**

Run: `npm run package:extension`
Expected: PASS and a `.vsix` file under `vscode-extension/`

- [ ] **Step 3: Review the final diff**

Run: `git diff -- vscode-extension/src/webview.ts vscode-extension/src/webview.test.ts vscode-extension/src/hostClient.ts vscode-extension/src/hostClient.test.ts vscode-extension/src/extension.ts docs/superpowers/specs/2026-07-06-vscode-mobile-device-filter-unbind-design.md docs/superpowers/specs/2026-07-06-vscode-mobile-device-filter-unbind-design.zh-CN.md docs/superpowers/plans/2026-07-06-vscode-mobile-device-filter-unbind.md`
Expected: only the filtered device rendering, revoke flow, and bilingual docs changes appear.
