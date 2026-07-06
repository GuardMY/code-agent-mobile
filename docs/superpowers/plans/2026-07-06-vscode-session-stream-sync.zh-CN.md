# VS Code 会话流式同步实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 VS Code 插件会话面板，让 agent 的流式输出显示为一条持续增长的回复，新会话能更及时出现在列表里，并且当前会话在流式输出时不再跳回第一条消息。

**Architecture:** 改动保持在 VS Code 插件内部。provider 负责复用单个 host client 和单条后台事件流来同步 dashboard 与会话状态，webview 负责从原始事件派生会话消息，并基于“渲染后的消息”而不是“原始事件条数”决定自动滚动。

**Tech Stack:** TypeScript、VS Code webview、Vitest

---

### Task 1: 用测试锁定转录渲染和自动滚动规则

**Files:**
- Modify: `vscode-extension/src/webview.test.ts`
- Modify: `vscode-extension/src/webview.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("merges consecutive agent output chunks into one rendered message", () => {
  // 断言相邻的两个 agent.output 事件会合并成一条会话消息
});

it("treats a longer streamed agent reply as new content for auto-scroll decisions", () => {
  // 断言同一条回复继续增长时，自动滚动判断会返回 "bottom"
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: FAIL，因为当前仍然按每个输出分片渲染气泡，滚动快照也只比较事件条数。

- [ ] **Step 3: Write minimal implementation**

```ts
function buildRenderedSessionMessages(events) {
  // 合并相邻的 agent.output 分片，用户/系统事件保持独立
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: PASS

### Task 2: 用测试锁定 host client 复用规则

**Files:**
- Modify: `vscode-extension/src/extension.test.ts`
- Modify: `vscode-extension/src/extension.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("reuses the current host client config when host, port, and pairing token stay the same", () => {
  // 断言配置未变化时不应 reset client
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: FAIL，因为当前每次 refresh 拉到 dashboard 后都会重建 host client。

- [ ] **Step 3: Write minimal implementation**

```ts
function isSameHostClientTarget(current, next) {
  return current?.host === next.host && current?.port === next.port && current?.pairingToken === next.pairingToken;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: PASS

### Task 3: 保持一条后台流以便及时同步会话列表

**Files:**
- Modify: `vscode-extension/src/extension.ts`

- [ ] **Step 1: Extend the provider flow**

```ts
private ensureStreamSubscription(): void {
  // 每个 host client 只订阅一次，并在会话生命周期事件到来时刷新视图
}
```

- [ ] **Step 2: Keep refresh from tearing down the stream**

```ts
if (dashboard.reachable) {
  this.updateHostClient(...);
  this.ensureStreamSubscription();
}
```

- [ ] **Step 3: Verify behavior with focused tests**

Run: `npm test --workspace vscode-extension -- extension.test.ts webview.test.ts`
Expected: PASS

### Task 4: 打包并验证插件产物

**Files:**
- Modify: `docs/superpowers/plans/2026-07-06-vscode-session-stream-sync.md`
- Modify: `docs/superpowers/plans/2026-07-06-vscode-session-stream-sync.zh-CN.md`

- [ ] **Step 1: Run the focused VS Code extension tests**

Run: `npm test --workspace vscode-extension -- extension.test.ts webview.test.ts hostClient.test.ts`
Expected: PASS

- [ ] **Step 2: Package the VS Code extension**

Run: `npm run package:extension`
Expected: PASS，并在 `vscode-extension/` 下生成 `.vsix` 文件

- [ ] **Step 3: Inspect the final diff**

Run: `git diff -- vscode-extension/src/extension.ts vscode-extension/src/extension.test.ts vscode-extension/src/webview.ts vscode-extension/src/webview.test.ts docs/superpowers/plans/2026-07-06-vscode-session-stream-sync.md docs/superpowers/plans/2026-07-06-vscode-session-stream-sync.zh-CN.md`
Expected: diff 只包含本次修复所需的流式渲染、会话同步、滚动保持和双语计划文档改动。
