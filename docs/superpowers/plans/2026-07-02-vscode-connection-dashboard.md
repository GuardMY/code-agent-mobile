# VS Code Connection Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension dashboard that shows Agent Host status, mobile app/WeChat pairing state, and desktop agent capability/session state.

**Architecture:** Add protocol types for client types and dashboard status, expose `GET /status` from Agent Host, then have the VS Code extension poll that endpoint and render a richer dashboard webview. Keep pairing compatible by defaulting omitted `clientType` to `android-app`.

**Tech Stack:** TypeScript, Zod, Fastify, VS Code WebviewView, qrcode, Vitest, npm workspaces.

---

### Task 1: Add Protocol Types For Client And Dashboard Status

**Files:**
- Modify: `protocol/src/index.ts`
- Modify: `protocol/src/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that assert device summaries carry a `clientType` and that dashboard status validates the top-level server/devices/agents/sessions shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @agent-mobile/protocol -- src/index.test.ts`
Expected: FAIL because `clientTypeSchema`, `agentCapabilitySummarySchema`, and `hostDashboardStatusSchema` do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add:
- `clientTypeSchema`
- `agentAvailabilitySchema`
- `agentCapabilitySummarySchema`
- `hostDashboardStatusSchema`
- exported TypeScript types for each
- `clientType` to `deviceSummarySchema`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @agent-mobile/protocol -- src/index.test.ts`
Expected: PASS.

### Task 2: Add Host Status API And Client Type Pairing

**Files:**
- Modify: `agent-host/src/server.ts`
- Modify: `agent-host/src/server.test.ts`

- [ ] **Step 1: Write the failing tests**

Add host tests for:
- `/pair` without `clientType` returns/list devices as `android-app`
- `/pair` with `wechat-mini-program` preserves that type
- authenticated `GET /status` returns server, pairing, devices, agents, sessions

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @agent-mobile/agent-host -- src/server.test.ts`
Expected: FAIL because `clientType` is not accepted and `/status` does not exist.

- [ ] **Step 3: Write minimal implementation**

Update the pair request schema with optional `clientType`, store it on `DeviceSummary`, and add `GET /status`. For agent summaries:
- Always include Codex, Claude Code, and OpenCode.
- Codex availability is `unknown` in server tests unless explicit detection is added.
- `activeSessions` is computed from running sessions with matching `adapterId`.
- `latestSessionStatus` is taken from the most recent session for that agent.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @agent-mobile/agent-host -- src/server.test.ts`
Expected: PASS.

### Task 3: Add VS Code Host Status Fetching

**Files:**
- Modify: `vscode-extension/src/hostController.ts`
- Modify: `vscode-extension/src/hostController.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests for:
- building the local Host status URL from host/port
- returning an unreachable dashboard state when fetch fails

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @agent-mobile/vscode-extension -- src/hostController.test.ts`
Expected: FAIL because status URL/fetch helpers do not exist.

- [ ] **Step 3: Write minimal implementation**

Add:
- `buildHostStatusUrl(host, port)`
- `fetchHostDashboardStatus(input)` that calls `fetch`, parses JSON, and returns `{ reachable: true, status }` or `{ reachable: false, error }`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @agent-mobile/vscode-extension -- src/hostController.test.ts`
Expected: PASS.

### Task 4: Render The Dashboard Webview

**Files:**
- Modify: `vscode-extension/src/webview.ts`
- Modify: `vscode-extension/src/webview.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that render dashboard HTML containing:
- server status and LAN mode
- first-time connection copy when there are no active devices
- Android App and WeChat Mini Program labels
- Codex, Claude Code, and OpenCode rows

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @agent-mobile/vscode-extension -- src/webview.test.ts`
Expected: FAIL because `renderPairingHtml` does not accept dashboard status yet.

- [ ] **Step 3: Write minimal implementation**

Replace the simple pairing-only layout with a dashboard renderer that accepts:
- host status
- optional remote dashboard status
- pairing JSON and QR SVG
- LAN/running state

Keep HTML script-free and compatible with VS Code theme variables.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @agent-mobile/vscode-extension -- src/webview.test.ts`
Expected: PASS.

### Task 5: Wire Polling Into The VS Code Extension

**Files:**
- Modify: `vscode-extension/src/extension.ts`
- Modify: `vscode-extension/src/config.ts`
- Modify: `vscode-extension/src/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add config tests if a polling interval setting is introduced. Otherwise keep this task focused on wiring and rely on `webview`/`hostController` tests.

- [ ] **Step 2: Implement extension wiring**

Update `PairingViewProvider.refresh()` to:
- generate QR SVG as before
- call `fetchHostDashboardStatus` when Host is running
- pass the result to the webview renderer

Add a timer that refreshes every 3 seconds while the view is resolved, and dispose it with the extension context.

- [ ] **Step 3: Run focused extension tests**

Run: `npm run test -w @agent-mobile/vscode-extension`
Expected: PASS.

### Task 6: Verify The Whole Workspace

**Files:**
- Verify all touched files

- [ ] **Step 1: Run workspace tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Run workspace build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Package extension**

Run: `npm run package:extension`
Expected: PASS and regenerated `vscode-extension/agent-mobile-control-0.1.0.vsix`.
