# VS Code 单 Host 复用实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 VS Code 扩展在多个窗口之间复用同一个本地 host 进程，并自动同步 host 状态与 session 列表。

**Architecture:** 扩展在启动进程前先探测本地 host dashboard，并以它作为状态真源。host 端补充仅限 loopback 的 dashboard 发现能力和 stop 控制接口，使任意窗口都能发现并停止这个共享 host。

**Tech Stack:** TypeScript、VS Code 扩展 API、Fastify、Vitest

---

### Task 1: 为共享本地发现补充 host server 测试

**Files:**
- Modify: `agent-host/src/server.test.ts`
- Modify: `agent-host/src/server.ts`

- [ ] **Step 1: 先写失败测试**

```ts
it("allows loopback status discovery without the pairing token", async () => {
  // 使用 request.ip = 127.0.0.1 请求 /status，期望 200
});

it("rejects non-loopback status discovery without the pairing token", async () => {
  // 使用 request.ip = 192.168.1.20 请求 /status，期望 401
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test --workspace agent-host -- server.test.ts`
Expected: FAIL，因为 `/status` 仍然要求 pairing token。

- [ ] **Step 3: 编写最小实现**

```ts
if (request.url === "/status" && isLoopbackRequest(request)) {
  return;
}
```

- [ ] **Step 4: 再次运行测试确认通过**

Run: `npm test --workspace agent-host -- server.test.ts`
Expected: PASS

### Task 2: 增加 host stop 控制接口

**Files:**
- Modify: `agent-host/src/server.test.ts`
- Modify: `agent-host/src/server.ts`
- Modify: `agent-host/src/cli.ts`

- [ ] **Step 1: 先写失败测试**

```ts
it("accepts a stop request and calls the configured host stop handler", async () => {
  // POST /host/control，command=stop，并断言 stop hook 被调用
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test --workspace agent-host -- server.test.ts`
Expected: FAIL，因为 `/host/control` 还不存在。

- [ ] **Step 3: 编写最小实现**

```ts
app.post("/host/control", async (request, reply) => {
  const body = controlRequestSchema.parse(request.body);
  if (body.command === "stop") {
    await options.stopHost?.();
  }
  return reply.code(202).send({ ok: true });
});
```

- [ ] **Step 4: 再次运行测试确认通过**

Run: `npm test --workspace agent-host -- server.test.ts`
Expected: PASS

### Task 3: 在扩展中复用已有 host

**Files:**
- Modify: `vscode-extension/src/hostController.test.ts`
- Modify: `vscode-extension/src/hostController.ts`
- Modify: `vscode-extension/src/extension.ts`

- [ ] **Step 1: 先写失败测试**

```ts
it("reuses an existing local host instead of spawning a new process", async () => {
  // 当 probe 发现已有 host 时，controller start 不应再调用 spawn
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test --workspace vscode-extension -- hostController.test.ts`
Expected: FAIL，因为 start 当前总会 spawn 新进程。

- [ ] **Step 3: 编写最小实现**

```ts
const existing = await probeLocalHostDashboard(...);
if (existing.reachable) {
  this.status = "running";
  return { mode: "reused", dashboard: existing.status };
}
```

- [ ] **Step 4: 再次运行测试确认通过**

Run: `npm test --workspace vscode-extension -- hostController.test.ts`
Expected: PASS

### Task 4: 按共享 host dashboard 同步扩展状态

**Files:**
- Modify: `vscode-extension/src/extension.ts`
- Add or Modify: `vscode-extension/src/extension.test.ts`

- [ ] **Step 1: 先写失败测试**

```ts
it("updates pairing state from a discovered dashboard payload", async () => {
  // refresh 应按 dashboard 同步 lanEnabled、host、port 和 pairingJson
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: FAIL，因为 refresh 当前只依赖本地内存状态。

- [ ] **Step 3: 编写最小实现**

```ts
if (dashboard?.reachable) {
  syncStateFromDashboard(state, dashboard.status);
}
```

- [ ] **Step 4: 再次运行测试确认通过**

Run: `npm test --workspace vscode-extension -- extension.test.ts`
Expected: PASS

### Task 5: 验证、打包并检查文档

**Files:**
- Modify: `docs/superpowers/specs/2026-07-06-vscode-single-host-reuse-design.md`
- Modify: `docs/superpowers/specs/2026-07-06-vscode-single-host-reuse-design.zh-CN.md`
- Modify: `docs/superpowers/plans/2026-07-06-vscode-single-host-reuse.md`

- [ ] **Step 1: 运行聚焦测试**

Run: `npm test --workspace agent-host -- server.test.ts`
Expected: PASS

Run: `npm test --workspace vscode-extension -- hostController.test.ts extension.test.ts`
Expected: PASS

- [ ] **Step 2: 运行 VS Code 扩展打包构建**

Run: `npm run package:extension`
Expected: PASS，并在 `vscode-extension/` 下生成 `.vsix`

- [ ] **Step 3: 检查文档和最终 diff**

Run: `git diff -- docs/superpowers/specs/2026-07-06-vscode-single-host-reuse-design.md docs/superpowers/specs/2026-07-06-vscode-single-host-reuse-design.zh-CN.md docs/superpowers/plans/2026-07-06-vscode-single-host-reuse.md`
Expected: 中英双语文档与最终实现保持一致。
