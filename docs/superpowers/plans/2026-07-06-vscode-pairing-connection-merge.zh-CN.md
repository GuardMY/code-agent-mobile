# VS Code 配对连接合并实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将 VS Code 侧边栏底部的配对入口与配对详情合并成一张统一的 `配对连接` 卡片，让二维码和配对 JSON 始终一起展示。

**架构：** 将改动限制在 VS Code webview 渲染层和对应测试中。用一个合并后的页脚面板替换分开的配对入口面板和配对信息面板，同时保留现有的局域网控制面板及其顺序。先通过定向的 webview 测试验证合并文案、空态和旧标题移除，再对扩展进行打包验证。

**技术栈：** TypeScript、VS Code webview renderer、Vitest、VSCE 打包

---

### Task 1: 为合并后的配对卡片补充失败测试

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
Expected: FAIL，因为当前渲染器仍会输出 `扫码连接第一台移动设备` 或 `添加设备` 作为单独面板标题，仍会渲染独立的 `配对信息` 面板，也不会显示新的空态文案。

- [ ] **Step 3: Commit**

```bash
git add vscode-extension/src/webview.test.ts
git commit -m "test: cover merged pairing connection panel"
```

### Task 2: 在 webview 中实现合并后的配对连接卡片

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
Expected: PASS，并且新的 `配对连接` 覆盖以及现有的侧边栏顺序/会话详情测试都保持绿色。

- [ ] **Step 3: Commit**

```bash
git add vscode-extension/src/webview.ts vscode-extension/src/webview.test.ts
git commit -m "feat: merge vscode pairing connection panels"
```

### Task 3: 打包并验证 VS Code 插件产物

**Files:**
- Modify: `docs/superpowers/plans/2026-07-06-vscode-pairing-connection-merge.md`
- Modify: `docs/superpowers/plans/2026-07-06-vscode-pairing-connection-merge.zh-CN.md`

- [ ] **Step 1: Run focused extension tests**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: PASS

- [ ] **Step 2: Package the VS Code extension**

Run: `npm run package:extension`
Expected: PASS，并在 `vscode-extension/` 下生成 `.vsix` 文件

- [ ] **Step 3: Review the final diff**

Run: `git diff -- vscode-extension/src/webview.ts vscode-extension/src/webview.test.ts docs/superpowers/plans/2026-07-06-vscode-pairing-connection-merge.md docs/superpowers/plans/2026-07-06-vscode-pairing-connection-merge.zh-CN.md`
Expected: diff 只包含合并后的 `配对连接` 面板、新的空态文案、更新后的测试，以及双语计划文件。
