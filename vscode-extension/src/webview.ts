import type { AgentCapabilitySummary, ClientType, DeviceSummary, SessionSummary } from "@agent-mobile/protocol";
import type { DashboardFetchResult } from "./hostController.js";
import type { SessionConsoleEvent } from "./hostClient.js";

const SESSION_TITLE_MAX_LENGTH = 44;
const SESSION_MESSAGES_ID = "sessionMessages";
const SESSION_SCROLL_THRESHOLD_PX = 24;

type SessionScrollSnapshot = {
  selectedSessionId?: string;
  messageCount: number;
  lastMessageType?: SessionConsoleEvent["type"];
  lastMessageSeq?: number;
  lastMessageTextLength: number;
  seenSessionIds?: string[];
  nearBottomBySession?: Record<string, boolean>;
  scrollTopBySession?: Record<string, number>;
};

type SessionAutoScrollDecision = "bottom" | "preserve";
const MOBILE_CLIENT_TYPES: ClientType[] = ["android-app", "ios-app", "wechat-mini-program"];

export type RenderedSessionMessage = SessionConsoleEvent;

export async function renderPairingHtml(input: {
  status: "stopped" | "starting" | "running";
  lanEnabled: boolean;
  pairingJson: string;
  qrSvg: string;
  dashboard?: DashboardFetchResult;
  selectedSessionId?: string;
  sessionEvents?: SessionConsoleEvent[];
  consoleError?: string;
  selectedTab?: string;
}): Promise<string> {
  const dashboard = renderDashboard({ ...input, selectedTab: input.selectedTab });
  const pairingConnectionHtml = renderPairingConnectionPanel({
    pairingJson: input.pairingJson,
    qrSvg: input.qrSvg
  });
  const selectedEvents = input.selectedSessionId
    ? (input.sessionEvents ?? []).filter((event) => event.sessionId === input.selectedSessionId)
    : [];
  const sessionScrollSnapshot = JSON.stringify(toSessionScrollSnapshot(input.selectedSessionId, selectedEvents));
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
    .panel-card {
      display: grid;
      gap: 10px;
      padding: 14px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      background: color-mix(in srgb, var(--vscode-sideBar-background) 84%, var(--vscode-editor-background));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-panel-border) 35%, transparent);
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
    }
    .grid {
      display: grid;
      gap: 8px;
    }
    .session-list {
      display: grid;
      gap: 8px;
      max-height: 280px;
      overflow-y: auto;
      padding-right: 2px;
    }
    .session-tabs {
      display: flex;
      gap: 0;
      border-bottom: 2px solid var(--vscode-panel-border);
      margin-bottom: 4px;
    }
    .session-tab {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      flex: 1;
      padding: 6px 4px;
      color: var(--vscode-descriptionForeground);
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      transition: color 0.15s, border-color 0.15s;
    }
    .session-tab:hover {
      color: var(--vscode-foreground);
    }
    .session-tab.active {
      color: var(--vscode-focusBorder);
      border-bottom-color: var(--vscode-focusBorder);
      font-weight: 650;
    }
    .tab-label {
      font-weight: inherit;
    }
    .tab-count {
      font-size: 10px;
      opacity: 0.7;
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
      display: grid;
      gap: 4px;
      width: 100%;
      padding: 8px;
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
    .session-meta {
      overflow-wrap: anywhere;
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
      gap: 10px;
      min-height: 120px;
      max-height: 320px;
      overflow: auto;
      padding: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .message {
      display: grid;
      gap: 4px;
      width: min(88%, 520px);
      padding: 8px 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      word-break: break-word;
      font-size: 12px;
    }
    .agent-message {
      justify-self: start;
      border-bottom-left-radius: 3px;
      background: var(--vscode-sideBar-background);
    }
    .user-message {
      justify-self: end;
      border-bottom-right-radius: 3px;
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .message-body {
      display: grid;
      gap: 6px;
    }
    .message-body p,
    .message-body ul,
    .message-body pre,
    .message-body h1,
    .message-body h2,
    .message-body h3 {
      margin: 0;
    }
    .message-body ul {
      padding-left: 18px;
    }
    .message-body h1 {
      font-size: 16px;
      color: inherit;
      text-transform: none;
    }
    .message-body h2,
    .message-body h3 {
      font-size: 14px;
      color: inherit;
      text-transform: none;
    }
    .message-body code {
      font-family: var(--vscode-editor-font-family);
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 3px;
      border-radius: 3px;
    }
    .message-body pre {
      padding: 8px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 6px;
      white-space: pre-wrap;
    }
    .actions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
      gap: 8px;
    }
    .controls-copy {
      display: grid;
      gap: 6px;
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
    <section class="panel-card">
      <h2>Agent Mobile</h2>
      <div class="status"><span class="dot"></span>${statusLabel(input.status)}</div>
    </section>
    ${dashboard.mainHtml}
    ${pairingConnectionHtml}
    ${renderPanel(
      "局域网控制与配对",
      `<div class="actions">
        <button type="button" data-command="enable">启用局域网</button>
        <button type="button" data-command="disable" class="secondary">停用局域网</button>
        <button type="button" data-command="refresh" class="secondary">刷新</button>
        <button type="button" data-command="copy" class="secondary">复制配对 JSON</button>
      </div>
      <div class="controls-copy">
        <p class="muted">把当前主机的局域网访问、状态刷新和配对分享集中放在这里，和会话区分开。</p>
      </div>`,
      "controls-panel"
    )}
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    const sessionScrollKey = "agentMobile.sessionScroll";
    const sessionMessagesId = ${JSON.stringify(SESSION_MESSAGES_ID)};
    const sessionScrollThresholdPx = ${SESSION_SCROLL_THRESHOLD_PX};
    const currentSessionSnapshot = ${sessionScrollSnapshot};
    const previousSessionState = vscode.getState()?.[sessionScrollKey];
    const currentSessionId = currentSessionSnapshot.selectedSessionId;

    function isNearBottom(element) {
      return element.scrollHeight - element.clientHeight - element.scrollTop <= sessionScrollThresholdPx;
    }

    function persistSessionState(nextState) {
      const existingState = vscode.getState() ?? {};
      vscode.setState({ ...existingState, [sessionScrollKey]: nextState });
    }

    function scrollToBottom(element) {
      element.scrollTop = element.scrollHeight;
    }

    function decideAutoScroll(previous, current) {
      if (!current.selectedSessionId) {
        return "preserve";
      }

      const hasSeenSession = previous?.seenSessionIds?.includes(current.selectedSessionId) ?? false;
      if (!hasSeenSession) {
        return "bottom";
      }

      const previousMessageCount = previous?.messageCount ?? 0;
      const previousLastMessageSeq = previous?.lastMessageSeq ?? 0;
      const previousLastMessageTextLength = previous?.lastMessageTextLength ?? 0;
      const hasNewContent =
        current.messageCount > previousMessageCount ||
        (current.lastMessageSeq ?? 0) > previousLastMessageSeq ||
        current.lastMessageTextLength > previousLastMessageTextLength;
      if (!hasNewContent) {
        return "preserve";
      }

      if (current.lastMessageType === "agent.input") {
        return "bottom";
      }

      const wasNearBottom = previous?.nearBottomBySession?.[current.selectedSessionId] ?? false;
      if (current.lastMessageType === "agent.output" && wasNearBottom) {
        return "bottom";
      }

      return "preserve";
    }

    function resolveSessionPreservedScrollTop(previous, current, maxScrollTop) {
      if (!current.selectedSessionId || previous?.selectedSessionId !== current.selectedSessionId) {
        return undefined;
      }
      const storedScrollTop = previous.scrollTopBySession?.[current.selectedSessionId];
      if (typeof storedScrollTop !== "number" || !Number.isFinite(storedScrollTop)) {
        return undefined;
      }
      return Math.max(0, Math.min(storedScrollTop, maxScrollTop));
    }

    function bindSessionAutoScroll() {
      const messageContainer = document.getElementById(sessionMessagesId);
      if (!messageContainer || !currentSessionId) {
        persistSessionState({
          ...currentSessionSnapshot,
          seenSessionIds: previousSessionState?.seenSessionIds ?? [],
          nearBottomBySession: previousSessionState?.nearBottomBySession ?? {},
          scrollTopBySession: previousSessionState?.scrollTopBySession ?? {}
        });
        return;
      }

      const decision = decideAutoScroll(previousSessionState, currentSessionSnapshot);
      const restoredScrollTop = resolveSessionPreservedScrollTop(
        previousSessionState,
        currentSessionSnapshot,
        Math.max(0, messageContainer.scrollHeight - messageContainer.clientHeight)
      );
      const seenSessionIds = new Set(previousSessionState?.seenSessionIds ?? []);
      seenSessionIds.add(currentSessionId);
      const nearBottomBySession = {
        ...(previousSessionState?.nearBottomBySession ?? {}),
        [currentSessionId]: false
      };
      const scrollTopBySession = {
        ...(previousSessionState?.scrollTopBySession ?? {}),
        [currentSessionId]: messageContainer.scrollTop
      };

      if (decision === "bottom") {
        scrollToBottom(messageContainer);
      } else if (typeof restoredScrollTop === "number") {
        messageContainer.scrollTop = restoredScrollTop;
      }
      nearBottomBySession[currentSessionId] = isNearBottom(messageContainer);
      scrollTopBySession[currentSessionId] = messageContainer.scrollTop;

      messageContainer.addEventListener("scroll", () => {
        const latestState = vscode.getState()?.[sessionScrollKey] ?? {};
        persistSessionState({
          ...latestState,
          ...currentSessionSnapshot,
          seenSessionIds: Array.from(new Set([...(latestState.seenSessionIds ?? []), currentSessionId])),
          nearBottomBySession: {
            ...(latestState.nearBottomBySession ?? {}),
            [currentSessionId]: isNearBottom(messageContainer)
          },
          scrollTopBySession: {
            ...(latestState.scrollTopBySession ?? {}),
            [currentSessionId]: messageContainer.scrollTop
          }
        });
      });

      persistSessionState({
        ...currentSessionSnapshot,
        seenSessionIds: Array.from(seenSessionIds),
        nearBottomBySession,
        scrollTopBySession
      });
    }

    bindSessionAutoScroll();
    document.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("button[data-command]") : null;
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        return;
      }
      const command = button.dataset.command;
      if (command === "sendInput") {
        const textarea = document.querySelector("#sessionPrompt");
        vscode.postMessage({ command, sessionId: button.dataset.sessionId, text: textarea ? textarea.value : "" });
        if (textarea) textarea.value = "";
        return;
      }
      if (command === "selectTab") {
        vscode.postMessage({ command, tabId: button.dataset.tabId });
        return;
      }
      vscode.postMessage({ command, sessionId: button.dataset.sessionId, deviceId: button.dataset.deviceId });
    });
  </script>
