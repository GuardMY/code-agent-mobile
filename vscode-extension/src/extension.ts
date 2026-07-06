import * as qrcode from "qrcode";
import * as vscode from "vscode";
import type { HostDashboardStatus } from "@agent-mobile/protocol";
import { readAgentMobileConfig } from "./config.js";
import { LocalHostSessionClient, type SessionConsoleEvent } from "./hostClient.js";
import { fetchHostDashboardStatus, HostController, requestHostStop, type DashboardFetchResult } from "./hostController.js";
import { createPairingPayload, createPairingToken, firstLanAddress } from "./pairing.js";
import { renderPairingHtml } from "./webview.js";

type ExtensionState = {
  lanEnabled: boolean;
  pairingToken: string;
  host: string;
  port: number;
  pairingJson: string;
  selectedSessionId?: string;
  sessionEvents: SessionConsoleEvent[];
  consoleError?: string;
};

type HostClientTarget = {
  host: string;
  port: number;
  pairingToken: string;
};

export function activate(context: vscode.ExtensionContext): void {
  const controller = new HostController();
  const state = createInitialState();

  const provider = new PairingViewProvider(controller, state);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("agentMobile.pairingView", provider));
  context.subscriptions.push(
    vscode.commands.registerCommand("agentMobile.startHost", () => startHost(controller, state, provider, context.extensionPath)),
    vscode.commands.registerCommand("agentMobile.stopHost", () => stopHost(controller, state, provider)),
    vscode.commands.registerCommand("agentMobile.enableLanPairing", () => {
      state.lanEnabled = true;
      state.host = firstLanAddress() ?? "127.0.0.1";
      return startHost(controller, state, provider, context.extensionPath);
    }),
    vscode.commands.registerCommand("agentMobile.disableLanPairing", () => disableLanPairing(controller, state, provider)),
    vscode.commands.registerCommand("agentMobile.copyPairingJson", () => vscode.env.clipboard.writeText(state.pairingJson))
  );
}

export function deactivate(): void {}

export function createInitialState(): {
  lanEnabled: boolean;
  pairingToken: string;
  host: string;
  port: number;
  pairingJson: string;
  selectedSessionId?: string;
  sessionEvents: SessionConsoleEvent[];
  consoleError?: string;
} {
  return {
    lanEnabled: false,
    pairingToken: createPairingToken(),
    host: "127.0.0.1",
    port: 17365,
    pairingJson: "{}",
    selectedSessionId: undefined,
    sessionEvents: [],
    consoleError: undefined
  };
}

export function appendLocalUserInput(state: Pick<ExtensionState, "sessionEvents">, sessionId: string, text: string): void {
  const alreadyRecorded = state.sessionEvents.some(
    (event) =>
      event.sessionId === sessionId &&
      event.type === "agent.input" &&
      event.text === text
  );
  if (alreadyRecorded) {
    return;
  }
  state.sessionEvents = [
    ...state.sessionEvents,
    { seq: -Date.now(), sessionId, type: "agent.input", text }
  ].slice(-500);
}

export function reconcileCanonicalSessionEvent(
  state: Pick<ExtensionState, "sessionEvents">,
  event: SessionConsoleEvent
): void {
  if (event.type !== "agent.input") {
    state.sessionEvents = [...state.sessionEvents, event].slice(-500);
    return;
  }
  const placeholderIndex = state.sessionEvents.findIndex(
    (existing) =>
      existing.type === "agent.input" &&
      existing.seq < 0 &&
      existing.sessionId === event.sessionId &&
      existing.text === event.text
  );
  if (placeholderIndex >= 0) {
    state.sessionEvents = state.sessionEvents.map((existing, index) => (index === placeholderIndex ? event : existing));
    return;
  }
  state.sessionEvents = [...state.sessionEvents, event].slice(-500);
}

