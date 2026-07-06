# VS Code Session Stream Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the VS Code extension session panel so agent streaming output renders as a single growing reply, new sessions appear promptly, and the selected transcript no longer jumps back to the first message while streaming.

**Architecture:** Keep the change inside the VS Code extension. The provider should keep one reusable host client and one live event stream for dashboard/session updates, while the webview should derive transcript messages from raw events and base auto-scroll on rendered messages instead of raw event count.

**Tech Stack:** TypeScript, VS Code webview, Vitest

---

### Task 1: Lock transcript rendering and auto-scroll rules with tests

**Files:**
- Modify: `vscode-extension/src/webview.test.ts`
- Modify: `vscode-extension/src/webview.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("merges consecutive agent output chunks into one rendered message", () => {
  // expect two adjacent agent.output events to become one transcript item
});

it("treats a longer streamed agent reply as new content for auto-scroll decisions", () => {
  // expect the snapshot comparison to return "bottom" when the same reply grows
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: FAIL because the transcript still renders one bubble per output chunk and the scroll snapshot only compares event count.

- [ ] **Step 3: Write minimal implementation**

```ts
function buildRenderedSessionMessages(events) {
  // merge adjacent agent.output chunks and keep user/system events separate
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: PASS

### Task 2: Lock host client reuse rules with tests

**Files:**
- Modify: `vscode-extension/src/extension.test.ts`
- Modify: `vscode-extension/src/extension.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("reuses the current host client config when host, port, and pairing token stay the same", () => {
  // expect no reset while config is unchanged
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: FAIL because refresh currently rebuilds the host client every time dashboard status is fetched.

- [ ] **Step 3: Write minimal implementation**

```ts
function isSameHostClientTarget(current, next) {
  return current?.host === next.host && current?.port === next.port && current?.pairingToken === next.pairingToken;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: PASS

### Task 3: Keep one background stream for timely session list updates

**Files:**
- Modify: `vscode-extension/src/extension.ts`

- [ ] **Step 1: Extend the provider flow**

```ts
private ensureStreamSubscription(): void {
  // subscribe once per host client and refresh the view for session lifecycle events
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

### Task 4: Package and verify the extension artifact

**Files:**
- Modify: `docs/superpowers/plans/2026-07-06-vscode-session-stream-sync.md`
- Modify: `docs/superpowers/plans/2026-07-06-vscode-session-stream-sync.zh-CN.md`

- [ ] **Step 1: Run the focused VS Code extension tests**

Run: `npm test --workspace vscode-extension -- extension.test.ts webview.test.ts hostClient.test.ts`
Expected: PASS

- [ ] **Step 2: Package the VS Code extension**

Run: `npm run package:extension`
Expected: PASS and a `.vsix` file under `vscode-extension/`

- [ ] **Step 3: Inspect the final diff**

Run: `git diff -- vscode-extension/src/extension.ts vscode-extension/src/extension.test.ts vscode-extension/src/webview.ts vscode-extension/src/webview.test.ts docs/superpowers/plans/2026-07-06-vscode-session-stream-sync.md docs/superpowers/plans/2026-07-06-vscode-session-stream-sync.zh-CN.md`
Expected: the diff only contains the stream rendering, session sync, scroll preservation, and bilingual plan updates required for this fix.
