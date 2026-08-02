import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseTrustedDevicesArgument, resolveRelayOptions } from "./index.js";

describe("agent host CLI", () => {
  it("parses trusted devices JSON for host bootstrap", () => {
    const devices = parseTrustedDevicesArgument(
      JSON.stringify([
        {
          deviceId: "desktop-001",
          clientType: "desktop-extension",
          pairedAt: "2026-07-06T09:00:00.000Z",
          deviceSecretHash: "hash_bootstrap",
          lastSeenAt: "2026-07-06T10:00:00.000Z"
        }
      ])
    );

    expect(devices).toEqual([
      {
        deviceId: "desktop-001",
        clientType: "desktop-extension",
        pairedAt: "2026-07-06T09:00:00.000Z",
        deviceSecretHash: "hash_bootstrap",
        lastSeenAt: "2026-07-06T10:00:00.000Z"
      }
    ]);
  });

  it("returns an empty trusted device list when bootstrap JSON is not provided", () => {
    expect(parseTrustedDevicesArgument(undefined)).toEqual([]);
  });

  it("validates a complete secure relay configuration", () => {
    expect(
      resolveRelayOptions({
        relayUrl: "wss://relay.example.com/",
        relayHostId: "host_12345678",
        relayToken: "relay-token-123456"
      })
    ).toEqual({
      relayUrl: "wss://relay.example.com",
      hostId: "host_12345678",
      relayToken: "relay-token-123456"
    });
  });

  it("rejects incomplete or insecure relay configuration", () => {
    expect(() => resolveRelayOptions({ relayUrl: "wss://relay.example.com" })).toThrow("configured together");
    expect(() =>
      resolveRelayOptions({
        relayUrl: "ws://relay.example.com",
        relayHostId: "host_12345678",
        relayToken: "relay-token-123456"
      })
    ).toThrow("wss://");
  });

  it("does not configure file-backed session storage by default", async () => {
    const source = await readFile(new URL("./cli.ts", import.meta.url), "utf8");

    expect(source).not.toContain("FileSessionStorage");
    expect(source).not.toContain("loadFromStorage");
  });

  it("avoids top-level await so the bundled host can be packaged as CommonJS", async () => {
    const source = await readFile(new URL("./cli.ts", import.meta.url), "utf8");

    expect(source).toContain("async function main()");
    expect(source).toContain("main().catch");
  });
});
