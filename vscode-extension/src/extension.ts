import * as qrcode from "qrcode";
import * as vscode from "vscode";
import { readAgentMobileConfig } from "./config.js";
import { LocalHostSessionClient, type SessionConsoleEvent } from "./hostClient.js";
import { fetchHostDashboardStatus, HostController } from "./hostController.js";
import { createPairingPayload, createPairingToken, firstLanAddress } from "./pairing.js";
import { renderPairingHtml } from "./webview.js";

export function activate(context: vscode.ExtensionContext): void {
  const controller = new HostController();
  const state = {
    lanEnabled: false,
    pairingToken: createPairingToken(),
    host: "127.0.0.1",
    port: 17365,
    pairingJson: "{}",
    selectedSessionId: undefined as string | undefined,
    sessionEvents: [] as SessionConsoleEvent[],
    consoleError: undefined as string | undefined
  };

  const provider = new PairingViewProvider(controller, state);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("agentMobile.pairingView", provider));
  context.subscriptions.push(
    vscode.commands.registerCommand("agentMobile.startHost", () => startHost(controller, state, provider)),
    vscode.commands.registerCommand("agentMobile.stopHost", () => {
      controller.stop();
      provider.safeRefresh();
    }),
    vscode.commands.registerCommand("agentMobile.enableLanPairing", () => {
      state.lanEnabled = true;
      state.host = firstLanAddress() ?? "127.0.0.1";
      return startHost(controller, state, provider);
    }),
    vscode.commands.registerCommand("agentMobile.disableLanPairing", () => disableLanPairing(controller, state, provider)),
    vscode.commands.registerCommand("agentMobile.copyPairingJson", () => vscode.env.clipboard.writeText(state.pairingJson))
  );
}

export function deactivate(): void {}

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
  provider: PairingViewProvider
): Promise<void> {
  state.pairingToken = createPairingToken();
  const config = readAgentMobileConfig(vscode.workspace.getConfiguration("agentMobile"));
  state.port = config.port;
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const payload = createPairingPayload({
    host: state.host,
    port: config.port,
    pairingToken: state.pairingToken,
    deviceName: "VS Code"
  });
  state.pairingJson = JSON.stringify(payload);
  state.selectedSessionId = undefined;
  state.sessionEvents = [];
  state.consoleError = undefined;
  provider.resetHostClient({
    host: state.host,
    port: config.port,
    pairingToken: state.pairingToken
  });
  await controller.start({
    host: state.lanEnabled ? "0.0.0.0" : "127.0.0.1",
    workspace,
    pairingToken: state.pairingToken,
    config,
    onOutput: (line) => console.log(`[agent-mobile-host] ${line}`)
  });
  await provider.safeRefresh();
}

export async function disableLanPairing(
  controller: Pick<HostController, "stop">,
  state: {
    lanEnabled: boolean;
    host: string;
    pairingJson: string;
    selectedSessionId?: string;
    sessionEvents?: SessionConsoleEvent[];
    consoleError?: string;
  },
  provider: { safeRefresh(): Promise<void> }
): Promise<void> {
  state.lanEnabled = false;
  state.host = "127.0.0.1";
  state.pairingJson = "{}";
  state.selectedSessionId = undefined;
  state.sessionEvents = [];
  state.consoleError = undefined;
  controller.stop();
  await provider.safeRefresh();
}

class PairingViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private hostClient?: LocalHostSessionClient;
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
    this.unsubscribeStream?.();
    this.unsubscribeStream = undefined;
    this.hostClient = new LocalHostSessionClient(input);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = "<!doctype html><html><body><p>正在加载 Agent Mobile...</p></body></html>";
    webviewView.webview.onDidReceiveMessage((message: { command?: string; sessionId?: string; text?: string }) => {
      if (message.command === "enable") {
        void vscode.commands.executeCommand("agentMobile.enableLanPairing");
      } else if (message.command === "disable") {
        void vscode.commands.executeCommand("agentMobile.disableLanPairing");
      } else if (message.command === "copy") {
        void vscode.commands.executeCommand("agentMobile.copyPairingJson");
      } else if (message.command === "refresh") {
        void this.safeRefresh();
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
    const qrSvg = this.state.pairingJson === "{}" ? "" : await qrcode.toString(this.state.pairingJson, { type: "svg" });
    const hostStatus = this.controller.getStatus();
    const dashboard = hostStatus === "running"
      ? await fetchHostDashboardStatus({
          host: this.state.host,
          port: this.state.port,
          pairingToken: this.state.pairingToken
        })
      : undefined;
    this.view.webview.html = await renderPairingHtml({
      status: hostStatus,
      lanEnabled: this.state.lanEnabled,
      pairingJson: this.state.pairingJson,
      qrSvg,
      dashboard,
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
      this.subscribeToStream();
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
      this.state.sessionEvents = [
        ...this.state.sessionEvents,
        { seq: -Date.now(), sessionId: targetSessionId, type: "agent.input", text: trimmedText }
      ].slice(-500);
      this.state.consoleError = undefined;
    } catch (error) {
      this.state.consoleError = error instanceof Error ? error.message : String(error);
    }
    await this.safeRefresh();
  }

  private async stopSession(sessionId: string): Promise<void> {
    try {
      await this.requireHostClient().stopSession(sessionId);
      this.state.consoleError = undefined;
    } catch (error) {
      this.state.consoleError = error instanceof Error ? error.message : String(error);
    }
    await this.safeRefresh();
  }

  private subscribeToStream(): void {
    this.unsubscribeStream?.();
    this.unsubscribeStream = this.requireHostClient().subscribe({
      lastSeq: this.state.sessionEvents.reduce((max, event) => Math.max(max, event.seq), 0),
      onEvent: (event) => {
        if (this.state.sessionEvents.some((existing) => existing.seq === event.seq && existing.sessionId === event.sessionId)) {
          return;
        }
        this.state.sessionEvents = [...this.state.sessionEvents, event].slice(-500);
        void this.safeRefresh();
      },
      onError: (error) => {
        if (error === "Host event stream failed" && this.hasEventsForSelectedSession()) {
          return;
        }
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
      this.state.sessionEvents = [...this.state.sessionEvents, event].slice(-500);
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