</body>
</html>`;
}

function renderDashboard(input: {
  status: "stopped" | "starting" | "running";
  lanEnabled: boolean;
  pairingJson: string;
  dashboard?: DashboardFetchResult;
  selectedSessionId?: string;
  sessionEvents?: SessionConsoleEvent[];
  consoleError?: string;
  selectedTab?: string;
}): { mainHtml: string } {
  if (!input.dashboard) {
    return {
      mainHtml: renderPendingDashboard(input)
    };
  }
  if (!input.dashboard.reachable) {
    return {
      mainHtml: `<section class="section"><h3>服务</h3><p class="danger">无法连接主机：${escapeHtml(input.dashboard.error)}</p></section>`
    };
  }

  const status = input.dashboard.status;
  const activeDevices = status.devices.filter((device) => isVisibleMobileDevice(device));
  const sessionDetailHtml = renderSessionConsole(
    status.sessions,
    input.selectedSessionId,
    input.sessionEvents ?? [],
    input.consoleError
  );
  return {
    mainHtml: [
      renderPanel(
      "服务",
      `<section class="section">
      <div class="row">
        <div>
          <div class="label">${escapeHtml(status.server.deviceName)} ${escapeHtml(status.server.version)}</div>
          <div class="muted">${escapeHtml(status.server.host)}:${status.server.port}</div>
        </div>
        <span class="pill">${status.server.lanEnabled ? "局域网已启用" : "仅本机"}</span>
      </div>
    </section>`
      ),
      renderPanel(
      "移动设备",
      `<section class="section">
      <div class="grid">${renderDevices(activeDevices)}</div>
    </section>`
      ),
      renderPanel(
      "桌面 Agent",
      `<section class="section">
      <div class="grid">${status.agents.map(renderAgent).join("") || `<p class="muted">暂无 Agent 状态。</p>`}</div>
    </section>`
      ),
      renderPanel(
      "Agent 会话",
      `<section class="section">
      ${renderSessionTabs(input.selectedTab ?? "codex", status.sessions)}
      <div class="session-list">${renderSessions(status.sessions, input.selectedTab ?? "codex", input.selectedSessionId)}</div>
    </section>`
      ),
      sessionDetailHtml
    ].join("")
  };
}

function renderPendingDashboard(input: {
  status: "stopped" | "starting" | "running";
  lanEnabled: boolean;
  pairingJson: string;
}): string {
  const pairing = parsePairingDetails(input.pairingJson);
  if (!pairing) {
    return renderPanel("服务", `<p class="muted">刷新后将显示主机状态。</p>`);
  }

  const detailText = input.status === "starting" ? "正在等待主机状态刷新。" : "等待主机返回完整状态。";
  return renderPanel(
    "服务",
    `<section class="section">
    <div class="row">
      <div>
        <div class="label">${escapeHtml(pairing.deviceName)}</div>
        <div class="muted">${escapeHtml(pairing.host)}:${pairing.port}</div>
        <div class="muted">${detailText}</div>
      </div>
      <span class="pill">${input.lanEnabled ? "局域网已启用" : "仅本机"}</span>
    </div>
  </section>`
  );
}

function parsePairingDetails(value: string): { host: string; port: number; deviceName: string } | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<{ host: string; port: number; deviceName: string }>;
    if (!parsed || typeof parsed.host !== "string" || typeof parsed.port !== "number" || typeof parsed.deviceName !== "string") {
      return undefined;
    }
    return {
      host: parsed.host,
      port: parsed.port,
      deviceName: parsed.deviceName
    };
  } catch {
    return undefined;
  }
}

function renderPairingConnectionPanel(input: { pairingJson: string; qrSvg: string }): string {
  const pairingDetails = parsePairingDetails(input.pairingJson);
  if (!pairingDetails) {
    return renderPanel(
      "配对连接",
      `<section class="section">
        <p class="muted">在 Android 应用、iOS 应用或微信小程序中使用这里的二维码或配对 JSON。</p>
        <p class="muted">刷新或启动主机后将在这里显示二维码和配对 JSON。</p>
      </section>`,
      "pairing-connection-panel"
    );
  }

  return renderPanel(
    "配对连接",
    `<section class="section">
      <p class="muted">在 Android 应用、iOS 应用或微信小程序中使用这里的二维码或配对 JSON。</p>
      <section class="qr">${input.qrSvg}</section>
      <pre>${escapeHtml(input.pairingJson)}</pre>
    </section>`,
    "pairing-connection-panel"
  );
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
          <div class="muted">长期有效，直到桌面端或移动端解绑。</div>
        </div>
        <div class="grid">
          <span class="pill">活跃</span>
          <button type="button" data-command="revokeDevice" data-device-id="${escapeHtml(device.deviceId)}" class="secondary">解绑</button>
        </div>
      </div>`
    )
    .join("");
}

