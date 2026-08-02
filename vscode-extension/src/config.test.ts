import { describe, expect, it } from "vitest";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { buildHostArgs, readAgentMobileConfig, resolveRelayConfig } from "./config.js";

describe("extension config", () => {
  it("keeps the bundled entrypoint path stable", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    expect(manifest.main).toBe("./dist/extension.cjs");
    await expect(access(new URL("../dist/extension.cjs", import.meta.url), fsConstants.F_OK)).resolves.toBeUndefined();
  });

  it("declares the pairing view as a webview contribution", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    expect(manifest.contributes.views.agentMobile).toContainEqual(
      expect.objectContaining({
        id: "agentMobile.pairingView",
        type: "webview"
      })
    );
  });

  it("uses defaults when settings are absent", () => {
    const config = readAgentMobileConfig({ get: (_key, fallback) => fallback });

    expect(config).toEqual({
      port: 17365,
      codexCommand: "codex",
      eventCacheSize: 500,
      relayUrl: undefined,
      relayHostId: undefined,
      relayToken: undefined
    });
  });

  it("accepts a complete WSS relay configuration", () => {
    const relay = resolveRelayConfig({
      port: 17365,
      codexCommand: "codex",
      eventCacheSize: 500,
      relayUrl: "wss://relay.example.com/",
      relayHostId: "host_12345678",
      relayToken: "relay-token-123456"
    });

    expect(relay).toEqual({
      relayUrl: "wss://relay.example.com",
      hostId: "host_12345678",
      relayToken: "relay-token-123456"
    });
  });

  it("rejects incomplete or cleartext relay configuration", () => {
    expect(() =>
      resolveRelayConfig({ port: 17365, codexCommand: "codex", eventCacheSize: 500, relayUrl: "wss://relay.example.com" })
    ).toThrow("configured together");
    expect(() =>
      resolveRelayConfig({
        port: 17365,
        codexCommand: "codex",
        eventCacheSize: 500,
        relayUrl: "ws://relay.example.com",
        relayHostId: "host_12345678",
        relayToken: "relay-token-123456"
      })
    ).toThrow("wss://");
  });

  it("builds host process arguments for LAN mode", () => {
    const args = buildHostArgs({
      host: "0.0.0.0",
        workspace: "E:/repo",
        pairingToken: "pairing-token-123",
        config: {
          port: 17365,
          codexCommand: "codex",
          eventCacheSize: 500
        }
      });

    expect(args).toContain("--host");
    expect(args).toContain("0.0.0.0");
    expect(args).not.toContain("--codex-args");
  });

  it("passes relay credentials only when public relay is configured", () => {
    const args = buildHostArgs({
      host: "127.0.0.1",
      workspace: "E:/repo",
      pairingToken: "pairing-token-123",
      config: { port: 17365, codexCommand: "codex", eventCacheSize: 500 },
      relay: {
        relayUrl: "wss://relay.example.com",
        hostId: "host_12345678",
        relayToken: "relay-token-123456"
      }
    });

    expect(args).toEqual(expect.arrayContaining(["--relay-url", "wss://relay.example.com", "--relay-host-id"]));
  });
});
