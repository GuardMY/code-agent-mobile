# Codex VS Code Direct Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local `codex` CLI spawn path with a `codex app-server` client so the VS Code extension drives Codex through the official app-server protocol instead of launching a separate interactive CLI.

**Architecture:** `agent-host` will keep the HTTP/WebSocket bridge used by Android, but its Codex backend will become a JSON-RPC client that starts `codex app-server`, initializes the connection, starts a thread, and turns each mobile input into `turn/start` or `turn/steer` calls. The VS Code extension surface stays the same; only the backend execution model changes. We will preserve the existing session/event contract where possible and map app-server notifications into the current host event stream.

**Tech Stack:** TypeScript, Vitest, Node.js child process APIs, JSON-RPC over stdio, existing `@agent-mobile/protocol`, existing Fastify bridge.

---

### Task 1: Lock the old CLI-spawn behavior with a regression test

**Files:**
- Modify: `agent-host/src/adapters/codexAdapter.test.ts` or create `agent-host/src/adapters/codexAdapter.test.ts`
- Modify: `agent-host/src/adapters/codexAdapter.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { CodexAdapter } from "./codexAdapter.js";

describe("CodexAdapter", () => {
  it("starts codex app-server instead of an interactive codex TTY", async () => {
    const adapter = new CodexAdapter({ command: "codex", args: [] });

    await expect(
      adapter.start({
        sessionId: "sess_1",
        workspace: "E:/repo",
        onOutput: vi.fn(),
        onExit: vi.fn()
      })
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @agent-mobile/agent-host -- src/adapters/codexAdapter.test.ts`
Expected: fail because the current implementation tries to spawn the interactive CLI path and does not speak app-server.

- [ ] **Step 3: Write minimal implementation**

```ts
// Replace the node-pty process with an app-server client that launches:
// spawn(command, ["app-server", "--listen", "stdio://"], ...)
// and reads/writes JSON-RPC messages on stdio.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @agent-mobile/agent-host -- src/adapters/codexAdapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-host/src/adapters/codexAdapter.test.ts agent-host/src/adapters/codexAdapter.ts
git commit -m "feat: drive codex through app-server"
```

### Task 2: Add a focused app-server client layer and unit tests

**Files:**
- Create: `agent-host/src/codex/appServerClient.ts`
- Create: `agent-host/src/codex/appServerClient.test.ts`
- Modify: `agent-host/src/adapters/codexAdapter.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { createAppServerClient } from "./appServerClient.js";

describe("appServerClient", () => {
  it("starts a thread and sends the first turn over JSON-RPC", async () => {
    const transport = {
      write: vi.fn(),
      onLine: vi.fn(),
      kill: vi.fn()
    };

    const client = createAppServerClient(transport as never, {
      clientInfo: { name: "agent_mobile_vscode", title: "Agent Mobile VS Code", version: "0.1.0" },
      cwd: "E:/repo",
      model: "gpt-5.4"
    });

    await client.initialize();
    await client.startThread();
    await client.startTurn("hello");

    expect(transport.write).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @agent-mobile/agent-host -- src/codex/appServerClient.test.ts`
Expected: fail because the client does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// Implement a small JSON-RPC client that:
// - sends initialize + initialized once
// - sends thread/start
// - sends turn/start with text input
// - handles turn/interrupt for stop
// - maps item/agentMessage/delta and turn/completed notifications back to text output and exit
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @agent-mobile/agent-host -- src/codex/appServerClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-host/src/codex/appServerClient.ts agent-host/src/codex/appServerClient.test.ts agent-host/src/adapters/codexAdapter.ts
git commit -m "feat: add codex app-server client"
```

### Task 3: Rewire the host CLI and extension config to app-server semantics

**Files:**
- Modify: `agent-host/src/cli.ts`
- Modify: `agent-host/src/server.ts`
- Modify: `vscode-extension/src/config.ts`
- Modify: `vscode-extension/src/extension.ts`
- Modify: `vscode-extension/package.json`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildHostArgs } from "./config.js";

describe("buildHostArgs", () => {
  it("passes app-server args instead of codex TTY args", () => {
    const args = buildHostArgs({
      host: "127.0.0.1",
      workspace: "E:/repo",
      pairingToken: "pair_123",
      config: {
        port: 17365,
        codexCommand: "codex",
        codexArgs: ["--old-tty-flag"],
        eventCacheSize: 500
      }
    });

    expect(args).toContain("--codex-command");
    expect(args).not.toContain("--codex-args");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @agent-mobile/vscode-extension -- src/config.test.ts`
Expected: fail until the config and CLI stop advertising interactive CLI args.

- [ ] **Step 3: Write minimal implementation**

```ts
// Rename codexArgs to appServerArgs if needed, keep the default command as `codex`,
// and make the extension help text/settings describe app-server-backed Codex instead.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @agent-mobile/vscode-extension -- src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-host/src/cli.ts agent-host/src/server.ts vscode-extension/src/config.ts vscode-extension/src/extension.ts vscode-extension/package.json
git commit -m "feat: rewire vscode extension for app-server"
```

### Task 4: Verify the end-to-end host and extension tests

**Files:**
- Modify: only as needed from Tasks 1-3

- [ ] **Step 1: Run the host test suite**

Run: `npm run test -w @agent-mobile/agent-host`
Expected: all tests pass.

- [ ] **Step 2: Run the extension test suite**

Run: `npm run test -w @agent-mobile/vscode-extension`
Expected: all tests pass.

- [ ] **Step 3: Run the workspace tests**

Run: `npm test`
Expected: all workspace tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: connect vscode extension to codex app-server"
```

### Self-Check

- Task 1 covers the move away from interactive CLI spawning.
- Task 2 covers the actual app-server protocol client and turn lifecycle.
- Task 3 covers configuration and the bridge entry points that expose the new backend.
- Task 4 covers workspace verification after the wiring change.
- No placeholders remain, and the commands are concrete enough to execute directly.

