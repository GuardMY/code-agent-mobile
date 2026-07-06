# VS Code Session Detail Auto-Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the VS Code session detail view so it follows the latest messages on first open and after user send, while only following agent replies when the user was already at the bottom.

**Architecture:** The change stays in the VS Code webview layer. The extension continues to provide ordered session events, while the webview script tracks whether the user is near the bottom and decides when to scroll after rerenders.

**Tech Stack:** TypeScript, VS Code webview UI script, Vitest

---

### Task 1: Cover the current session detail rendering rules

**Files:**
- Modify: `vscode-extension/src/webview.test.ts`
- Modify: `vscode-extension/src/webview.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("renders the session message container with a stable hook for auto-scroll", async () => {
  // expect the selected session detail HTML to include the message container id/data attributes
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: FAIL because the message list does not yet expose the required hook.

- [ ] **Step 3: Write minimal implementation**

```ts
return `<div id="sessionMessages" class="session-console-output">...</div>`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: PASS

### Task 2: Add failing browser-side auto-scroll tests

**Files:**
- Modify: `vscode-extension/src/webview.test.ts`
- Modify: `vscode-extension/src/webview.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("scrolls to bottom when a session is first opened", async () => {
  // render, simulate selected session mount, expect scrollTop to move to the bottom
});

it("scrolls to bottom after the user sends a message", async () => {
  // simulate send button click and rerender with a new input event
});

it("follows agent output only when the view was already at the bottom", async () => {
  // cover both near-bottom and away-from-bottom cases
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: FAIL because the webview script does not track bottom state or rerender follow rules.

- [ ] **Step 3: Write minimal implementation**

```ts
const scrollStateBySession = new Map();
function isNearBottom(element) { ... }
function scrollToBottom(element) { ... }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: PASS

### Task 3: Verify event ordering for user sends

**Files:**
- Modify: `vscode-extension/src/extension.test.ts`
- Modify: `vscode-extension/src/extension.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("appends the local user input event before awaiting host delivery", async () => {
  // expect the session events list to contain the latest input immediately
});
```

- [ ] **Step 2: Run test to verify it fails or confirm existing behavior**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: either FAIL if ordering regressed, or PASS confirming no production change is needed.

- [ ] **Step 3: Write minimal implementation if needed**

```ts
this.state.sessionEvents = [...this.state.sessionEvents, localInputEvent];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: PASS

### Task 4: Final verification and packaging

**Files:**
- Modify: `docs/superpowers/specs/2026-07-06-vscode-session-detail-auto-scroll-design.md`
- Modify: `docs/superpowers/specs/2026-07-06-vscode-session-detail-auto-scroll-design.zh-CN.md`
- Modify: `docs/superpowers/plans/2026-07-06-vscode-session-detail-auto-scroll.md`

- [ ] **Step 1: Run focused extension tests**

Run: `npm test --workspace vscode-extension -- webview.test.ts extension.test.ts`
Expected: PASS

- [ ] **Step 2: Package the VS Code extension**

Run: `npm run package:extension`
Expected: PASS and a `.vsix` file under `vscode-extension/`

- [ ] **Step 3: Review the final diff**

Run: `git diff -- vscode-extension/src/webview.ts vscode-extension/src/webview.test.ts vscode-extension/src/extension.ts vscode-extension/src/extension.test.ts docs/superpowers/specs/2026-07-06-vscode-session-detail-auto-scroll-design.md docs/superpowers/specs/2026-07-06-vscode-session-detail-auto-scroll-design.zh-CN.md docs/superpowers/plans/2026-07-06-vscode-session-detail-auto-scroll.md`
Expected: the diff matches the approved auto-scroll rules and bilingual documentation.