async function startHost(
  controller: HostController,
  state: {
    lanEnabled: boolean;
    pairingToken: string;
    host: string;
    port: number;
    pairingJson: string;
    selectedSessionId?: string;
    sessionEvents: SessionConsoleEvent[];
    consoleError?: string;
  },
  provider: PairingViewProvider,
  extensionPath: string
): Promise<void> {
  const config = readAgentMobileConfig(vscode.workspace.getConfiguration("agentMobile"));
  state.port = config.port;
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  state.pairingToken = createPairingToken();
  state.pairingJson = JSON.stringify(
    createPairingPayload({
      host: state.host,
      port: config.port,
      pairingToken: state.pairingToken,
      deviceName: "VS Code"
    })
  );
  state.selectedSessionId = undefined;
  state.sessionEvents = [];
  state.consoleError = undefined;
  provider.resetHostClient({
    host: state.host,
    port: config.port,
    pairingToken: state.pairingToken
  });
  const result = await controller.start({
    host: state.lanEnabled ? "0.0.0.0" : "127.0.0.1",
    extensionPath,
    workspace,
    pairingToken: state.pairingToken,
    config,
    onOutput: (line) => console.log(`[agent-mobile-host] ${line}`)
  });
  if (result.mode === "reused") {
    applyDashboardState(state, result.dashboard);
    provider.resetHostClient({
      host: state.host,
      port: state.port,
      pairingToken: state.pairingToken
    });
  }
  await provider.safeRefresh();
}

async function stopHost(
  controller: HostController,
  state: {
    lanEnabled: boolean;
    pairingToken: string;
    host: string;
    port: number;
    pairingJson: string;
    selectedSessionId?: string;
    sessionEvents: SessionConsoleEvent[];
    consoleError?: string;
  },
  provider: { safeRefresh(): Promise<void> }
): Promise<void> {
  const dashboard = await fetchHostDashboardStatus({
    host: "127.0.0.1",
    port: state.port
  });
  if (dashboard.reachable) {
    state.pairingToken = dashboard.status.pairing.pairingPayload.pairingToken;
    await requestHostStop({ port: state.port, pairingToken: state.pairingToken });
  } else {
    controller.stop();
  }
  await provider.safeRefresh();
}

export async function disableLanPairing(
  controller: Pick<HostController, "stop">,
  state: {
    lanEnabled: boolean;
    host: string;
    port: number;
    pairingJson: string;
    selectedSessionId?: string;
    sessionEvents?: SessionConsoleEvent[];
    consoleError?: string;
  },
  provider: { safeRefresh(): Promise<void> },
  dependencies: {
    fetchHostDashboardStatus: typeof fetchHostDashboardStatus;
    requestHostStop: typeof requestHostStop;
  } = {
    fetchHostDashboardStatus,
    requestHostStop
  }
): Promise<void> {
  state.lanEnabled = false;
  state.host = "127.0.0.1";
  state.pairingJson = "{}";
  state.selectedSessionId = undefined;
  state.sessionEvents = [];
  state.consoleError = undefined;
  const dashboard = await dependencies.fetchHostDashboardStatus({
    host: "127.0.0.1",
    port: state.port
  });
  if (dashboard.reachable) {
    await dependencies.requestHostStop({
      port: state.port,
      pairingToken: dashboard.status.pairing.pairingPayload.pairingToken
    });
  } else {
    controller.stop();
  }
  await provider.safeRefresh();
}

export function applyDashboardState(
  state: {
    lanEnabled: boolean;
    pairingToken: string;
    host: string;
    port: number;
    pairingJson: string;
  },
  dashboard: HostDashboardStatus
): void {
  state.lanEnabled = dashboard.server.lanEnabled;
  state.host = dashboard.pairing.pairingPayload.host;
  state.port = dashboard.pairing.pairingPayload.port;
  state.pairingToken = dashboard.pairing.pairingPayload.pairingToken;
  state.pairingJson = JSON.stringify(dashboard.pairing.pairingPayload);
}

export function clearStoppedSessionSelection(
  state: {
    selectedSessionId?: string;
    sessionEvents: SessionConsoleEvent[];
    consoleError?: string;
  },
  sessionId: string
): void {
  if (state.selectedSessionId !== sessionId) {
    return;
  }
  state.selectedSessionId = undefined;
  state.sessionEvents = state.sessionEvents.filter((event) => event.sessionId !== sessionId);
  state.consoleError = undefined;
}

export function clearMissingSessionSelection(
  state: {
    selectedSessionId?: string;
    sessionEvents: SessionConsoleEvent[];
    consoleError?: string;
  },
  sessions: HostDashboardStatus["sessions"]
): void {
  const selectedSessionId = state.selectedSessionId;
  if (!selectedSessionId) {
    return;
  }
  if (sessions.some((session) => session.id === selectedSessionId)) {
    return;
  }
  clearStoppedSessionSelection(state, selectedSessionId);
}

