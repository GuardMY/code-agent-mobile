# 2.0 开发路线：审批卡系统

> **目标受众：** 开发者、产品决策者
> **状态：** 草案

**目标：** 将桌面 Agent 对话中的人工决策环节（工具调用确认、命令执行许可、高风险操作审批）统一建模为"审批卡"，通过 VS Code 插件 UI 和 Android App 双端进行操作，实现从"终端阻塞等待"到"异步多端审批"的体验升级。

**架构：** 改动横跨 protocol、agent-host、vscode-extension、android 四个模块。核心思路是将 Claude Code 的 `control_request` 事件从 `ClaudeCodeClient` 内部的 auto-allow/deny 逻辑中解耦，接入 SessionManager 的审批管道，通过 WebSocket 实时广播到所有已连接客户端。

**技术栈：** TypeScript (protocol/agent-host/vscode-extension)、Kotlin/Jetpack Compose (Android)、WebSocket、Fastify

---

## 一、现状分析

### 1.1 已有的审批基础设施

| 模块 | 已有能力 | 状态 |
|------|----------|------|
| **protocol** | `ApprovalRequest` schema、`approval.required/approve/deny` 消息类型、`ApprovalDecision`/`ApprovalStatus` 枚举 | ✅ 完整 |
| **agent-host** | `GET /approvals`、`POST /approvals/:id/respond` API、`SessionManager.requestApproval()`/`respondApproval()` 方法 | ✅ 完整 |
| **agent-host** | `approval.required` 事件通过 WebSocket `/stream` 广播 | ✅ 完整 |
| **Android** | `ConsoleScreen` 中的审批卡 UI（批准/拒绝按钮）、`respondApproval()` API 调用 | ✅ 完整 |
| **VS Code** | Webview 事件传递通道就绪 | ⚠️ 缺少审批卡 UI |

### 1.2 关键断点

| 断点 | 位置 | 问题 |
|------|------|------|
| **control_request 未接入审批** | [claudeCodeClient.ts](../../../agent-host/src/claude/claudeCodeClient.ts) L273-287 | `handleControlRequest()` 直接 auto-allow 或 auto-deny，从未调用 `SessionManager.requestApproval()` |
| **ClaudeCodeClient 无外部审批回调** | [claudeCodeAdapter.ts](../../../agent-host/src/adapters/claudeCodeAdapter.ts) | Adapter 的 `onOutput`/`onExit` 回调模型不适用于需要"等待外部响应"的审批场景 |
| **VS Code Webview 无审批 UI** | [webview.ts](../../../vscode-extension/src/webview.ts) | 会话详情面板只展示消息流，没有审批卡渲染逻辑 |
| **无推送通知** | agent-host | 审批请求只通过 WebSocket 广播，设备在后台时无法感知 |

### 1.3 当前数据流（问题路径）

```
Claude Code (stdio)
  │ control_request { tool_name: "Bash", input: { command: "rm -rf /" } }
  ▼
ClaudeCodeClient.handleControlRequest()
  │ autoAllowTools = true? → sendControlResponse("allow")   ← 直接放行！
  │ autoAllowTools = false? → sendControlResponse("deny")    ← 直接拒绝！
  ▼
（审批系统从未介入）
```

---

## 二、2.0 目标架构

### 2.1 目标数据流

```
Claude Code (stdio)
  │ control_request
  ▼
ClaudeCodeClient.handleControlRequest()
  │ 不再 auto-allow/deny
  │ 调用 options.onApprovalRequired({ requestId, toolName, input, reason })
  ▼
ClaudeCodeAdapter
  │ 将审批请求转发给 SessionManager
  ▼
SessionManager.requestApproval()
  │ 创建 ApprovalRequest (status: "pending")
  │ 广播 approval.required 事件到所有 WebSocket 客户端
  │ 返回 Promise<ApprovalDecision>（等待任意端响应）
  ├──► VS Code Webview ── 审批卡 UI ──► 用户点击 [批准]/[拒绝]
  │       │ POST /approvals/:id/respond
  │       ▼
  ├──► Android App ──── 审批卡 UI ──► 用户点击 [批准]/[拒绝]
  │       │ POST /approvals/:id/respond
  │       ▼
  ▼
SessionManager.respondApproval()
  │ 更新 ApprovalRequest 状态
  │ resolve 之前返回的 Promise
  │ 广播 approval.approve / approval.deny 事件
  ▼
ClaudeCodeClient.sendControlResponse(requestId, "allow" | "deny")
  │ 写入 stdin → Claude Code
  ▼
Claude Code (继续执行)
```