function isVisibleMobileDevice(device: DeviceSummary): boolean {
  return MOBILE_CLIENT_TYPES.includes(device.clientType) && !device.revokedAt;
}

function renderSessions(sessions: SessionSummary[], selectedTab: string, selectedSessionId?: string): string {
  const filtered = sessions
    .filter((session) => session.adapterId === selectedTab)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  if (filtered.length === 0) {
    const tabLabel = ADAPTER_TABS.find((t) => t.id === selectedTab)?.label ?? selectedTab;
    return `<p class="muted">暂无 ${escapeHtml(tabLabel)} 会话。</p>`;
  }
  return filtered
    .map((session) => {
      const selected = session.id === selectedSessionId;
      const title = session.title ?? session.id;
      const displayTitle = truncateSessionTitle(title);
      return `<button type="button" class="session-row${selected ? " selected" : ""}" data-command="selectSession" data-session-id="${escapeHtml(session.id)}" title="${escapeHtml(title)}">
        <div class="label">${escapeHtml(displayTitle)}</div>
        <div class="muted session-meta">项目目录：${escapeHtml(session.workspace)}</div>
        <div class="muted">${escapeHtml(formatSessionTime(session.startedAt))}</div>
      </button>`;
    })
    .join("");
}

const ADAPTER_TABS = [
  { id: "codex", label: "CODEX" },
  { id: "claude-code", label: "Claude" },
  { id: "opencode", label: "OpenCode" }
];