export function isSameHostClientTarget(current: HostClientTarget | undefined, next: HostClientTarget): boolean {
  return (
    current?.host === next.host &&
    current?.port === next.port &&
    current?.pairingToken === next.pairingToken
  );
}

export function selectDashboardForRender(
  dashboard: DashboardFetchResult,
  hostStatus: "stopped" | "starting" | "running"
): DashboardFetchResult | undefined {
  if (!dashboard.reachable && hostStatus !== "running") {
    return undefined;
  }
  return dashboard;
}

function clearDashboardState(state: {
  lanEnabled: boolean;
  pairingToken: string;
  host: string;
  port: number;
  pairingJson: string;
}): void {
  state.lanEnabled = false;
  state.host = "127.0.0.1";
  state.pairingToken = createPairingToken();
  state.pairingJson = "{}";
}

class PairingViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private hostClient?: LocalHostSessionClient;
  private hostClientTarget?: HostClientTarget;
  private unsubscribeStream?: () => void;

  constructor(
    private readonly controller: HostController,
    private readonly state: {
      lanEnabled: boolean;
      pairingToken: string;
      host: string;
      port: number;
      pairingJson: string;
      selectedSessionId?: string;
      sessionEvents: SessionConsoleEvent[];
      consoleError?: string;
    }
  ) {}

  resetHostClient(input: { host: string; port: number; pairingToken: string }): void {
    if (!this.hostClient) {
      this.hostClient = new LocalHostSessionClient(input);
      this.hostClientTarget = { ...input };
      return;
    }
    if (isSameHostClientTarget(this.hostClientTarget, input)) {
      return;
    }
    this.unsubscribeStream?.();
    this.unsubscribeStream = undefined;
    this.hostClient.reset(input);
    this.hostClientTarget = { ...input };
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = "<!doctype html><html><body><p>正在加载 Agent Mobile...</p></body></html>";
    webviewView.webview.onDidReceiveMessage((message: { command?: string; sessionId?: string; text?: string; deviceId?: string }) => {
      if (message.command === "enable") {
        void vscode.commands.executeCommand("agentMobile.enableLanPairing");
      } else if (message.command === "disable") {
        void vscode.commands.executeCommand("agentMobile.disableLanPairing");
      } else if (message.command === "copy") {
        void vscode.commands.executeCommand("agentMobile.copyPairingJson");
      } else if (message.command === "refresh") {
        void this.safeRefresh();
      } else if (message.command === "revokeDevice" && message.deviceId) {
        void this.revokeDevice(message.deviceId);
      } else if (message.command === "refreshSessions") {
        void this.safeRefresh();
      } else if (message.command === "selectSession" && message.sessionId) {
        void this.selectSession(message.sessionId);
      } else if (message.command === "sendInput") {
        void this.sendInput(message.sessionId, message.text ?? "");
      } else if (message.command === "stopSession" && message.sessionId) {
        void this.stopSession(message.sessionId);
      }
    });
    this.refreshTimer = setInterval(() => {
      void this.safeRefresh();
    }, 3000);
    webviewView.onDidDispose(() => {
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = undefined;
      }
      this.unsubscribeStream?.();
      this.unsubscribeStream = undefined;
    });
    void this.safeRefresh();
  }

  async safeRefresh(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      if (this.view) {
        this.view.webview.html = `<!doctype html><html><body><h2>Agent Mobile</h2><p>无法渲染视图。</p><pre>${escapeHtml(
          error instanceof Error ? error.message : String(error)
        )}</pre></body></html>`;
      }
    }
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const dashboard = await fetchHostDashboardStatus({
      host: "127.0.0.1",
      port: this.state.port
    });
    if (dashboard.reachable) {
      applyDashboardState(this.state, dashboard.status);
      clearMissingSessionSelection(this.state, dashboard.status.sessions);
      this.resetHostClient({
        host: this.state.host,
        port: this.state.port,
        pairingToken: this.state.pairingToken
      });
      this.ensureStreamSubscription();
    } else if (this.controller.getStatus() === "stopped") {
      clearDashboardState(this.state);
      this.unsubscribeStream?.();
      this.unsubscribeStream = undefined;
    }
    const qrSvg = this.state.pairingJson === "{}" ? "" : await qrcode.toString(this.state.pairingJson, { type: "svg" });
    const hostStatus = dashboard.reachable ? "running" : this.controller.getStatus();
    this.view.webview.html = await renderPairingHtml({
      status: hostStatus,
      lanEnabled: this.state.lanEnabled,
      pairingJson: this.state.pairingJson,
      qrSvg,
      dashboard: selectDashboardForRender(dashboard, hostStatus),
      selectedSessionId: this.state.selectedSessionId,
      sessionEvents: this.state.sessionEvents,
      consoleError: this.state.consoleError
    });
  }

  private async selectSession(sessionId: string): Promise<void> {
    const client = this.requireHostClient();
    this.state.selectedSessionId = sessionId;
    this.state.consoleError = undefined;
    await this.safeRefresh();
    try {
      await client.attachSession(sessionId);
      await this.fetchLatestEvents(client);
      this.ensureStreamSubscription();
    } catch (error) {
      this.state.consoleError = error instanceof Error ? error.message : String(error);
    }
    await this.safeRefresh();
  }

  private async sendInput(sessionId: string | undefined, text: string): Promise<void> {
    const targetSessionId = sessionId ?? this.state.selectedSessionId;
    const trimmedText = text.trim();
    if (!targetSessionId || !trimmedText) {
      return;
    }
    try {
      await this.requireHostClient().sendInput(targetSessionId, trimmedText);
      appendLocalUserInput(this.state, targetSessionId, trimmedText);
      this.state.consoleError = undefined;
    } catch (error) {
      this.state.consoleError = error instanceof Error ? error.message : String(error);
    }
    await this.safeRefresh();
  }

  private async stopSession(sessionId: string): Promise<void> {
    try {
      await this.requireHostClient().stopSession(sessionId);
      clearStoppedSessionSelection(this.state, sessionId);
      this.state.consoleError = undefined;
    } catch (error) {
      this.state.consoleError = error instanceof Error ? error.message : String(error);
    }
    await this.safeRefresh();
  }

  private async revokeDevice(deviceId: string): Promise<void> {
    try {
      await this.requireHostClient().revokeDevice(deviceId);
      this.state.consoleError = undefined;
    } catch (error) {
      this.state.consoleError = error instanceof Error ? error.message : String(error);
    }
    await this.safeRefresh();
  }

  private ensureStreamSubscription(): void {
    if (this.unsubscribeStream) {
      return;
    }
    this.unsubscribeStream = this.requireHostClient().subscribe({
      lastSeq: this.state.sessionEvents.reduce((max, event) => Math.max(max, event.seq), 0),
      onEvent: (event) => {
        if (this.state.sessionEvents.some((existing) => existing.seq === event.seq && existing.sessionId === event.sessionId)) {
          return;
        }
        reconcileCanonicalSessionEvent(this.state, event);
        if (
          event.sessionId === this.state.selectedSessionId ||
          event.type === "session.started" ||
          event.type === "session.finished"
        ) {
          void this.safeRefresh();
        }
      },
      onError: (error) => {
        if (error === "Host event stream failed" && this.hasEventsForSelectedSession()) {
          return;
        }
        this.unsubscribeStream = undefined;
        this.state.consoleError = error;
        void this.safeRefresh();
      }
    });
  }

  private async fetchLatestEvents(client: LocalHostSessionClient): Promise<void> {
    const events = await client.fetchEvents(this.latestEventSeq());
    for (const event of events) {
      if (this.state.sessionEvents.some((existing) => existing.seq === event.seq && existing.sessionId === event.sessionId)) {
        continue;
      }
      reconcileCanonicalSessionEvent(this.state, event);
    }
    this.state.consoleError = undefined;
  }

  private latestEventSeq(): number {
    return this.state.sessionEvents.reduce((max, event) => Math.max(max, event.seq > 0 ? event.seq : 0), 0);
  }

  private hasEventsForSelectedSession(): boolean {
    return this.state.sessionEvents.some((event) => event.sessionId === this.state.selectedSessionId);
  }

  private requireHostClient(): LocalHostSessionClient {
    if (!this.hostClient) {
      this.hostClient = new LocalHostSessionClient({
        host: this.state.host,
        port: this.state.port,
        pairingToken: this.state.pairingToken
      });
    }
    return this.hostClient;
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