### 2.2 核心设计原则

1. **审批与 Agent 解耦**：`AgentAdapter` 不需要理解审批细节，只需提供 `onApprovalRequired` 回调
2. **先到先得**：多端同时展示审批卡，第一个响应生效，后续返回 409
3. **超时安全**：每个审批请求带 `timeoutSeconds`，超时自动拒绝，防止 Agent 永久挂起
4. **Promise 桥接**：`SessionManager.requestApproval()` 返回 Promise，将异步的人工审批转化为 await-able 的结果
5. **策略可配**：支持白名单（特定工具自动批准）、黑名单（特定模式自动拒绝）、风险等级阈值

---

## 三、分阶段实施计划

### Phase 2.0a — 审批卡 MVP（核心链路）

**目标：** Claude Code 工具确认 → 审批卡 → 人工响应 → 继续执行

#### Task 1: Protocol 扩展

**文件：** `protocol/src/index.ts`

- [ ] 为 `ApprovalRequest` 增加 `details` 字段（展示命令内容、文件路径等详细信息）
- [ ] 为 `ApprovalRequest` 增加 `respondedBy` 字段（记录响应来源：`"vscode" | "android" | "auto" | "timeout"`）
- [ ] 为 `ApprovalRequest` 增加 `respondedAt` 字段
- [ ] 新增 `approval.expired` 消息类型
- [ ] 更新相关测试

#### Task 2: ClaudeCodeClient 审批桥接

**文件：** `agent-host/src/claude/claudeCodeClient.ts`

- [ ] 重构 `handleControlRequest()`：移除 auto-allow/deny 逻辑
- [ ] 新增 `onApprovalRequired` 回调选项到 `ClaudeCodeClientOptions`
- [ ] 新增 `approveControlRequest(requestId)` 和 `denyControlRequest(requestId)` 方法
- [ ] 实现审批 Promise 挂起：`handleControlRequest` 返回一个在外部调用 `approveControlRequest`/`denyControlRequest` 时才 resolve 的 Promise
- [ ] 更新测试以覆盖审批流程

#### Task 3: SessionManager 审批 Promise 绑定

**文件：** `agent-host/src/sessions/sessionManager.ts`

- [ ] `requestApproval()` 返回 `Promise<ApprovalDecision>` + `ApprovalRequest`
- [ ] 内部维护 `Map<approvalId, { resolve, reject, timeout }>`
- [ ] `respondApproval()` 触发对应的 resolve/reject
- [ ] 实现超时自动拒绝：`setTimeout` 到期后自动调用 `respondApproval(id, "deny")`，状态标记为 `"expired"`
- [ ] 实现先到先得：`respondApproval()` 对已处理的审批返回错误

#### Task 4: ClaudeCodeAdapter 修改

**文件：** `agent-host/src/adapters/claudeCodeAdapter.ts`

- [ ] 传递 `onApprovalRequired` 回调给 `ClaudeCodeClient`
- [ ] 将 `onApprovalRequired` 事件桥接到 SessionManager
- [ ] `autoAllowTools` 选项改为 `approvalMode: "auto" | "manual" | "whitelist"`
- [ ] 更新测试

#### Task 5: VS Code Webview 审批卡 UI

**文件：** `vscode-extension/src/webview.ts`、`vscode-extension/src/hostController.ts`

