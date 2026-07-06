# VS Code Pairing Panels Bottom Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the pairing entry panels to the bottom of the VS Code sidebar and hide the session detail panel until a session is selected.

**Architecture:** Keep the change inside the VS Code webview renderer. Split pairing-related footer panels from the main dashboard panels so the sidebar can render service, devices, agents, and sessions first, then the pairing entry, LAN controls, and pairing artifacts at the bottom.

**Tech Stack:** TypeScript, VS Code webview renderer, Vitest

---

### Task 1: Update webview coverage for sidebar ordering and conditional session detail

**Files:**
- Modify: `vscode-extension/src/webview.test.ts`
- Modify: `vscode-extension/src/webview.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("renders pairing entry and controls after the session area", async () => {
  // assert the first-time pairing card appears after the session list/detail panels
});

it("does not render the session detail panel when no session is selected", async () => {
  // assert the empty session detail card is absent
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: FAIL because the pairing entry card is still emitted in the main dashboard flow and the empty session detail card still renders.

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

### Task 2: Package and verify the extension artifact

**Files:**
- Modify: `docs/superpowers/plans/2026-07-06-vscode-pairing-panels-bottom.md`
- Modify: `docs/superpowers/plans/2026-07-06-vscode-pairing-panels-bottom.zh-CN.md`

- [ ] **Step 1: Run focused extension tests**

Run: `npm test --workspace vscode-extension -- webview.test.ts`
Expected: PASS

- [ ] **Step 2: Package the VS Code extension**

Run: `npm run package:extension`
Expected: PASS and a `.vsix` file under `vscode-extension/`

- [ ] **Step 3: Review the final diff**

Run: `git diff -- vscode-extension/src/webview.ts vscode-extension/src/webview.test.ts docs/superpowers/plans/2026-07-06-vscode-pairing-panels-bottom.md docs/superpowers/plans/2026-07-06-vscode-pairing-panels-bottom.zh-CN.md`
Expected: the diff shows the pairing footer moved to the end of the sidebar and the session detail panel rendered only when a session is selected.
