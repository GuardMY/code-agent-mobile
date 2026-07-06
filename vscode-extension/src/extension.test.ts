import { describe, expect, it, vi } from "vitest";
import type { HostDashboardStatus } from "@agent-mobile/protocol";
import {
  applyDashboardState,
  appendLocalUserInput,
  createTrustedDeviceChangeHandler,
  clearMissingSessionSelection,
  clearStoppedSessionSelection,
  createInitialState,
  isSameHostClientTarget,
  reconcileCanonicalSessionEvent,
  startHost,
  selectDashboardForRender
} from "./extension.js";

function buildDashboard(): HostDashboardStatus {
  return {
    server: {
      running: true,
      lanEnabled: true,
      host: "192.168.1.10",
      port: 17365,
      deviceName: "VS Code",
      version: "0.1.0"
    },
    pairing: {
      enabled: true,
      pairingPayload: {
        host: "192.168.1.10",
        port: 17365,
        pairingToken: "pairing-token-123",
        deviceName: "VS Code"
      }
    },
    devices: [],
    trustedDevices: [],
    agents: [],
    sessions: []
  };
}

vi.mock("vscode", () => ({
  commands: {
    executeCommand: vi.fn(),
    registerCommand: vi.fn()
  },
  env: {
    clipboard: {
      writeText: vi.fn()
    }
  },
  window: {
    registerWebviewViewProvider: vi.fn()
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: <T>(_key: string, fallback: T) => fallback
    })),
    workspaceFolders: []
  }
}));