function renderSessionTabs(selectedTab: string, sessions: SessionSummary[]): string {
  return `<div class="session-tabs">${ADAPTER_TABS.map((tab) => {
    const count = sessions.filter((s) => s.adapterId === tab.id).length;
    const isSelected = tab.id === selectedTab;
    return `<button type="button" class="session-tab${isSelected ? " active" : ""}" data-command="selectTab" data-tab-id="${escapeHtml(tab.id)}">
      <span class="tab-label">${escapeHtml(tab.label)}</span>
      <span class="tab-count">${count}</span>
    </button>`;
  }).join("")}</div>`;
}

function truncateSessionTitle(title: string): string {
  if (title.length <= SESSION_TITLE_MAX_LENGTH) {
    return title;
  }
  return `${title.slice(0, SESSION_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

function renderSessionConsole(
  sessions: SessionSummary[],
  selectedSessionId: string | undefined,
  events: SessionConsoleEvent[],
  consoleError: string | undefined
): string {
  const selected = sessions.find((session) => session.id === selectedSessionId);
  if (!selected) {
    return "";
  }
  const selectedEvents = events.filter((event) => event.sessionId === selectedSessionId);
  const renderedMessages = buildRenderedSessionMessages(selectedEvents);
  const title = selected.title ?? selected.id;
  return renderPanel(
    "会话详情",
    `<section class="section console">
    <div class="label">${escapeHtml(title)}</div>
    <div class="muted session-meta">项目目录：${escapeHtml(selected.workspace)}</div>
    ${consoleError ? `<p class="danger">${escapeHtml(consoleError)}</p>` : ""}
    <div class="output" id="${SESSION_MESSAGES_ID}">
      ${
        renderedMessages.length === 0
          ? `<p class="muted">暂无输出。刷新或发送一条输入后会显示流式结果。</p>`
          : renderedMessages
              .map(renderSessionEvent)
              .join("")
      }
    </div>
    <textarea id="sessionPrompt" placeholder="输入要发送给 Codex 的内容"></textarea>
    <div class="actions">
      <button type="button" data-command="sendInput" data-session-id="${escapeHtml(selected.id)}" ${selected.status === "running" ? "" : "disabled"}>发送</button>
      <button type="button" data-command="stopSession" data-session-id="${escapeHtml(selected.id)}" class="secondary" ${
        selected.status === "running" ? "" : "disabled"
      }>关闭会话</button>
    </div>
  </section>`
  );
}

function renderSessionEvent(event: RenderedSessionMessage): string {
  const isUser = event.type === "agent.input";
  const label = isUser ? "用户" : "Agent";
  const seqLabel = event.seq > 0 ? `#${event.seq}` : "本地";
  return `<div class="message ${isUser ? "user-message" : "agent-message"}">
    <div class="muted">${seqLabel} ${label}</div>
    <div class="message-body">${renderMarkdown(event.text)}</div>
  </div>`;
}

