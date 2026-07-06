# 2.0 Roadmap: Approval Card System

> **Audience:** Developers, product decision-makers
> **Status:** Draft

**Goal:** Unify all human-in-the-loop decision points during desktop agent conversations (tool call confirmations, command execution approvals, high-risk operation authorizations) into a single "Approval Card" model. Operate these cards from both the VS Code extension UI and the Android app, upgrading the experience from "blocked at the terminal waiting for input" to "asynchronous multi-device approval."

**Architecture:** Changes span all four modules: protocol, agent-host, vscode-extension, and android. The core idea is to decouple Claude Code's `control_request` events from the auto-allow/deny logic inside `ClaudeCodeClient`, and route them through SessionManager's approval pipeline instead, broadcasting to all connected clients in real time via WebSocket.

**Tech Stack:** TypeScript (protocol/agent-host/vscode-extension), Kotlin/Jetpack Compose (Android), WebSocket, Fastify

---

## 1. Current State Analysis

### 1.1 Existing Approval Infrastructure

| Module | Capability | Status |
|--------|-----------|--------|
| **protocol** | `ApprovalRequest` schema, `approval.required/approve/deny` message types, `ApprovalDecision`/`ApprovalStatus` enums | ✅ Complete |
| **agent-host** | `GET /approvals`, `POST /approvals/:id/respond` APIs, `SessionManager.requestApproval()`/`respondApproval()` methods | ✅ Complete |
| **agent-host** | `approval.required` event broadcast over WebSocket `/stream` | ✅ Complete |
| **Android** | Approval card UI in `ConsoleScreen` (approve/deny buttons), `respondApproval()` API call | ✅ Complete |
| **VS Code** | Webview event passing channel ready | ⚠️ Missing approval card UI |

### 1.2 Critical Gaps

| Gap | Location | Problem |
|-----|----------|---------|
| **control_request not wired to approvals** | [claudeCodeClient.ts](../../../agent-host/src/claude/claudeCodeClient.ts) L273-287 | `handleControlRequest()` directly auto-allows or auto-denies, never calls `SessionManager.requestApproval()` |
| **ClaudeCodeClient lacks external approval callback** | [claudeCodeAdapter.ts](../../../agent-host/src/adapters/claudeCodeAdapter.ts) | The adapter's `onOutput`/`onExit` callback model doesn't fit approval scenarios that require "waiting for external response" |
| **VS Code Webview has no approval UI** | [webview.ts](../../../vscode-extension/src/webview.ts) | The session detail panel only shows message streams, no approval card rendering |
| **No push notifications** | agent-host | Approval requests are only broadcast via WebSocket; no way to alert when device is in background |

### 1.3 Current Data Flow (the problem path)

```
Claude Code (stdio)
  │ control_request { tool_name: "Bash", input: { command: "rm -rf /" } }
  ▼
ClaudeCodeClient.handleControlRequest()
  │ autoAllowTools = true? → sendControlResponse("allow")   ← Auto-allowed!
  │ autoAllowTools = false? → sendControlResponse("deny")    ← Auto-denied!
  ▼
(Approval system never engaged)
```

---

## 2. Target Architecture for 2.0

### 2.1 Target Data Flow

```
Claude Code (stdio)
  │ control_request
  ▼
ClaudeCodeClient.handleControlRequest()
  │ No longer auto-allow/deny
  │ Calls options.onApprovalRequired({ requestId, toolName, input, reason })
  ▼
ClaudeCodeAdapter
  │ Forwards approval request to SessionManager
  ▼
SessionManager.requestApproval()
  │ Creates ApprovalRequest (status: "pending")
  │ Broadcasts approval.required event to all WebSocket clients
  │ Returns Promise<ApprovalDecision> (awaits response from any client)
  ├──► VS Code Webview ── Approval Card UI ──► User clicks [Approve]/[Deny]
  │       │ POST /approvals/:id/respond
  │       ▼
  ├──► Android App ──── Approval Card UI ──► User clicks [Approve]/[Deny]
  │       │ POST /approvals/:id/respond
  │       ▼
  ▼
SessionManager.respondApproval()
  │ Updates ApprovalRequest status
  │ Resolves the previously-returned Promise
  │ Broadcasts approval.approve / approval.deny events
  ▼
ClaudeCodeClient.sendControlResponse(requestId, "allow" | "deny")
  │ Writes to stdin → Claude Code
  ▼
Claude Code (continues execution)
```

### 2.2 Core Design Principles

1. **Approval decoupled from agent**: `AgentAdapter` doesn't need to understand approval details, only provides an `onApprovalRequired` callback
2. **First-come-first-served**: Multiple clients show the same approval card; first response wins, subsequent ones get 409
3. **Timeout safety**: Every approval request carries `timeoutSeconds`; automatic denial on timeout prevents the agent from hanging indefinitely
4. **Promise bridging**: `SessionManager.requestApproval()` returns a Promise, converting asynchronous human approval into an await-able result
5. **Configurable policy**: Support for allowlists (specific tools auto-approved), denylists (specific patterns auto-denied), and risk-level thresholds

---

## 3. Phased Implementation Plan

