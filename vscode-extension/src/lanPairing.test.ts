import { describe, expect, it, vi } from "vitest";

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
    getConfiguration: vi.fn(),
    workspaceFolders: []
  }
}));

import { disableLanPairing } from "./extension.js";

describe("LAN pairing commands", () => {
  it("requests the running host to stop when LAN pairing is disabled", async () => {
    const controller = {
      stop: vi.fn()
    };
    const provider = {
      safeRefresh: vi.fn(async () => undefined)
    };
    const state = {
      lanEnabled: true,
      pairingToken: "pairing-token-123",
      host: "192.168.1.10",
      port: 17365,
      pairingJson: "{}"
    };
    const fetchHostDashboardStatus = vi.fn(async () => ({
      reachable: true as const,
      status: {
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
            pairingToken: "pairing-token-live",
            deviceName: "VS Code"
          }
        },
        devices: [],
        agents: [],
        sessions: []
      }
    }));
    const requestHostStop = vi.fn(async () => undefined);

    await (disableLanPairing as typeof disableLanPairing & ((...args: unknown[]) => Promise<void>))(controller, state, provider, {
      fetchHostDashboardStatus,
      requestHostStop
    });

    expect(fetchHostDashboardStatus).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 17365
    });
    expect(requestHostStop).toHaveBeenCalledWith({
      port: 17365,
      pairingToken: "pairing-token-live"
    });
    expect(controller.stop).not.toHaveBeenCalled();
    expect(provider.safeRefresh).toHaveBeenCalledOnce();
    expect(state).toMatchObject({
      lanEnabled: false,
      host: "127.0.0.1",
      pairingJson: "{}"
    });
  });

  it("falls back to stopping the local controller when the host is unreachable", async () => {
    const controller = {
      stop: vi.fn()
    };
    const provider = {
      safeRefresh: vi.fn(async () => undefined)
    };
    const state = {
      lanEnabled: true,
      host: "192.168.1.10",
      port: 17365,
      pairingJson: "{}"
    };
    const fetchHostDashboardStatus = vi.fn(async () => ({
      reachable: false as const,
      error: "offline"
    }));
    const requestHostStop = vi.fn(async () => undefined);

    await (disableLanPairing as typeof disableLanPairing & ((...args: unknown[]) => Promise<void>))(controller, state, provider, {
      fetchHostDashboardStatus,
      requestHostStop
    });

    expect(controller.stop).toHaveBeenCalledOnce();
    expect(requestHostStop).not.toHaveBeenCalled();
    expect(provider.safeRefresh).toHaveBeenCalledOnce();
  });
});