function renderMarkdown(value: string): string {
  const blocks: string[] = [];
  const paragraph: string[] = [];
  const listItems: string[] = [];
  const codeLines: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${renderInlineMarkdown(paragraph.join("\n"))}</p>`);
      paragraph.length = 0;
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
      listItems.length = 0;
    }
  };

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim() === "```") {
      if (inCode) {
        blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n").trimEnd())}</code></pre>`);
        codeLines.length = 0;
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
    } else if (trimmed.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push(`<h3>${renderInlineMarkdown(trimmed.slice(4).trim())}</h3>`);
    } else if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push(`<h2>${renderInlineMarkdown(trimmed.slice(3).trim())}</h2>`);
    } else if (trimmed.startsWith("# ")) {
      flushParagraph();
      flushList();
      blocks.push(`<h1>${renderInlineMarkdown(trimmed.slice(2).trim())}</h1>`);
    } else if (trimmed.startsWith("- ")) {
      flushParagraph();
      listItems.push(trimmed.slice(2).trim());
    } else {
      flushList();
      paragraph.push(trimmed);
    }
  }
  if (inCode) {
    blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n").trimEnd())}</code></pre>`);
  }
  flushParagraph();
  flushList();
  return blocks.join("");
}

function renderInlineMarkdown(value: string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const boldStart = value.indexOf("**", index);
    const codeStart = value.indexOf("`", index);
    const starts = [boldStart, codeStart].filter((item) => item >= 0);
    const nextStart = starts.length > 0 ? Math.min(...starts) : -1;
    if (nextStart < 0) {
      result += escapeHtml(value.slice(index));
      break;
    }
    result += escapeHtml(value.slice(index, nextStart));
    if (nextStart === boldStart) {
      const end = value.indexOf("**", boldStart + 2);
      if (end < 0) {
        result += escapeHtml(value.slice(boldStart));
        break;
      }
      result += `<strong>${escapeHtml(value.slice(boldStart + 2, end))}</strong>`;
      index = end + 2;
    } else {
      const end = value.indexOf("`", codeStart + 1);
      if (end < 0) {
        result += escapeHtml(value.slice(codeStart));
        break;
      }
      result += `<code>${escapeHtml(value.slice(codeStart + 1, end))}</code>`;
      index = end + 1;
    }
  }
  return result;
}