### Phase 2.0a — Approval Card MVP (Core Pipeline)

**Goal:** Claude Code tool confirmation → Approval Card → human response → continue execution

#### Task 1: Protocol Extension

**Files:** `protocol/src/index.ts`

- [ ] Add `details` field to `ApprovalRequest` (command content, file paths, etc.)
- [ ] Add `respondedBy` field to `ApprovalRequest` (response source: `"vscode" | "android" | "auto" | "timeout"`)
- [ ] Add `respondedAt` field to `ApprovalRequest`
- [ ] Add `approval.expired` message type
- [ ] Update related tests

#### Task 2: ClaudeCodeClient Approval Bridge

**Files:** `agent-host/src/claude/claudeCodeClient.ts`

- [ ] Refactor `handleControlRequest()`: remove auto-allow/deny logic
- [ ] Add `onApprovalRequired` callback option to `ClaudeCodeClientOptions`
- [ ] Add `approveControlRequest(requestId)` and `denyControlRequest(requestId)` methods
- [ ] Implement approval Promise suspension: `handleControlRequest` returns a Promise that only resolves when `approveControlRequest`/`denyControlRequest` is called externally
- [ ] Update tests to cover approval flow

#### Task 3: SessionManager Approval Promise Binding

**Files:** `agent-host/src/sessions/sessionManager.ts`

- [ ] `requestApproval()` returns `Promise<ApprovalDecision>` + `ApprovalRequest`
- [ ] Maintain internal `Map<approvalId, { resolve, reject, timeout }>`
- [ ] `respondApproval()` triggers corresponding resolve/reject
- [ ] Implement timeout auto-denial: `setTimeout` expiration triggers `respondApproval(id, "deny")`, status marked as `"expired"`
- [ ] Implement first-come-first-served: `respondApproval()` returns error for already-handled approvals

#### Task 4: ClaudeCodeAdapter Changes

**Files:** `agent-host/src/adapters/claudeCodeAdapter.ts`

- [ ] Pass `onApprovalRequired` callback to `ClaudeCodeClient`
- [ ] Bridge `onApprovalRequired` events to SessionManager
- [ ] Replace `autoAllowTools` option with `approvalMode: "auto" | "manual" | "whitelist"`
- [ ] Update tests

#### Task 5: VS Code Webview Approval Card UI

**Files:** `vscode-extension/src/webview.ts`, `vscode-extension/src/hostController.ts`

- [ ] New approval card CSS styles (card layout, risk-level color coding, countdown progress bar)
- [ ] Render pending approval cards: risk level, tool name, action summary, details, remaining time
- [ ] Approve/Deny buttons → `vscode.postMessage()` → `hostController.respondApproval()`
- [ ] Support multiple approval cards displayed simultaneously (sorted by time)
- [ ] Animated removal after approval is processed
- [ ] Keep approval cards visible during auto-scroll

#### Task 6: Integration Testing & End-to-End Verification

- [ ] Start agent-host (`approvalMode: "manual"`)
- [ ] Connect VS Code extension to host
- [ ] Connect Android app to host
- [ ] Trigger tool invocation through Claude Code session
- [ ] Verify approval card appears simultaneously in VS Code Webview and Android
- [ ] Verify approve/deny from either client takes effect
- [ ] Verify timeout auto-denial
- [ ] Verify first-come-first-served (second response returns 409)

---

### Phase 2.0b — Experience Enhancements

#### Task 7: Push Notifications

**Android:**
- [ ] Use Android Notification API to show notification when WebSocket receives `approval.required` and app is not in foreground
- [ ] Notification content: risk level, action name, summary
- [ ] Notification action buttons: Approve / Deny (PendingIntent → BroadcastReceiver → API call)
- [ ] Notification priority set to HIGH (timely user attention)

**VS Code:**
- [ ] Use `vscode.window.showInformationMessage` for approval dialog
- [ ] Dialog buttons: Approve / Deny / View Details
- [ ] "View Details" switches to Agent Mobile webview panel

#### Task 8: Approval Countdown Timer

- [ ] VS Code Webview: display remaining seconds countdown on card
- [ ] Android: display countdown progress bar on card
- [ ] Highlight flash when 5 seconds remain before timeout
- [ ] Card transitions to "Expired" state and auto-dismisses

#### Task 9: Approval Policy Configuration

**Files:** `agent-host/src/claude/claudeCodeClient.ts` (add `ApprovalPolicy`)

- [ ] Allowlist mode: `autoApprove: ["Read", "Glob", "Grep"]`
- [ ] Denylist mode: `alwaysDeny: [{ tool: "Bash", pattern: "rm -rf" }]`
- [ ] Risk threshold: `minRiskForApproval: "medium"` (low-risk auto-approved)
- [ ] Configuration source: agent-host CLI args → VS Code settings → defaults
- [ ] Policy evaluation runs before approval flow in `handleControlRequest`

#### Task 10: Approval Card Grouping & Batch Operations

- [ ] "Approve All" action for multiple approval cards in the same session
- [ ] Approval cards grouped by risk level

---

### Phase 2.0c — Approval History & Audit

