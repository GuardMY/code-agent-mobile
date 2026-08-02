import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import {
  pairSuccessResponseSchema,
  reauthResponseSchema,
  type ApprovalRequest,
  type DeviceSummary,
  type SessionSummary,
  type TrustedDeviceRecord
} from "@agent-mobile/protocol";
import { buildServer } from "./server.js";
import { SessionManager, type AgentAdapter, type SessionStorage } from "./sessions/sessionManager.js";

const adapter: AgentAdapter = {
  id: "codex",
  displayName: "Codex",
  start: async () => ({
    sendInput: () => undefined,
    stop: async () => 0
  })
};

function createTestContext(input: {
  storage?: SessionStorage;
  accessTokenTtlMs?: number;
  trustedDevices?: TrustedDeviceRecord[];
  relayUrl?: string;
  hostId?: string;
  relayToken?: string;
} = {}) {
  const manager = new SessionManager({ adapter, eventCacheSize: 10, workspace: "E:/repo", storage: input.storage });
  const app = buildServer({
    manager,
    version: "0.1.0",
    lanEnabled: true,
    pairingToken: "pairing-token-123",
    deviceName: "devbox",
    accessTokenTtlMs: input.accessTokenTtlMs,
    trustedDevices: input.trustedDevices,
    relayUrl: input.relayUrl,
    hostId: input.hostId,
    relayToken: input.relayToken
  });
  return { app, manager };
}

function createTestServer(input: {
  storage?: SessionStorage;
  accessTokenTtlMs?: number;
  trustedDevices?: TrustedDeviceRecord[];
  relayUrl?: string;
  hostId?: string;
  relayToken?: string;
} = {}) {
  return createTestContext(input).app;
}

async function pair(app: ReturnType<typeof createTestServer>): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/pair",
    payload: { pairingToken: "pairing-token-123", deviceId: "android_1" }
  });
  return response.json().accessToken;
}