function renderAgent(agent: AgentCapabilitySummary): string {
  const sessionText = `${agent.activeSessions} 个活跃会话`;
  return `<div class="row">
    <div>
      <div class="label">${escapeHtml(agent.displayName)}</div>
      <div class="muted">${escapeHtml(sessionText)}</div>
    </div>
    <span class="pill">${agentStatusLabel(agent)}</span>
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
  if (type === "desktop-extension") {
    return "VS Code 插件";
  }
  return "未知客户端";
}

function renderPanel(title: string, content: string, className = ""): string {
  const panelClass = className ? `panel-card ${className}` : "panel-card";
  return `<section class="${panelClass}"><h3>${escapeHtml(title)}</h3>${content}</section>`;
}

export function toSessionScrollSnapshot(
  selectedSessionId: string | undefined,
  events: SessionConsoleEvent[]
): SessionScrollSnapshot {
  const renderedMessages = buildRenderedSessionMessages(events);
  const lastMessage = renderedMessages.at(-1);
  return {
    selectedSessionId,
    messageCount: renderedMessages.length,
    lastMessageType: lastMessage?.type,
    lastMessageSeq: lastMessage?.seq,
    lastMessageTextLength: lastMessage?.text.length ?? 0
  };
}

export function decideSessionAutoScroll(
  previous: SessionScrollSnapshot | undefined,
  current: SessionScrollSnapshot
): SessionAutoScrollDecision {
  if (!current.selectedSessionId) {
    return "preserve";
  }

  const hasSeenSession = previous?.seenSessionIds?.includes(current.selectedSessionId) ?? false;
  if (!hasSeenSession) {
    return "bottom";
  }

  const previousMessageCount = previous?.messageCount ?? 0;
  const previousLastMessageSeq = previous?.lastMessageSeq ?? 0;
  const previousLastMessageTextLength = previous?.lastMessageTextLength ?? 0;
  const hasNewContent =
    current.messageCount > previousMessageCount ||
    (current.lastMessageSeq ?? 0) > previousLastMessageSeq ||
    current.lastMessageTextLength > previousLastMessageTextLength;
  if (!hasNewContent) {
    return "preserve";
  }

  if (current.lastMessageType === "agent.input") {
    return "bottom";
  }

  const wasNearBottom = previous?.nearBottomBySession?.[current.selectedSessionId] ?? false;
  if (current.lastMessageType === "agent.output" && wasNearBottom) {
    return "bottom";
  }

  return "preserve";
}

export function resolveSessionPreservedScrollTop(
  previous: SessionScrollSnapshot | undefined,
  current: SessionScrollSnapshot,
  maxScrollTop: number
): number | undefined {
  if (!current.selectedSessionId || previous?.selectedSessionId !== current.selectedSessionId) {
    return undefined;
  }
  const storedScrollTop = previous.scrollTopBySession?.[current.selectedSessionId];
  if (typeof storedScrollTop !== "number" || !Number.isFinite(storedScrollTop)) {
    return undefined;
  }
  return Math.max(0, Math.min(storedScrollTop, maxScrollTop));
}

export function buildRenderedSessionMessages(events: SessionConsoleEvent[]): RenderedSessionMessage[] {
  const renderedMessages: RenderedSessionMessage[] = [];
  for (const event of events) {
    const previous = renderedMessages.at(-1);
    if (event.type === "agent.output" && previous?.type === "agent.output" && previous.sessionId === event.sessionId) {
      previous.text += event.text;
      previous.seq = event.seq;
      continue;
    }
    renderedMessages.push({ ...event });
  }
  return renderedMessages;
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

function agentStatusLabel(agent: AgentCapabilitySummary): string {
  if (agent.availability === "missing") {
    return "未安装";
  }
  if (agent.availability === "unknown") {
    return "未知";
  }
  if (agent.activeSessions > 0 || agent.latestSessionStatus === "running" || agent.latestSessionStatus === "starting") {
    return "运行中";
  }
  return "未启动";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
