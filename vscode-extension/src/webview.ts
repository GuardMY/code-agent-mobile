import type { AgentCapabilitySummary, ClientType, DeviceSummary, SessionSummary } from "@agent-mobile/protocol";
import type { DashboardFetchResult } from "./hostController.js";
import type { SessionConsoleEvent } from "./hostClient.js";

export async function renderPairingHtml(input: {
  status: "stopped" | "starting" | "running";
  lanEnabled: boolean;
  pairingJson: string;
  qrSvg: string;
  dashboard?: DashboardFetchResult;
  selectedSessionId?: string;
  sessionEvents?: SessionConsoleEvent[];
  consoleError?: string;
}): Promise<string> {
  const escapedJson = escapeHtml(input.pairingJson);
  const dashboardHtml = renderDashboard(input);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      color-scheme: light dark;
      font-family: var(--vscode-font-family);
    }
    body {
      margin: 0;
      padding: 16px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .panel {
      display: grid;
      gap: 14px;
    }
    h2, h3, p {
      margin: 0;
    }
    h2 {
      font-size: 18px;
      font-weight: 650;
    }
    h3 {
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: ${input.status === "running" ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconQueued)"};
    }
    .section {
      display: grid;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .grid {
      display: grid;
      gap: 8px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-sideBar-background);
    }
    .session-row {
      width: 100%;
      color: var(--vscode-foreground);
      text-align: left;
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
    }
    .session-row.selected {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .label {
      font-weight: 600;
    }
    .muted {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .pill {
      flex: 0 0 auto;
      padding: 2px 6px;
      border-radius: 999px;
      font-size: 11px;
      color: var(--vscode-badge-foreground);
      background: var(--vscode-badge-background);
    }
    .danger {
      color: var(--vscode-errorForeground);
    }
    .qr {
      width: min(260px, 100%);
      padding: 12px;
      background: white;
    }
    .console {
      display: grid;
      gap: 8px;
    }
    .output {
      display: grid;
      gap: 6px;
      min-height: 120px;
      max-height: 320px;
      overflow: auto;
      padding: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .event {
      display: grid;
      gap: 2px;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 74px;
      resize: vertical;
      padding: 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      font-family: var(--vscode-font-family);
    }
    pre {
      overflow: auto;
      padding: 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    button {
      width: 100%;
      padding: 8px 10px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      border-radius: 4px;
      cursor: pointer;
    }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button:disabled {
      cursor: not-allowed;
      opacity: .55;
    }
  </style>
</head>
<body>
  <main class="panel">
    <h2>Agent Mobile</h2>
    <div class="status"><span class="dot"></span>${statusLabel(input.status)}</div>
    ${dashboardHtml}
    <div class="actions">
      <button data-command="enable">启用局域网</button>
      <button data-command="disable" class="secondary">停用局域网</button>
      <button data-command="refresh" class="secondary">刷新</button>
      <button data-command="copy" class="secondary">复制配对 JSON</button>
    </div>
    <section class="qr">${input.qrSvg}</section>
    <pre>${escapedJson}</pre>
    <p class="muted">局域网配对已${input.lanEnabled ? "启用" : "停用"}。</p>
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    for (const button of document.querySelectorAll("button[data-command]")) {
      button.addEventListener("click", () => {
        const command = button.dataset.command;
        if (command === "sendInput") {
          const textarea = document.querySelector("#sessionPrompt");
          vscode.postMessage({ command, sessionId: button.dataset.sessionId, text: textarea ? textarea.value : "" });
          if (textarea) textarea.value = "";
          return;
        }
        vscode.postMessage({ command, sessionId: button.dataset.sessionId });
      });
    }
  </script>
</body>
</html>`;
}

function renderDashboard(input: {
  status: "stopped" | "starting" | "running";
  lanEnabled: boolean;
  dashboard?: DashboardFetchResult;
  selectedSessionId?: string;
  sessionEvents?: SessionConsoleEvent[];
  consoleError?: string;
}): string {
  if (!input.dashboard) {
    return `<section class="section"><h3>服务</h3><p class="muted">刷新后将显示主机状态。</p></section>`;
  }
  if (!input.dashboard.reachable) {
    return `<section class="section"><h3>服务</h3><p class="danger">无法连接主机：${escapeHtml(input.dashboard.error)}</p></section>`;
  }

  const status = input.dashboard.status;
  const activeDevices = status.devices.filter((device) => !device.revokedAt);
  return [
    `<section class="section">
      <h3>服务</h3>
      <div class="row">
        <div>
          <div class="label">${escapeHtml(status.server.deviceName)} ${escapeHtml(status.server.version)}</div>
          <div class="muted">${escapeHtml(status.server.host)}:${status.server.port}</div>
        </div>
        <span class="pill">${status.server.lanEnabled ? "局域网已启用" : "仅本机"}</span>
      </div>
    </section>`,
    `<section class="section">
      <h3>${activeDevices.length === 0 ? "扫码连接第一台移动设备" : "添加设备"}</h3>
      <p class="muted">在 Android 应用、iOS 应用或微信小程序中使用下方二维码或配对 JSON。</p>
    </section>`,
    `<section class="section">
      <h3>移动设备</h3>
      <div class="grid">${renderDevices(status.devices)}</div>
    </section>`,
    `<section class="section">
      <h3>桌面 Agent</h3>
      <div class="grid">${status.agents.map(renderAgent).join("") || `<p class="muted">暂无 Agent 状态。</p>`}</div>
    </section>`,
    `<section class="section">
      <h3>Codex 会话</h3>
      <div class="grid">${renderSessions(status.sessions, input.selectedSessionId)}</div>
    </section>`,
    renderSessionConsole(status.sessions, input.selectedSessionId, input.sessionEvents ?? [], input.consoleError)
  ].join("");
}

function renderDevices(devices: DeviceSummary[]): string {
  if (devices.length === 0) {
    return `<p class="muted">尚未配对移动设备。</p>`;
  }
  return devices
    .map(
      (device) => `<div class="row">
        <div>
          <div class="label">${clientTypeLabel(device.clientType)} ${escapeHtml(device.deviceId)}</div>
          <div class="muted">配对时间：${escapeHtml(device.pairedAt)}</div>
          <div class="muted">令牌过期：${escapeHtml(device.accessTokenExpiresAt)}</div>
        </div>
        <span class="pill">${device.revokedAt ? "已撤销" : "活跃"}</span>
      </div>`
    )
    .join("");
}

function renderSessions(sessions: SessionSummary[], selectedSessionId?: string): string {
  if (sessions.length === 0) {
    return `<p class="muted">当前工作区没有可复用的 Codex 会话。</p>`;
  }
  return sessions
    .map((session) => {
      const selected = session.id === selectedSessionId;
      return `<button class="session-row${selected ? " selected" : ""}" data-command="selectSession" data-session-id="${escapeHtml(session.id)}">
        <div class="row">
          <div>
            <div class="label">${escapeHtml(session.id)}</div>
            <div class="muted">${escapeHtml(session.adapterId)} / ${escapeHtml(session.status)} / seq ${session.lastSeq}</div>
            <div class="muted">${escapeHtml(session.workspace)}</div>
          </div>
          <span class="pill">${escapeHtml(sessionStatusLabel(session.status))}</span>
        </div>
      </button>`;
    })
    .join("");
}

function renderSessionConsole(
  sessions: SessionSummary[],
  selectedSessionId: string | undefined,
  events: SessionConsoleEvent[],
  consoleError: string | undefined
): string {
  const selected = sessions.find((session) => session.id === selectedSessionId);
  const selectedEvents = events.filter((event) => event.sessionId === selectedSessionId);
  if (!selected) {
    return `<section class="section"><h3>会话详情</h3><p class="muted">选择一个 Codex 会话后查看输出并发送输入。</p></section>`;
  }
  return `<section class="section console">
    <h3>会话详情</h3>
    <div class="muted">${escapeHtml(selected.id)} / ${escapeHtml(selected.status)}</div>
    ${consoleError ? `<p class="danger">${escapeHtml(consoleError)}</p>` : ""}
    <div class="output">
      ${
        selectedEvents.length === 0
          ? `<p class="muted">暂无输出。刷新或发送一条输入后会显示流式结果。</p>`
          : selectedEvents
              .map(
                (event) => `<div class="event">
                  <div class="muted">#${event.seq} ${escapeHtml(event.type)}</div>
                  <div>${escapeHtml(event.text)}</div>
                </div>`
              )
              .join("")
      }
    </div>
    <textarea id="sessionPrompt" placeholder="输入要发送给 Codex 的内容"></textarea>
    <div class="actions">
      <button data-command="sendInput" data-session-id="${escapeHtml(selected.id)}" ${selected.status === "running" ? "" : "disabled"}>发送</button>
      <button data-command="stopSession" data-session-id="${escapeHtml(selected.id)}" class="secondary" ${
        selected.status === "running" ? "" : "disabled"
      }>停止</button>
      <button data-command="refreshSessions" class="secondary">刷新会话</button>
    </div>
  </section>`;
}

function renderAgent(agent: AgentCapabilitySummary): string {
  const sessionText =
    agent.latestSessionStatus === undefined
      ? `${agent.activeSessions} 个活跃会话`
      : `${agent.activeSessions} 个活跃会话，最近状态 ${sessionStatusLabel(agent.latestSessionStatus)}`;
  return `<div class="row">
    <div>
      <div class="label">${escapeHtml(agent.displayName)}</div>
      <div class="muted">${escapeHtml(sessionText)}</div>
    </div>
    <span class="pill">${availabilityLabel(agent.availability)}</span>
  </div>`;
}

function clientTypeLabel(type: ClientType): string {
  if (type === "android-app") {
    return "Android 应用";
  }
  if (type === "ios-app") {
    return "iOS 应用";
  }
  if (type === "wechat-mini-program") {
    return "微信小程序";
  }
  return "未知客户端";
}

function statusLabel(status: "stopped" | "starting" | "running"): string {
  if (status === "running") {
    return "运行中";
  }
  if (status === "starting") {
    return "启动中";
  }
  return "已停止";
}

function sessionStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    starting: "启动中",
    running: "运行中",
    stopped: "已停止",
    exited: "已退出",
    failed: "失败"
  };
  return labels[status] ?? status;
}

function availabilityLabel(availability: string): string {
  const labels: Record<string, string> = {
    available: "可用",
    missing: "未安装",
    unknown: "未知"
  };
  return escapeHtml(labels[availability] ?? availability);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