describe("agent host server", () => {
  it("reports health without authentication", async () => {
    const app = createTestServer({ accessTokenTtlMs: 1 });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, version: "0.1.0", lanEnabled: true });
  });

  it("rejects unauthenticated session list requests", async () => {
    const app = createTestServer();

    const response = await app.inject({ method: "GET", url: "/sessions" });

    expect(response.statusCode).toBe(401);
  });

  it("exchanges a valid pairing token for an access token", async () => {
    const app = createTestServer();

    const response = await app.inject({
      method: "POST",
      url: "/pair",
      payload: { pairingToken: "pairing-token-123", deviceId: "android_1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accessToken).toMatch(/^access_/);
  });

  it("returns device secret on first pairing and remembers the device", async () => {
    const app = createTestServer();

    const response = await app.inject({
      method: "POST",
      url: "/pair",
      payload: { pairingToken: "pairing-token-123", deviceId: "android-001", clientType: "android-app" }
    });

    expect(response.statusCode).toBe(200);
    const body = pairSuccessResponseSchema.parse(response.json());
    expect(body.deviceId).toBe("android-001");
    expect(body.deviceSecret).toMatch(/^secret_/);
  });

  it("allows re-pairing a revoked device id and rotates the trusted record", async () => {
    const app = createTestServer();
    const firstPairResponse = await app.inject({
      method: "POST",
      url: "/pair",
      payload: { pairingToken: "pairing-token-123", deviceId: "android-001", clientType: "android-app" }
    });
    const firstPair = pairSuccessResponseSchema.parse(firstPairResponse.json());

    const revoke = await app.inject({
      method: "POST",
      url: "/devices/android-001/revoke",
      headers: { authorization: `Bearer ${firstPair.accessToken}` }
    });
    const secondPair = await app.inject({
      method: "POST",
      url: "/pair",
      payload: { pairingToken: "pairing-token-123", deviceId: "android-001", clientType: "android-app" }
    });
    const secondPaired = pairSuccessResponseSchema.parse(secondPair.json());
    const oldSecretReauth = await app.inject({
      method: "POST",
      url: "/devices/reauth",
      payload: { deviceId: firstPair.deviceId, deviceSecret: firstPair.deviceSecret }
    });
    const newSecretReauth = await app.inject({
      method: "POST",
      url: "/devices/reauth",
      payload: { deviceId: secondPaired.deviceId, deviceSecret: secondPaired.deviceSecret }
    });
    const status = await app.inject({
      method: "GET",
      url: "/status",
      headers: { "x-agent-mobile-pairing-token": "pairing-token-123" },
      remoteAddress: "127.0.0.1"
    });

    expect(revoke.statusCode).toBe(202);
    expect(secondPair.statusCode).toBe(200);
    expect(secondPaired.deviceSecret).toMatch(/^secret_/);
    expect(secondPaired.deviceSecret).not.toBe(firstPair.deviceSecret);
    expect(oldSecretReauth.statusCode).toBe(401);
    expect(newSecretReauth.statusCode).toBe(200);
    expect(status.json().trustedDevices).toEqual([
      expect.objectContaining({
        deviceId: "android-001",
        clientType: "android-app"
      })
    ]);
    expect(status.json().trustedDevices[0]).not.toHaveProperty("revokedAt");
  });

  it("rejects an invalid pairing token", async () => {
    const app = createTestServer();

    const response = await app.inject({
      method: "POST",
      url: "/pair",
      payload: { pairingToken: "wrong-token", deviceId: "android_1" }
    });

    expect(response.statusCode).toBe(401);
  });

  it("keeps pairing available without a pairing expiry time", async () => {
    const app = createTestServer();

    const response = await app.inject({
      method: "POST",
      url: "/pair",
      payload: { pairingToken: "pairing-token-123", deviceId: "android_1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accessToken).toMatch(/^access_/);
  });

  it("keeps paired access tokens valid until the device is revoked", async () => {
    const app = createTestServer({ accessTokenTtlMs: 0 });
    const token = await pair(app);

    const response = await app.inject({
      method: "GET",
      url: "/sessions",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
  });

  it("issues a fresh access token for a remembered device", async () => {
    const app = createTestServer();
    const pairResponse = await app.inject({
      method: "POST",
      url: "/pair",
      payload: { pairingToken: "pairing-token-123", deviceId: "android-001", clientType: "android-app" }
    });
    const paired = pairSuccessResponseSchema.parse(pairResponse.json());

    const response = await app.inject({
      method: "POST",
      url: "/devices/reauth",
      payload: { deviceId: paired.deviceId, deviceSecret: paired.deviceSecret }
    });

    expect(response.statusCode).toBe(200);
    expect(reauthResponseSchema.parse(response.json()).accessToken).toMatch(/^access_/);
  });

  it("rejects malformed reauth input with a client error", async () => {
    const app = createTestServer();

    const response = await app.inject({
      method: "POST",
      url: "/devices/reauth",
      payload: { deviceId: "android-001" }
    });

    expect(response.statusCode).toBe(400);
  });

  it("loads bootstrapped trusted devices into the device list", async () => {
    const app = createTestServer({
      trustedDevices: [
        {
          deviceId: "desktop-001",
          clientType: "desktop-extension",
          pairedAt: "2026-07-06T09:00:00.000Z",
          deviceSecretHash: "hash_bootstrap"
        }
      ]
    });
    const token = await pair(app);

    const response = await app.inject({
      method: "GET",
      url: "/devices",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ deviceId: "desktop-001", clientType: "desktop-extension" })])
    );
  });

  it("returns conflict when sending input to a restored non-running session", async () => {
    const restoredSession: SessionSummary = {
      id: "sess_restored",
      adapterId: "codex",
      workspace: "E:/repo",
      status: "exited",
      startedAt: "2026-06-30T14:30:00.000Z",
      lastSeq: 1
    };
    const storage: SessionStorage = {
      loadSessions: async () => [restoredSession],
      saveSessions: async () => undefined,
      loadEvents: async () => [],
      appendEvent: async () => undefined
    };
    const { app, manager } = createTestContext({ storage });
    await manager.loadFromStorage();
    const token = await pair(app);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/sess_restored/input",
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "hello" }
    });

    expect(response.statusCode).toBe(409);
  });

  it("records paired devices and lists them without access tokens", async () => {
    const app = createTestServer();
    const token = await pair(app);

    const response = await app.inject({
      method: "GET",
      url: "/devices",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject([{ deviceId: "android_1", clientType: "android-app" }]);
    expect(JSON.stringify(response.json())).not.toContain("access_");
    expect(JSON.stringify(response.json())).not.toContain("accessTokenExpiresAt");
  });

  it("records WeChat mini program clients during pairing", async () => {
    const app = createTestServer();

    const pairResponse = await app.inject({
      method: "POST",
      url: "/pair",
      payload: {
        pairingToken: "pairing-token-123",
        deviceId: "wechat_1",
        clientType: "wechat-mini-program"
      }
    });
    const token = pairResponse.json().accessToken;
    const devices = await app.inject({
      method: "GET",
      url: "/devices",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(pairResponse.statusCode).toBe(200);
    expect(devices.json()).toMatchObject([{ deviceId: "wechat_1", clientType: "wechat-mini-program" }]);
  });

  it("records VS Code extension clients during pairing", async () => {
    const app = createTestServer();

    const pairResponse = await app.inject({
      method: "POST",
      url: "/pair",
      payload: {
        pairingToken: "pairing-token-123",
        deviceId: "vscode-extension",
        clientType: "desktop-extension"
      }
    });
    const token = pairResponse.json().accessToken;
    const devices = await app.inject({
      method: "GET",
      url: "/devices",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(pairResponse.statusCode).toBe(200);
    expect(devices.json()).toMatchObject([{ deviceId: "vscode-extension", clientType: "desktop-extension" }]);
  });

  it("returns dashboard status with server, pairing, devices, agents, and sessions", async () => {
    const { app, manager } = createTestContext();
    await app.inject({
      method: "POST",
      url: "/pair",
      payload: { pairingToken: "pairing-token-123", deviceId: "android_1", clientType: "android-app" }
    });
    await manager.createSession();

    const response = await app.inject({
      method: "GET",
      url: "/status",
      headers: { "x-agent-mobile-pairing-token": "pairing-token-123" },
      remoteAddress: "127.0.0.1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      server: {
        running: true,
        lanEnabled: true,
        host: "127.0.0.1",
        port: 17365,
        deviceName: "devbox",
        version: "0.1.0"
      },
      pairing: {
        enabled: true,
        pairingPayload: {
          pairingToken: "pairing-token-123",
          deviceName: "devbox"
        }
      },
      devices: [{ deviceId: "android_1", clientType: "android-app" }],
      agents: [
        { id: "codex", displayName: "Codex", availability: "available", activeSessions: 1, latestSessionStatus: "running" },
        { id: "claude-code", displayName: "Claude Code", activeSessions: 0 },
        { id: "opencode", displayName: "OpenCode", activeSessions: 0 }
      ]
    });
    expect(response.json().sessions).toHaveLength(1);
    expect(response.json().trustedDevices).toEqual([
      expect.objectContaining({
        deviceId: "android_1",
        clientType: "android-app",
        deviceSecretHash: expect.any(String)
      })
    ]);
    expect(response.json().devices).toEqual([
      expect.not.objectContaining({
        deviceSecretHash: expect.any(String)
      })
    ]);
  });

  it("includes configured relay credentials in the status pairing payload", async () => {
    const app = createTestServer({
      relayUrl: "wss://relay.example.com",
      hostId: "host_12345678",
      relayToken: "relay-token-123456"
    });

    const response = await app.inject({
      method: "GET",
      url: "/status",
      remoteAddress: "127.0.0.1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().pairing.pairingPayload).toMatchObject({
      relayUrl: "wss://relay.example.com",
      hostId: "host_12345678",
      relayToken: "relay-token-123456"
    });
  });

  it("allows loopback status discovery without the pairing token", async () => {
    const { app, manager } = createTestContext();
    await manager.createSession();

    const response = await app.inject({
      method: "GET",
      url: "/status",
      remoteAddress: "127.0.0.1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      pairing: {
        pairingPayload: {
          pairingToken: "pairing-token-123"
        }
      },
      sessions: [expect.objectContaining({ adapterId: "codex", status: "running" })]
    });
  });

  it("requires authorization for relay-marked loopback status requests", async () => {
    const app = createTestServer();

    const response = await app.inject({
      method: "GET",
      url: "/status",
      headers: { "x-agent-mobile-relay-request": "1" },
      remoteAddress: "127.0.0.1"
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects non-loopback status discovery without the pairing token", async () => {
    const app = createTestServer();

    const response = await app.inject({
      method: "GET",
      url: "/status",
      remoteAddress: "192.168.1.22"
    });

    expect(response.statusCode).toBe(401);
  });

  it("accepts a host stop request and calls the configured stop handler", async () => {
    const stopHost = vi.fn(async () => undefined);
    const manager = new SessionManager({ adapter, eventCacheSize: 10, workspace: "E:/repo" });
    const app = buildServer({
      manager,
      version: "0.1.0",
      lanEnabled: true,
      pairingToken: "pairing-token-123",
      deviceName: "devbox",
      stopHost
    });

    const response = await app.inject({
      method: "POST",
      url: "/host/control",
      headers: { "x-agent-mobile-pairing-token": "pairing-token-123" },
      payload: { command: "stop" }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true });
    expect(stopHost).toHaveBeenCalledOnce();
  });

  it("keeps dashboard status available when desktop Codex discovery fails", async () => {
    const desktopAdapter: AgentAdapter = {
      id: "codex",
      displayName: "Codex",
      start: vi.fn(async () => ({
        sendInput: vi.fn(),
        stop: vi.fn(async () => 0)
      })),
      discoverSessions: vi.fn(async () => {
        throw new Error("codex app-server failed");
      })
    };
    const manager = new SessionManager({ adapter: desktopAdapter, eventCacheSize: 10, workspace: "E:/repo" });
    const app = buildServer({
      manager,
      version: "0.1.0",
      lanEnabled: true,
      pairingToken: "pairing-token-123",
      deviceName: "devbox"
    });
    const token = await pair(app);

    const response = await app.inject({
      method: "GET",
      url: "/status",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.sessions).toEqual([]);
    expect(body.agents).toContainEqual(
      expect.objectContaining({ id: "codex", activeSessions: 0, availability: "missing" })
    );
  });

  it("syncs desktop Codex sessions before listing sessions", async () => {
    const process = {
      sendInput: vi.fn(),
      stop: vi.fn(async () => 0)
    };
    const desktopAdapter: AgentAdapter = {
      id: "codex",
      displayName: "Codex",
      start: vi.fn(async () => process),
      discoverSessions: vi.fn(async () => [
        {
          id: "thr_desktop",
          workspace: "E:/repo",
          title: "Desktop thread",
          updatedAt: "2026-07-02T20:00:00.000Z"
        }
      ]),
      attachSession: vi.fn(async () => process)
    };
    const manager = new SessionManager({ adapter: desktopAdapter, eventCacheSize: 10, workspace: "E:/repo" });
    const app = buildServer({
      manager,
      version: "0.1.0",
      lanEnabled: true,
      pairingToken: "pairing-token-123",
      deviceName: "devbox"
    });
    const token = await pair(app);

    const response = await app.inject({
      method: "GET",
      url: "/sessions",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        id: "codex_thr_desktop",
        adapterId: "codex",
        title: "Desktop thread",
        status: "running"
      })
    ]);
  });

  it("disables mobile-created Codex sessions", async () => {
    const app = createTestServer();
    const token = await pair(app);

    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "Start Codex sessions on the desktop first" });
  });

  it("attaches a discovered desktop Codex session without sending input", async () => {
    const process = {
      sendInput: vi.fn(),
      stop: vi.fn(async () => 0)
    };
    const desktopAdapter: AgentAdapter = {
      id: "codex",
      displayName: "Codex",
      start: vi.fn(async () => process),
      discoverSessions: vi.fn(async () => [
        {
          id: "thr_desktop",
          workspace: "E:/repo",
          updatedAt: "2026-07-02T20:00:00.000Z"
        }
      ]),
      attachSession: vi.fn(async ({ onOutput }) => {
        onOutput("stdout", "history");
        return process;
      })
    };
    const manager = new SessionManager({ adapter: desktopAdapter, eventCacheSize: 10, workspace: "E:/repo" });
    const app = buildServer({
      manager,
      version: "0.1.0",
      lanEnabled: true,
      pairingToken: "pairing-token-123",
      deviceName: "devbox"
    });
    const token = await pair(app);

    await app.inject({
      method: "GET",
      url: "/sessions",
      headers: { authorization: `Bearer ${token}` }
    });
    const response = await app.inject({
      method: "POST",
      url: "/sessions/codex_thr_desktop/attach",
      headers: { authorization: `Bearer ${token}` }
    });
    const repeat = await app.inject({
      method: "POST",
      url: "/sessions/codex_thr_desktop/attach",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true });
    expect(repeat.statusCode).toBe(202);
    expect(desktopAdapter.attachSession).toHaveBeenCalledTimes(1);
    expect(process.sendInput).not.toHaveBeenCalled();
    expect(manager.eventsAfter(0)).toEqual([
      expect.objectContaining({
        type: "agent.output",
        sessionId: "codex_thr_desktop",
        payload: { text: "history" }
      })
    ]);
  });

  it("syncs desktop Codex sessions before attaching by id", async () => {
    const process = {
      sendInput: vi.fn(),
      stop: vi.fn(async () => 0)
    };
    const desktopAdapter: AgentAdapter = {
      id: "codex",
      displayName: "Codex",
      start: vi.fn(async () => process),
      discoverSessions: vi.fn(async () => [
        {
          id: "thr_desktop",
          workspace: "E:/repo",
          updatedAt: "2026-07-02T20:00:00.000Z"
        }
      ]),
      attachSession: vi.fn(async () => process)
    };
    const manager = new SessionManager({ adapter: desktopAdapter, eventCacheSize: 10, workspace: "E:/repo" });
    const app = buildServer({
      manager,
      version: "0.1.0",
      lanEnabled: true,
      pairingToken: "pairing-token-123",
      deviceName: "devbox"
    });
    const token = await pair(app);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/codex_thr_desktop/attach",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(202);
    expect(desktopAdapter.attachSession).toHaveBeenCalledWith(expect.objectContaining({ externalId: "thr_desktop" }));
  });

  it("stops a discovered desktop Codex session even before it has been attached", async () => {
    const process = {
      sendInput: vi.fn(),
      stop: vi.fn(async () => 0)
    };
    const desktopAdapter: AgentAdapter = {
      id: "codex",
      displayName: "Codex",
      start: vi.fn(async () => process),
      discoverSessions: vi.fn(async () => [
        {
          id: "thr_desktop",
          workspace: "E:/repo",
          updatedAt: "2026-07-02T20:00:00.000Z"
        }
      ]),
      attachSession: vi.fn(async () => process)
    };
    const manager = new SessionManager({ adapter: desktopAdapter, eventCacheSize: 10, workspace: "E:/repo" });
    const app = buildServer({
      manager,
      version: "0.1.0",
      lanEnabled: true,
      pairingToken: "pairing-token-123",
      deviceName: "devbox"
    });
    const token = await pair(app);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/codex_thr_desktop/control",
      headers: { authorization: `Bearer ${token}` },
      payload: { command: "stop" }
    });

    expect(response.statusCode).toBe(202);
    expect(desktopAdapter.attachSession).toHaveBeenCalledWith(expect.objectContaining({ externalId: "thr_desktop" }));
    expect(process.stop).toHaveBeenCalledOnce();
  });

  it("keeps an attached desktop session stoppable even if discovery stops reporting it after input", async () => {
    const process = {
      sendInput: vi.fn(async () => undefined),
      stop: vi.fn(async () => 0)
    };
    const desktopAdapter: AgentAdapter = {
      id: "codex",
      displayName: "Codex",
      start: vi.fn(async () => process),
      discoverSessions: vi.fn()
        .mockResolvedValueOnce([
          {
            id: "thr_desktop",
            workspace: "E:/repo",
            updatedAt: "2026-07-02T20:00:00.000Z"
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "thr_desktop",
            workspace: "E:/repo",
            updatedAt: "2026-07-02T20:00:00.000Z"
          }
        ])
        .mockResolvedValueOnce([]),
      attachSession: vi.fn(async () => process)
    };
    const manager = new SessionManager({ adapter: desktopAdapter, eventCacheSize: 10, workspace: "E:/repo" });
    const app = buildServer({
      manager,
      version: "0.1.0",
      lanEnabled: true,
      pairingToken: "pairing-token-123",
      deviceName: "devbox"
    });
    const token = await pair(app);

    await app.inject({
      method: "POST",
      url: "/sessions/codex_thr_desktop/attach",
      headers: { authorization: `Bearer ${token}` }
    });
    await app.inject({
      method: "POST",
      url: "/sessions/codex_thr_desktop/input",
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "continue" }
    });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/codex_thr_desktop/control",
      headers: { authorization: `Bearer ${token}` },
      payload: { command: "stop" }
    });

    expect(response.statusCode).toBe(202);
    expect(process.stop).toHaveBeenCalledOnce();
  });

  it("drops archived desktop Codex sessions from the status payload on the next refresh", async () => {
    const process = {
      sendInput: vi.fn(),
      stop: vi.fn(async () => 0)
    };
    const desktopAdapter: AgentAdapter = {
      id: "codex",
      displayName: "Codex",
      start: vi.fn(async () => process),
      discoverSessions: vi.fn()
        .mockResolvedValueOnce([
          {
            id: "thr_desktop",
            workspace: "E:/repo",
            title: "Desktop thread",
            updatedAt: "2026-07-02T20:00:00.000Z"
          }
        ])
        .mockResolvedValueOnce([]),
      attachSession: vi.fn(async () => process)
    };
    const manager = new SessionManager({ adapter: desktopAdapter, eventCacheSize: 10, workspace: "E:/repo" });
    const app = buildServer({
      manager,
      version: "0.1.0",
      lanEnabled: true,
      pairingToken: "pairing-token-123",
      deviceName: "devbox"
    });
    const token = await pair(app);

    const first = await app.inject({
      method: "GET",
      url: "/status",
      headers: { authorization: `Bearer ${token}` }
    });
    const second = await app.inject({
      method: "GET",
      url: "/status",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().sessions).toEqual([expect.objectContaining({ id: "codex_thr_desktop" })]);
    expect(second.statusCode).toBe(200);
    expect(second.json().sessions).toEqual([]);
  });

  it("returns cached session events over HTTP after a sequence number", async () => {
    const { app, manager } = createTestContext();
    const token = await pair(app);
    await manager.createSession();

    const response = await app.inject({
      method: "GET",
      url: "/events?lastSeq=0",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        seq: 1,
        type: "session.started",
        sessionId: expect.any(String)
      })
    ]);
  });

  it("upgrades stream websocket connections and replays cached events", async () => {
    const { app, manager } = createTestContext();
    const token = await pair(app);
    await manager.createSession();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP test address");
    }

    const received = await new Promise<unknown[]>((resolve, reject) => {
      const messages: unknown[] = [];
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/stream?token=${token}&lastSeq=0`);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("Timed out waiting for stream replay"));
      }, 1_000);
      socket.on("message", (data) => {
        messages.push(JSON.parse(data.toString()));
        clearTimeout(timeout);
        socket.close();
        resolve(messages);
      });
      socket.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    await app.close();

    expect(received).toEqual([
      expect.objectContaining({
        seq: 1,
        type: "session.started",
        sessionId: expect.any(String)
      })
    ]);
  });

  it("rejects revoked devices on protected routes", async () => {
    const app = createTestServer();
    const token = await pair(app);

    const revoke = await app.inject({
      method: "POST",
      url: "/devices/android_1/revoke",
      headers: { authorization: `Bearer ${token}` }
    });
    const response = await app.inject({
      method: "GET",
      url: "/sessions",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(revoke.statusCode).toBe(202);
    expect(response.statusCode).toBe(401);
  });

  it("rejects reauth after revoke", async () => {
    const app = createTestServer();
    const pairResponse = await app.inject({
      method: "POST",
      url: "/pair",
      payload: { pairingToken: "pairing-token-123", deviceId: "android-001", clientType: "android-app" }
    });
    const paired = pairSuccessResponseSchema.parse(pairResponse.json());

    const revoke = await app.inject({
      method: "POST",
      url: "/devices/android-001/revoke",
      headers: { authorization: `Bearer ${paired.accessToken}` }
    });
    const response = await app.inject({
      method: "POST",
      url: "/devices/reauth",
      payload: { deviceId: paired.deviceId, deviceSecret: paired.deviceSecret }
    });

    expect(revoke.statusCode).toBe(202);
    expect(response.statusCode).toBe(401);
  });

  it("lists pending approvals and records approve decisions", async () => {
    const pending: ApprovalRequest = {
      approvalId: "appr_1",
      sessionId: "sess_1",
      risk: "high",
      action: "shell.execute",
      summary: "npm install",
      status: "pending",
      createdAt: "2026-06-30T14:30:00.000Z",
      timeoutSeconds: 300
    };
    const storage: SessionStorage = {
      loadSessions: async () => [],
      saveSessions: async () => undefined,
      loadEvents: async () => [],
      appendEvent: async () => undefined,
      loadDevices: async (): Promise<DeviceSummary[]> => [],
      saveDevices: async () => undefined,
      loadApprovals: async () => [pending],
      saveApprovals: async () => undefined
    };
    const { app, manager } = createTestContext({ storage });
    await manager.loadFromStorage();
    const token = await pair(app);

    const list = await app.inject({
      method: "GET",
      url: "/approvals",
      headers: { authorization: `Bearer ${token}` }
    });
    const respond = await app.inject({
      method: "POST",
      url: "/approvals/appr_1/respond",
      headers: { authorization: `Bearer ${token}` },
      payload: { decision: "approve" }
    });

    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject([{ approvalId: "appr_1", status: "pending" }]);
    expect(respond.statusCode).toBe(202);
    expect(respond.json()).toMatchObject({ approvalId: "appr_1", status: "approved" });
    expect(manager.eventsAfter(0).at(-1)?.type).toBe("approval.approve");
  });
});
