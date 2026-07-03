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
  it("stops the host instead of restarting local mode when LAN pairing is disabled", async () => {
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

    await disableLanPairing(controller, state, provider);

    expect(controller.stop).toHaveBeenCalledOnce();
    expect(provider.safeRefresh).toHaveBeenCalledOnce();
    expect(state).toMatchObject({
      lanEnabled: false,
      host: "127.0.0.1",
      pairingJson: "{}"
    });
  });
});
