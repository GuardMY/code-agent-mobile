# VS Code 配对区块底部布局实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 VS Code 侧边栏中的配对入口相关区块移动到最下方，并且在未选择会话前隐藏会话详情面板。

**Architecture:** 改动保持在 VS Code webview 渲染层内。把配对相关的页脚区块从主仪表盘区块中拆出来，这样侧边栏可以先渲染服务、设备、Agent 和会话，再在底部渲染扫码入口、局域网控制和配对信息。

**Tech Stack:** TypeScript、VS Code webview renderer、Vitest

---

### Task 1: 为侧边栏顺序和条件化会话详情补充测试

**Files:**
- Modify: `vscode-extension/src/webview.test.ts`
- Modify: `vscode-extension/src/webview.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("renders pairing entry and controls after the session area", async () => {
  // 断言首次配对卡片出现在会话列表/详情之后
});

it("does not render the session detail panel when no session is selected", async () => {
  // 断言空白会话详情卡片不再出现
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: FAIL，因为配对入口卡片仍然在主仪表盘流程中渲染，而且未选会话时仍会显示空白会话详情卡片。

- [ ] **Step 3: Write minimal implementation**

```ts
return {
  mainHtml: [servicePanel, devicesPanel, sessionsPanel].join(""),
  footerHtml: [pairingEntryPanel, controlsPanel, pairingArtifactsPanel].join("")
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: PASS

### Task 2: 打包并验证插件产物

**Files:**
- Modify: `docs/superpowers/plans/2026-07-06-vscode-pairing-panels-bottom.md`
- Modify: `docs/superpowers/plans/2026-07-06-vscode-pairing-panels-bottom.zh-CN.md`

- [ ] **Step 1: Run focused extension tests**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: PASS

- [ ] **Step 2: Package the VS Code extension**

Run: `npm run package:extension`
Expected: PASS，并在 `vscode-extension/` 下生成 `.vsix` 文件

- [ ] **Step 3: Review the final diff**

Run: `git diff -- vscode-extension/src/webview.ts vscode-extension/src/webview.test.ts docs/superpowers/plans/2026-07-06-vscode-pairing-panels-bottom.md docs/superpowers/plans/2026-07-06-vscode-pairing-panels-bottom.zh-CN.md`
Expected: diff 清楚显示配对页脚区块被移动到侧边栏末尾，且会话详情只在选中会话时渲染。