#### Task 11: Approval Log Persistence

- [ ] `SessionStorage` extension: persist all approval records (including processed ones)
- [ ] VS Code Webview: new "Approval History" tab
- [ ] Android: approval history view entry point
- [ ] Approval records include: request time, response time, responding client, decision, timeout info

#### Task 12: Approval Card Type Extension

- [ ] Support beyond Claude Code `control_request`:
  - Codex high-risk operation confirmations
  - agent-host's own sensitive operations (unbind device, stop service)
  - File system operation interception (when file monitoring is integrated)
- [ ] Unified approval card rendering template, adaptable to different approval types

---

## 4. Key Interface Design

### 4.1 AgentAdapter Interface Extension

```typescript
// agent-host/src/sessions/sessionManager.ts

export interface ApprovalCallback {
  /** Request approval, returns Promise awaiting the decision */
  requestApproval(input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    reason?: string;
    risk: "low" | "medium" | "high" | "critical";
  }): Promise<{ decision: "approve" | "deny"; message?: string }>;
}

export interface AgentAdapter {
  // ... existing methods ...
  
  /** Set approval callback, called by SessionManager when creating a session */
  setApprovalCallback?(callback: ApprovalCallback): void;
}
```

### 4.2 ClaudeCodeClient Options Extension

```typescript
// agent-host/src/claude/claudeCodeClient.ts

export interface ClaudeCodeClientOptions {
  cwd: string;
  onOutput: (stream: "stdout" | "stderr", text: string) => void;
  onExit: (exitCode: number) => void;
  
  /** Approval mode */
  approvalMode?: "auto" | "manual" | "whitelist";
  /** Approval callback (required when approvalMode is "manual") */
  onApprovalRequired?: (request: {
    requestId: string;
    toolName: string;
    input: Record<string, unknown>;
    reason?: string;
  }) => Promise<{ decision: "allow" | "deny"; message?: string }>;
  /** Allowlisted tool names (effective when approvalMode is "whitelist") */
  autoApproveTools?: string[];
}
```

### 4.3 Approval Card UI Data Model (Webview → Backend Messages)

```typescript
// Webview postMessage type extension
interface ApprovalActionMessage {
  command: "respondApproval";
  approvalId: string;
  decision: "approve" | "deny";
}

// Backend → Webview approval state update
interface ApprovalStateUpdate {
  type: "approval.update";
  approvals: Array<{
    approvalId: string;
    sessionId: string;
    risk: "low" | "medium" | "high" | "critical";
    toolName: string;
    summary: string;
    details: string;
    status: "pending" | "approved" | "denied" | "expired";
    createdAt: string;
    timeoutSeconds: number;
    remainingSeconds: number;
  }>;
}
```

---

## 5. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude Code times out while waiting for approval | Session lost | Set reasonable `timeoutSeconds`; Claude Code has its own timeout; approval timeout should be slightly shorter |
| Race condition from multi-client simultaneous responses | Indeterminate approval result | Status check in `respondApproval` + in-memory lock (sufficient for single-host scenarios) |
| Approval Promise memory leak | Unresolved approvals hang permanently | Mandatory timeout mechanism + periodic Map cleanup |
| High-frequency tool calls flooding approval cards | Poor UX | Allowlist auto-approve common safe tools + approval card grouping/collapse |
| Network disconnect prevents approval delivery | Agent stuck | Auto-sync pending approvals on WebSocket reconnect; timeout fallback |

---

## 6. File Overview

| Module | File | Change Type |
|--------|------|-------------|
| Protocol | `protocol/src/index.ts` | Extension |
| Agent Host | `agent-host/src/claude/claudeCodeClient.ts` | **Refactor** |
| Agent Host | `agent-host/src/claude/claudeCodeClient.test.ts` | New tests |
| Agent Host | `agent-host/src/adapters/claudeCodeAdapter.ts` | Modify |
| Agent Host | `agent-host/src/adapters/claudeCodeAdapter.test.ts` | Update tests |
| Agent Host | `agent-host/src/sessions/sessionManager.ts` | Extension |
| Agent Host | `agent-host/src/sessions/sessionManager.test.ts` | Update tests |
| Agent Host | `agent-host/src/server.ts` | Minor adjustments |
| VS Code | `vscode-extension/src/webview.ts` | **New approval card UI** |
| VS Code | `vscode-extension/src/webview.test.ts` | New tests |
| VS Code | `vscode-extension/src/hostController.ts` | Modify |
| VS Code | `vscode-extension/src/hostClient.ts` | Modify |
| Android | `android/.../MainActivity.kt` | Minor adjustments |
| Android | `android/.../ConsoleViewModel.kt` | Minor adjustments |

---

## 7. Milestone Estimates

| Phase | Content | Key Deliverables | Estimated Effort |
|-------|---------|-----------------|------------------|
| 2.0a | Core pipeline | Protocol extension + ClaudeCodeClient refactor + Webview approval UI | Large |
| 2.0b | Experience enhancements | Push notifications + countdown timer + policy config | Medium |
| 2.0c | Approval history | Persistence + history view + type extension | Small |