- [ ] Webview 新增审批卡 CSS 样式（卡片布局、风险等级颜色标识、倒计时进度条）
- [ ] 渲染待审批卡片：风险等级、工具名、操作摘要、详细信息、剩余时间
- [ ] 批准/拒绝按钮 → `vscode.postMessage()` → `hostController.respondApproval()`
- [ ] 支持多条审批卡同时展示（按时间排序）
- [ ] 审批已处理后的动画移除
- [ ] 自动滚动时审批卡保持在可视区域

#### Task 6: 集成测试与端到端验证

- [ ] 启动 agent-host（`approvalMode: "manual"`）
- [ ] VS Code 插件连接到 host
- [ ] Android App 连接到 host
- [ ] 通过 Claude Code 会话触发工具调用
- [ ] 验证审批卡同时出现在 VS Code Webview 和 Android
- [ ] 验证任一端的批准/拒绝生效
- [ ] 验证超时自动拒绝
- [ ] 验证先到先得（第二端响应返回 409）

---

### Phase 2.0b — 体验增强

#### Task 7: 推送通知

**Android：**
- [ ] 利用 Android Notification API，当 WebSocket 收到 `approval.required` 且 app 不在前台时弹出通知
- [ ] 通知包含：风险等级、操作名称、摘要
- [ ] 通知操作按钮：批准 / 拒绝（PendingIntent → BroadcastReceiver → API 调用）
- [ ] 通知优先级设为 HIGH（让用户及时看到）

**VS Code：**
- [ ] 利用 `vscode.window.showInformationMessage` 弹出审批对话框
- [ ] 对话框按钮：批准 / 拒绝 / 查看详情
- [ ] 点击"查看详情"切换到 Agent Mobile webview 面板

#### Task 8: 审批超时倒计时

- [ ] VS Code Webview：卡片上显示剩余秒数倒计时
- [ ] Android：卡片上显示倒计时进度条
- [ ] 超时前 5 秒高亮闪烁提醒
- [ ] 超时后卡片变为"已过期"状态并自动消失

#### Task 9: 审批策略配置

**文件：** `agent-host/src/claude/claudeCodeClient.ts`（新增 `ApprovalPolicy`）

- [ ] 白名单模式：`autoApprove: ["Read", "Glob", "Grep"]`
- [ ] 黑名单模式：`alwaysDeny: [{ tool: "Bash", pattern: "rm -rf" }]`
- [ ] 风险阈值：`minRiskForApproval: "medium"`（low 自动批准）
- [ ] 配置来源：agent-host CLI 参数 → VS Code 设置 → 默认值
- [ ] 策略评估在 `handleControlRequest` 中优先于审批流程

#### Task 10: 审批卡分组与批量处理

- [ ] 同一会话的多个审批卡支持"全部批准"操作
- [ ] 审批卡按风险等级分组显示

---

### Phase 2.0c — 审批历史与审计

#### Task 11: 审批日志持久化

- [ ] `SessionStorage` 扩展：持久化所有审批记录（包括已处理的）
- [ ] VS Code Webview 新增"审批历史"标签页
- [ ] Android 新增审批历史查看入口
- [ ] 审批记录包含：请求时间、响应时间、响应端、决策、超时信息

#### Task 12: 审批卡类型扩展

- [ ] 不仅是 Claude Code 的 `control_request`，还支持：
  - Codex 的高风险操作确认
  - agent-host 自身的敏感操作（解绑设备、停止服务）
  - 文件系统操作拦截（当集成文件监控时）
- [ ] 统一的审批卡渲染模板，适配不同类型的审批

---

## 四、关键接口设计

### 4.1 AgentAdapter 接口扩展

```typescript
// agent-host/src/sessions/sessionManager.ts

export interface ApprovalCallback {
  /** 请求审批，返回 Promise 等待审批结果 */
  requestApproval(input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    reason?: string;
    risk: "low" | "medium" | "high" | "critical";
  }): Promise<{ decision: "approve" | "deny"; message?: string }>;
}

export interface AgentAdapter {
  // ... existing methods ...
  
  /** 设置审批回调，由 SessionManager 在创建 session 时调用 */
  setApprovalCallback?(callback: ApprovalCallback): void;
}
```

