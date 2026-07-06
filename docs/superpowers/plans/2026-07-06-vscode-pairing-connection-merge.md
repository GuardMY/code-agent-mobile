# VS Code Pairing Connection Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the VS Code sidebar pairing entry and pairing details into a single bottom `配对连接` card that always shows the QR code and pairing JSON together.

**Architecture:** Keep the change inside the VS Code webview renderer and tests. Replace the separate pairing entry and pairing artifacts footer panels with one merged footer panel, while preserving the existing LAN controls panel and footer ordering. Verify the merged copy, empty state, and removed legacy titles through focused webview coverage before packaging the extension.

**Tech Stack:** TypeScript, VS Code webview renderer, Vitest, VSCE packaging

---

### Task 1: Add failing webview tests for the merged pairing card

**Files:**
- Modify: `vscode-extension/src/webview.test.ts`
- Modify: `vscode-extension/src/webview.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("renders a single pairing connection panel with qr and pairing json", async () => {
  const html = await renderPairingHtml({
    status: "running",
    lanEnabled: true,
    pairingJson:
      "{\"host\":\"192.168.1.10\",\"port\":17365,\"pairingToken\":\"pairing-token-123\",\"deviceName\":\"VS Code\"}",
    qrSvg: "<svg></svg>",
    dashboard: dashboard({
      devices: [{ deviceId: "android_1", clientType: "android-app", pairedAt: "2026-06-30T14:30:00.000Z" }]
    })
  });

  expect(html).toContain('class="panel-card pairing-connection-panel"');
  expect(html).toContain("<h3>配对连接</h3>");
  expect(html).toContain('<section class="qr"><svg></svg></section>');
  expect(html).toContain("\"pairingToken\":\"pairing-token-123\"");
  expect(html).not.toContain("<h3>扫码连接第一台移动设备</h3>");
  expect(html).not.toContain("<h3>添加设备</h3>");
  expect(html).not.toContain("<h3>配对信息</h3>");
});

it("keeps the merged pairing connection panel visible with empty-state copy when pairing details are unavailable", async () => {
  const html = await renderPairingHtml({
    status: "stopped",
    lanEnabled: false,
    pairingJson: "{}",
    qrSvg: "",
    dashboard: dashboard({})
  });

  expect(html).toContain('class="panel-card pairing-connection-panel"');
  expect(html).toContain("<h3>配对连接</h3>");
  expect(html).toContain("刷新或启动主机后将在这里显示二维码和配对 JSON。");
  expect(html).not.toContain("<h3>配对信息</h3>");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: FAIL because the renderer still outputs `扫码连接第一台移动设备` or `添加设备` as one panel title, still emits a separate `配对信息` panel, and does not show the new empty-state copy.

- [ ] **Step 3: Commit**

```bash
git add vscode-extension/src/webview.test.ts
git commit -m "test: cover merged pairing connection panel"
```

### Task 2: Implement the merged pairing connection panel in the webview

**Files:**
- Modify: `vscode-extension/src/webview.ts`
- Modify: `vscode-extension/src/webview.test.ts`

- [ ] **Step 1: Write minimal implementation**

```ts
const pairingConnectionHtml = renderPairingConnectionPanel({
  pairingJson: input.pairingJson,
  qrSvg: input.qrSvg
});

return `<!doctype html>
<html lang="zh-CN">
...
  <main class="panel">
    <section class="panel-card">
      <h2>Agent Mobile</h2>
      <div class="status"><span class="dot"></span>${statusLabel(input.status)}</div>
    </section>
    ${dashboard.mainHtml}
    ${pairingConnectionHtml}
    ${renderPanel(
      "局域网控制与配对",
      `<div class="actions">...</div>
       <div class="controls-copy">
         <p class="muted">把当前主机的局域网访问、状态刷新和配对分享集中放在这里，和会话区分开。</p>
       </div>`,
      "controls-panel"
    )}
  </main>
</html>`;
```

```ts
function renderDashboard(...): { mainHtml: string } {
  if (!input.dashboard) {
    return {
      mainHtml: renderPendingDashboard(input)
    };
  }
  if (!input.dashboard.reachable) {
    return {
      mainHtml: `<section class="section"><h3>服务</h3><p class="danger">无法连接主机：${escapeHtml(input.dashboard.error)}</p></section>`
    };
  }

  return {
    mainHtml: [
      renderPanel("服务", ...),
      renderPanel("移动设备", ...),
      renderPanel("桌面 Agent", ...),
      renderPanel("Codex 会话", ...),
      sessionDetailHtml
    ].join("")
  };
}

function renderPairingConnectionPanel(input: { pairingJson: string; qrSvg: string }): string {
  const pairingDetails = parsePairingDetails(input.pairingJson);
  if (!pairingDetails) {
    return renderPanel(
      "配对连接",
      `<section class="section">
        <p class="muted">在 Android 应用、iOS 应用或微信小程序中使用这里的二维码或配对 JSON。</p>
        <p class="muted">刷新或启动主机后将在这里显示二维码和配对 JSON。</p>
      </section>`,
      "pairing-connection-panel"
    );
  }

  return renderPanel(
    "配对连接",
    `<section class="section">
      <p class="muted">在 Android 应用、iOS 应用或微信小程序中使用这里的二维码或配对 JSON。</p>
      <section class="qr">${input.qrSvg}</section>
      <pre>${escapeHtml(input.pairingJson)}</pre>
    </section>`,
    "pairing-connection-panel"
  );
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: PASS with the new merged `配对连接` coverage and the existing sidebar ordering/session detail coverage still green.

- [ ] **Step 3: Commit**

```bash
git add vscode-extension/src/webview.ts vscode-extension/src/webview.test.ts
git commit -m "feat: merge vscode pairing connection panels"
```

### Task 3: Package and verify the VS Code extension artifact

**Files:**
- Modify: `docs/superpowers/plans/2026-07-06-vscode-pairing-connection-merge.md`
- Modify: `docs/superpowers/plans/2026-07-06-vscode-pairing-connection-merge.zh-CN.md`

- [ ] **Step 1: Run focused extension tests**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: PASS

- [ ] **Step 2: Package the VS Code extension**

Run: `npm run package:extension`
Expected: PASS and a `.vsix` file is produced under `vscode-extension/`

- [ ] **Step 3: Review the final diff**

Run: `git diff -- vscode-extension/src/webview.ts vscode-extension/src/webview.test.ts docs/superpowers/plans/2026-07-06-vscode-pairing-connection-merge.md docs/superpowers/plans/2026-07-06-vscode-pairing-connection-merge.zh-CN.md`
Expected: the diff only shows the merged `配对连接` panel, the new empty-state copy, the updated tests, and the bilingual plan files.