describe("extension shared host state", () => {
  it("updates pairing state from a discovered dashboard payload", () => {
    const state = createInitialState();

    applyDashboardState(state, buildDashboard());

    expect(state).toMatchObject({
      lanEnabled: true,
      host: "192.168.1.10",
      port: 17365
    });
    expect(state.pairingToken).toBe("pairing-token-123");
    expect(state.pairingJson).toBe(JSON.stringify(buildDashboard().pairing.pairingPayload));
  });

  it("preserves unreachable dashboard results so the webview can show the real error", () => {
    const dashboard = { reachable: false as const, error: "fetch failed" };

    expect(selectDashboardForRender(dashboard, "running")).toEqual(dashboard);
  });

  it("hides unreachable dashboard results while the host is still starting", () => {
    const dashboard = { reachable: false as const, error: "fetch failed" };

    expect(selectDashboardForRender(dashboard, "starting")).toBeUndefined();
  });

  it("hides unreachable dashboard results when the host is stopped", () => {
    const dashboard = { reachable: false as const, error: "fetch failed" };

    expect(selectDashboardForRender(dashboard, "stopped")).toBeUndefined();
  });

  it("closes the selected session detail after stopping that session", () => {
    const state = createInitialState();
    state.selectedSessionId = "codex_thr_desktop";
    state.consoleError = "Session codex_thr_desktop is running";
    state.sessionEvents = [
      { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" },
      { seq: 4, sessionId: "codex_other", type: "agent.output", text: "other session" }
    ];

    clearStoppedSessionSelection(state, "codex_thr_desktop");

    expect(state.selectedSessionId).toBeUndefined();
    expect(state.consoleError).toBeUndefined();
    expect(state.sessionEvents).toEqual([{ seq: 4, sessionId: "codex_other", type: "agent.output", text: "other session" }]);
  });

  it("clears the selected session detail when the session disappears from the dashboard", () => {
    const state = createInitialState();
    state.selectedSessionId = "codex_thr_desktop";
    state.consoleError = "Host event stream failed";
    state.sessionEvents = [
      { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" },
      { seq: 4, sessionId: "codex_other", type: "agent.output", text: "other session" }
    ];

    clearMissingSessionSelection(state, [
      {
        id: "codex_other",
        adapterId: "codex",
        workspace: "E:/repo",
        status: "running",
        startedAt: "2026-07-02T20:00:00.000Z",
        lastSeq: 4
      }
    ]);

    expect(state.selectedSessionId).toBeUndefined();
    expect(state.consoleError).toBeUndefined();
    expect(state.sessionEvents).toEqual([{ seq: 4, sessionId: "codex_other", type: "agent.output", text: "other session" }]);
  });

  it("appends the local user input event before host delivery completes", () => {
    const state = createInitialState();
    state.sessionEvents = [{ seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" }];

    appendLocalUserInput(state, "codex_thr_desktop", "continue");

    expect(state.sessionEvents.at(-1)).toMatchObject({
      sessionId: "codex_thr_desktop",
      type: "agent.input",
      text: "continue"
    });
    expect(state.sessionEvents).toHaveLength(2);
    expect(state.sessionEvents[0]?.type).toBe("agent.output");
  });

  it("does not append a local user input placeholder after the canonical host event already arrived", () => {
    const state = createInitialState();
    state.sessionEvents = [
      { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" },
      { seq: 4, sessionId: "codex_thr_desktop", type: "agent.input", text: "continue" }
    ];

    appendLocalUserInput(state, "codex_thr_desktop", "continue");

    expect(state.sessionEvents).toEqual([
      { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" },
      { seq: 4, sessionId: "codex_thr_desktop", type: "agent.input", text: "continue" }
    ]);
  });

  it("replaces a matching local user input placeholder when the host sends the canonical event", () => {
    const state = createInitialState();
    state.sessionEvents = [
      { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" },
      { seq: -1, sessionId: "codex_thr_desktop", type: "agent.input", text: "continue" }
    ];

    reconcileCanonicalSessionEvent(state, {
      seq: 4,
      sessionId: "codex_thr_desktop",
      type: "agent.input",
      text: "continue"
    });

    expect(state.sessionEvents).toEqual([
      { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" },
      { seq: 4, sessionId: "codex_thr_desktop", type: "agent.input", text: "continue" }
    ]);
  });

  it("reuses the current host client config when host, port, and pairing token stay the same", () => {
    expect(
      isSameHostClientTarget(
        { host: "127.0.0.1", port: 17365, pairingToken: "pairing-token-123" },
        { host: "127.0.0.1", port: 17365, pairingToken: "pairing-token-123" }
      )
    ).toBe(true);

    expect(
      isSameHostClientTarget(
        { host: "127.0.0.1", port: 17365, pairingToken: "pairing-token-123" },
        { host: "127.0.0.1", port: 17365, pairingToken: "pairing-token-456" }
      )
    ).toBe(false);
  });

  it("loads trusted devices from the registry and passes them into host startup", async () => {
    const state = createInitialState();
    const trustedDevices = [
      {
        deviceId: "android-remembered",
        clientType: "android-app" as const,
        pairedAt: "2026-07-06T10:00:00.000Z",
        deviceSecretHash: "hash_abc"
      }
    ];
    const controller = {
      start: vi.fn(async () => ({ mode: "spawned" as const }))
    };
    const provider = {
      resetHostClient: vi.fn(),
      safeRefresh: vi.fn(async () => undefined)
    };
    const registry = {
      load: vi.fn(async () => trustedDevices)
    };

    await startHost(controller as never, state, provider as never, "E:/extensions/agent-mobile-control", registry as never);

    expect(registry.load).toHaveBeenCalledOnce();
    expect(controller.start).toHaveBeenCalledWith(
      expect.objectContaining({
        trustedDevices
      })
    );
  });

  it("syncs trusted devices into persistent storage when the runtime registry changes", async () => {
    const registry = {
      load: vi.fn(async () => []),
      sync: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    };
    const handleTrustedDevicesChanged = createTrustedDeviceChangeHandler(registry as never);

    const trustedDevices = [
      {
        deviceId: "android-remembered",
        clientType: "android-app",
        pairedAt: "2026-07-06T10:00:00.000Z",
        deviceSecretHash: "hash_abc"
      },
      {
        deviceId: "android-revoked",
        clientType: "android-app",
        pairedAt: "2026-07-06T09:00:00.000Z",
        deviceSecretHash: "hash_old",
        revokedAt: "2026-07-06T11:00:00.000Z"
      }
    ];

    await handleTrustedDevicesChanged(trustedDevices);

    expect(registry.sync).toHaveBeenCalledWith(trustedDevices);
    expect(registry.remove).not.toHaveBeenCalled();
  });
});