### 4.2 ClaudeCodeClient 选项扩展

```typescript
// agent-host/src/claude/claudeCodeClient.ts

export interface ClaudeCodeClientOptions {
  cwd: string;
  onOutput: (stream: "stdout" | "stderr", text: string) => void;
  onExit: (exitCode: number) => void;
  
  /** 审批模式 */
  approvalMode?: "auto" | "manual" | "whitelist";
  /** 审批回调（approvalMode 为 manual 时必需） */
  onApprovalRequired?: (request: {
    requestId: string;
    toolName: string;
    input: Record<string, unknown>;
    reason?: string;
  }) => Promise<{ decision: "allow" | "deny"; message?: string }>;
  /** 白名单工具名列表（approvalMode 为 whitelist 时生效） */
  autoApproveTools?: string[];
}
```

### 4.3 审批卡 UI 数据模型（Webview → 后端消息）

```typescript
// Webview postMessage 类型扩展
interface ApprovalActionMessage {
  command: "respondApproval";
  approvalId: string;
  decision: "approve" | "deny";
}

// 后端 → Webview 的审批状态更新
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

## 五、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Claude Code 在等待审批时超时退出 | 会话丢失 | 合理设置 `timeoutSeconds`，Claude Code 侧也有自己的超时；审批超时应略短于 Claude 超时 |
| 多端同时响应导致竞态 | 审批结果不确定 | `respondApproval` 加状态检查 + 分布式锁（内存级即可，单 host 场景） |
| 审批 Promise 内存泄漏 | 未响应的审批永久挂起 | 强制超时机制 + Map 定期清理 |
| 高频工具调用导致审批卡刷屏 | 用户体验差 | 白名单自动批准常见安全工具 + 审批卡分组折叠 |
| 网络断开导致审批无法送达 | Agent 卡住 | WebSocket 重连后自动同步 pending 审批；超时兜底 |

---

## 六、相关文件总览

| 模块 | 文件 | 变更类型 |
|------|------|----------|
| Protocol | `protocol/src/index.ts` | 扩展 |
| Agent Host | `agent-host/src/claude/claudeCodeClient.ts` | **重构** |
| Agent Host | `agent-host/src/claude/claudeCodeClient.test.ts` | 新增测试 |
| Agent Host | `agent-host/src/adapters/claudeCodeAdapter.ts` | 修改 |
| Agent Host | `agent-host/src/adapters/claudeCodeAdapter.test.ts` | 更新测试 |
| Agent Host | `agent-host/src/sessions/sessionManager.ts` | 扩展 |
| Agent Host | `agent-host/src/sessions/sessionManager.test.ts` | 更新测试 |
| Agent Host | `agent-host/src/server.ts` | 微调 |
| VS Code | `vscode-extension/src/webview.ts` | **新增审批卡 UI** |
| VS Code | `vscode-extension/src/webview.test.ts` | 新增测试 |
| VS Code | `vscode-extension/src/hostController.ts` | 修改 |
| VS Code | `vscode-extension/src/hostClient.ts` | 修改 |
| Android | `android/.../MainActivity.kt` | 微调 |
| Android | `android/.../ConsoleViewModel.kt` | 微调 |

---

## 七、里程碑预估

| 阶段 | 内容 | 核心交付物 | 预估工作量 |
|------|------|-----------|-----------|
| 2.0a | 核心链路打通 | Protocol 扩展 + ClaudeCodeClient 重构 + Webview 审批 UI | 大 |
| 2.0b | 体验增强 | 推送通知 + 超时倒计时 + 策略配置 | 中 |
| 2.0c | 审批历史 | 持久化 + 历史查看 + 类型扩展 | 小 |
