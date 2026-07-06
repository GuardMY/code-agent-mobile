# VS Code 会话详情自动滚动实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 调整 VS Code 会话详情视图，使其在首次打开和用户发送消息后跟随最新消息，同时只在用户原本位于底部时跟随 agent 回复。

**架构：** 改动保持在 VS Code webview 层。extension 继续提供有序的会话事件，webview 脚本负责跟踪用户是否接近底部，并在重渲染后决定是否滚动。

**技术栈：** TypeScript、VS Code webview UI script、Vitest

---

### 任务 1：覆盖当前会话详情渲染规则

**文件：**
- 修改：`vscode-extension/src/webview.test.ts`
- 修改：`vscode-extension/src/webview.ts`

- [ ] **步骤 1：编写失败测试**

```ts
it("renders the session message container with a stable hook for auto-scroll", async () => {
  // 断言选中会话详情 HTML 中包含消息容器 id 或 data 属性
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`npm test --workspace vscode-extension -- webview.test.ts`
预期：FAIL，因为消息列表还没有暴露自动滚动所需的稳定钩子。

- [ ] **步骤 3：编写最小实现**

```ts
return `<div id="sessionMessages" class="session-console-output">...</div>`;
```

- [ ] **步骤 4：运行测试并确认通过**

运行：`npm test --workspace vscode-extension -- webview.test.ts`
预期：PASS

### 任务 2：补充浏览器侧自动滚动失败测试

**文件：**
- 修改：`vscode-extension/src/webview.test.ts`
- 修改：`vscode-extension/src/webview.ts`

- [ ] **步骤 1：编写失败测试**

```ts
it("scrolls to bottom when a session is first opened", async () => {
  // 渲染并模拟会话首次展示，断言 scrollTop 移动到底部
});

it("scrolls to bottom after the user sends a message", async () => {
  // 模拟点击发送，并在重渲染后带入新的用户输入事件
});

it("follows agent output only when the view was already at the bottom", async () => {
  // 同时覆盖接近底部和不在底部两种情况
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`npm test --workspace vscode-extension -- webview.test.ts`
预期：FAIL，因为 webview 脚本还没有跟踪底部状态，也没有重渲染后的跟随规则。

- [ ] **步骤 3：编写最小实现**

```ts
const scrollStateBySession = new Map();
function isNearBottom(element) { ... }
function scrollToBottom(element) { ... }
```

- [ ] **步骤 4：运行测试并确认通过**

运行：`npm test --workspace vscode-extension -- webview.test.ts`
预期：PASS

### 任务 3：验证用户发送消息时的事件顺序

**文件：**
- 修改：`vscode-extension/src/extension.test.ts`
- 修改：`vscode-extension/src/extension.ts`

- [ ] **步骤 1：编写失败测试**

```ts
it("appends the local user input event before awaiting host delivery", async () => {
  // 断言会话事件列表会立即包含最新输入
});
```

- [ ] **步骤 2：运行测试并确认失败或确认现有行为**

运行：`npm test --workspace vscode-extension -- extension.test.ts`
预期：如果事件顺序退化则 FAIL，否则 PASS，表明无需改动生产代码。

- [ ] **步骤 3：如有需要，编写最小实现**

```ts
this.state.sessionEvents = [...this.state.sessionEvents, localInputEvent];
```

- [ ] **步骤 4：运行测试并确认通过**

运行：`npm test --workspace vscode-extension -- extension.test.ts`
预期：PASS

### 任务 4：最终验证与打包

**文件：**
- 修改：`docs/superpowers/specs/2026-07-06-vscode-session-detail-auto-scroll-design.md`
- 修改：`docs/superpowers/specs/2026-07-06-vscode-session-detail-auto-scroll-design.zh-CN.md`
- 修改：`docs/superpowers/plans/2026-07-06-vscode-session-detail-auto-scroll.md`

- [ ] **步骤 1：运行扩展聚焦测试**

运行：`npm test --workspace vscode-extension -- webview.test.ts extension.test.ts`
预期：PASS

- [ ] **步骤 2：打包 VS Code 插件**

运行：`npm run package:extension`
预期：PASS，并在 `vscode-extension/` 下生成 `.vsix` 文件

- [ ] **步骤 3：检查最终 diff**

运行：`git diff -- vscode-extension/src/webview.ts vscode-extension/src/webview.test.ts vscode-extension/src/extension.ts vscode-extension/src/extension.test.ts docs/superpowers/specs/2026-07-06-vscode-session-detail-auto-scroll-design.md docs/superpowers/specs/2026-07-06-vscode-session-detail-auto-scroll-design.zh-CN.md docs/superpowers/plans/2026-07-06-vscode-session-detail-auto-scroll.md`
预期：diff 与已确认的自动滚动规则以及双语文档一致。
