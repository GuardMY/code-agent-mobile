# VS Code Single Host Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the VS Code extension reuse a single local host process across windows and auto-sync host status plus sessions.

**Architecture:** The extension will probe the local host dashboard as the source of truth before spawning a process. The host server will expose loopback-only dashboard discovery plus a stop control route so any window can discover and stop the shared host.

**Tech Stack:** TypeScript, VS Code extension API, Fastify, Vitest

---

### Task 1: Add host-server coverage for shared local discovery

**Files:**
- Modify: `agent-host/src/server.test.ts`
- Modify: `agent-host/src/server.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("allows loopback status discovery without the pairing token", async () => {
  // request /status with request.ip = 127.0.0.1 and expect 200
});

it("rejects non-loopback status discovery without the pairing token", async () => {
  // request /status with request.ip = 192.168.1.20 and expect 401
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace agent-host -- server.test.ts`
Expected: FAIL because `/status` still requires the pairing token.

- [ ] **Step 3: Write minimal implementation**

```ts
if (request.url === "/status" && isLoopbackRequest(request)) {
  return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace agent-host -- server.test.ts`
Expected: PASS

### Task 2: Add a host stop control path

**Files:**
- Modify: `agent-host/src/server.test.ts`
- Modify: `agent-host/src/server.ts`
- Modify: `agent-host/src/cli.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("accepts a stop request and calls the configured host stop handler", async () => {
  // POST /host/control with command stop and expect the hook to run
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace agent-host -- server.test.ts`
Expected: FAIL because `/host/control` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
app.post("/host/control", async (request, reply) => {
  const body = controlRequestSchema.parse(request.body);
  if (body.command === "stop") {
    await options.stopHost?.();
  }
  return reply.code(202).send({ ok: true });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace agent-host -- server.test.ts`
Expected: PASS

### Task 3: Reuse existing host from the extension

**Files:**
- Modify: `vscode-extension/src/hostController.test.ts`
- Modify: `vscode-extension/src/hostController.ts`
- Modify: `vscode-extension/src/extension.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("reuses an existing local host instead of spawning a new process", async () => {
  // controller start should skip spawn when probe finds a running host
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- hostController.test.ts`
Expected: FAIL because start always spawns a new process.

- [ ] **Step 3: Write minimal implementation**

```ts
const existing = await probeLocalHostDashboard(...);
if (existing.reachable) {
  this.status = "running";
  return { mode: "reused", dashboard: existing.status };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- hostController.test.ts`
Expected: PASS

### Task 4: Sync extension state from the shared host dashboard

**Files:**
- Modify: `vscode-extension/src/extension.ts`
- Add or Modify: `vscode-extension/src/extension.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("updates pairing state from a discovered dashboard payload", async () => {
  // refresh should adopt lanEnabled, host, port, and pairingJson from dashboard
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: FAIL because refresh only uses local in-memory state.

- [ ] **Step 3: Write minimal implementation**

```ts
if (dashboard?.reachable) {
  syncStateFromDashboard(state, dashboard.status);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: PASS

### Task 5: Verify, package, and review docs

**Files:**
- Modify: `docs/superpowers/specs/2026-07-06-vscode-single-host-reuse-design.md`
- Modify: `docs/superpowers/specs/2026-07-06-vscode-single-host-reuse-design.zh-CN.md`
- Modify: `docs/superpowers/plans/2026-07-06-vscode-single-host-reuse.md`

- [ ] **Step 1: Run focused tests**

Run: `npm test --workspace agent-host -- server.test.ts`
Expected: PASS

Run: `npm test --workspace vscode-extension -- hostController.test.ts extension.test.ts`
Expected: PASS

- [ ] **Step 2: Run the VS Code extension package build**

Run: `npm run package:extension`
Expected: PASS and a `.vsix` file under `vscode-extension/`

- [ ] **Step 3: Check docs and final diff**

Run: `git diff -- docs/superpowers/specs/2026-07-06-vscode-single-host-reuse-design.md docs/superpowers/specs/2026-07-06-vscode-single-host-reuse-design.zh-CN.md docs/superpowers/plans/2026-07-06-vscode-single-host-reuse.md`
Expected: bilingual docs match the implemented behavior.
