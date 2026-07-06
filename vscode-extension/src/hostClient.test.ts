import { describe, expect, it, vi } from "vitest";
import { LocalHostSessionClient } from "./hostClient.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("LocalHostSessionClient", () => {
  it("pairs as the VS Code client and uses the access token for session operations", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/pair")) {
        return jsonResponse({ accessToken: "access_vscode", expiresAt: "2026-07-03T12:00:00.000Z" });
      }
      if (href.endsWith("/sessions/codex_thr_desktop/attach")) {
        expect(init?.headers).toMatchObject({ authorization: "Bearer access_vscode" });
        return jsonResponse({ ok: true }, 202);
      }
      if (href.endsWith("/sessions/codex_thr_desktop/input")) {
        expect(init?.headers).toMatchObject({ authorization: "Bearer access_vscode" });
        expect(JSON.parse(String(init?.body))).toEqual({ text: "continue" });
        return jsonResponse({ ok: true }, 202);
      }
      if (href.endsWith("/sessions/codex_thr_desktop/control")) {
        expect(init?.headers).toMatchObject({ authorization: "Bearer access_vscode" });
        expect(JSON.parse(String(init?.body))).toEqual({ command: "stop" });
        return jsonResponse({ ok: true }, 202);
      }
      throw new Error(`Unexpected request ${href}`);
    });
    const client = new LocalHostSessionClient({
      host: "127.0.0.1",
      port: 17365,
      pairingToken: "pairing-token-123",
      fetchImpl
    });

    await client.attachSession("codex_thr_desktop");
    await client.sendInput("codex_thr_desktop", "continue");
    await client.stopSession("codex_thr_desktop");

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:17365/pair",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          pairingToken: "pairing-token-123",
          deviceId: "vscode-extension",
          clientType: "desktop-extension"
        })
      })
    );
  });

  it("revokes a paired mobile device with the current access token", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/pair")) {
        return jsonResponse({ accessToken: "access_vscode", expiresAt: "2026-07-03T12:00:00.000Z" });
      }
      if (href.endsWith("/devices/android_1/revoke")) {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({ authorization: "Bearer access_vscode" });
        return jsonResponse({ ok: true }, 202);
      }
      throw new Error(`Unexpected request ${href}`);
    });
    const client = new LocalHostSessionClient({
      host: "127.0.0.1",
      port: 17365,
      pairingToken: "pairing-token-123",
      fetchImpl
    });

    await client.revokeDevice("android_1");

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:17365/devices/android_1/revoke",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer access_vscode" })
      })
    );
  });

  it("re-pairs once when a session operation returns unauthorized", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ accessToken: "access_old", expiresAt: "2026-07-03T12:00:00.000Z" }))
      .mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "access_new", expiresAt: "2026-07-03T12:05:00.000Z" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 202));
    const client = new LocalHostSessionClient({
      host: "127.0.0.1",
      port: 17365,
      pairingToken: "pairing-token-123",
      fetchImpl
    });

    await client.attachSession("codex_thr_desktop");

    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:17365/sessions/codex_thr_desktop/attach",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer access_new" })
      })
    );
  });

  it("fetches cached console events over HTTP", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/pair")) {
        return jsonResponse({ accessToken: "access_vscode", expiresAt: "2026-07-03T12:00:00.000Z" });
      }
      if (href.endsWith("/events?lastSeq=7")) {
        expect(init?.headers).toMatchObject({ authorization: "Bearer access_vscode" });
        return jsonResponse([
          {
            id: "msg_8",
            type: "agent.output",
            sessionId: "codex_thr_desktop",
            deviceId: "agent-host",
            timestamp: "2026-07-03T12:00:00.000Z",
            seq: 8,
            payload: { text: "history" }
          }
        ]);
      }
      throw new Error(`Unexpected request ${href}`);
    });
    const client = new LocalHostSessionClient({
      host: "127.0.0.1",
      port: 17365,
      pairingToken: "pairing-token-123",
      fetchImpl
    });

    const events = await client.fetchEvents(7);

    expect(events).toEqual([{ seq: 8, sessionId: "codex_thr_desktop", type: "agent.output", text: "history" }]);
  });

  it("parses cached user input events for transcript rendering", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/pair")) {
        return jsonResponse({ accessToken: "access_vscode", expiresAt: "2026-07-03T12:00:00.000Z" });
      }
      if (href.endsWith("/events?lastSeq=0")) {
        return jsonResponse([
          {
            id: "msg_9",
            type: "agent.input",
            sessionId: "codex_thr_desktop",
            deviceId: "vscode-extension",
            timestamp: "2026-07-03T12:00:00.000Z",
            seq: 9,
            payload: { text: "continue" }
          }
        ]);
      }
      throw new Error(`Unexpected request ${href}`);
    });
    const client = new LocalHostSessionClient({
      host: "127.0.0.1",
      port: 17365,
      pairingToken: "pairing-token-123",
      fetchImpl
    });

    const events = await client.fetchEvents(0);

    expect(events).toEqual([{ seq: 9, sessionId: "codex_thr_desktop", type: "agent.input", text: "continue" }]);
  });

  it("re-pairs once when fetching cached console events returns unauthorized", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ accessToken: "access_old", expiresAt: "2026-07-03T12:00:00.000Z" }))
      .mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "access_new", expiresAt: "2026-07-03T12:05:00.000Z" }))
      .mockResolvedValueOnce(jsonResponse([]));
    const client = new LocalHostSessionClient({
      host: "127.0.0.1",
      port: 17365,
      pairingToken: "pairing-token-123",
      fetchImpl
    });

    await client.fetchEvents(11);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:17365/events?lastSeq=11",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer access_new" })
      })
    );
  });

  it("re-pairs once when the event stream closes as unauthorized", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ accessToken: "access_old", expiresAt: "2026-07-03T12:00:00.000Z" }))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "access_new", expiresAt: "2026-07-03T12:05:00.000Z" }));
    const sockets: Array<{
      url: string;
      onopen: ((event: unknown) => void) | null;
      onmessage: ((event: { data: unknown }) => void) | null;
      onerror: ((event: unknown) => void) | null;
      onclose: ((event: unknown) => void) | null;
      close: () => void;
    }> = [];
    const client = new LocalHostSessionClient({
      host: "127.0.0.1",
      port: 17365,
      pairingToken: "pairing-token-123",
      fetchImpl,
      webSocketFactory: (url) => {
        const socket = {
          url,
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          close: vi.fn()
        };
        sockets.push(socket);
        return socket;
      }
    });

    client.subscribe({
      lastSeq: 7,
      onEvent: vi.fn(),
      onError: vi.fn()
    });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].onclose?.({ code: 1008, reason: "Unauthorized" });

    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    expect(sockets[0].url).toContain("token=access_old");
    expect(sockets[1].url).toContain("token=access_new");
    expect(sockets[1].url).toContain("lastSeq=7");
  });

  it("does not report a transient stream error when unauthorized close is recovered", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ accessToken: "access_old", expiresAt: "2026-07-03T12:00:00.000Z" }))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "access_new", expiresAt: "2026-07-03T12:05:00.000Z" }));
    const sockets: Array<{
      url: string;
      onopen: ((event: unknown) => void) | null;
      onmessage: ((event: { data: unknown }) => void) | null;
      onerror: ((event: unknown) => void) | null;
      onclose: ((event: unknown) => void) | null;
      close: () => void;
    }> = [];
    const onError = vi.fn();
    const client = new LocalHostSessionClient({
      host: "127.0.0.1",
      port: 17365,
      pairingToken: "pairing-token-123",
      fetchImpl,
      webSocketFactory: (url) => {
        const socket = {
          url,
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          close: vi.fn()
        };
        sockets.push(socket);
        return socket;
      }
    });

    client.subscribe({
      lastSeq: 7,
      onEvent: vi.fn(),
      onError
    });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].onerror?.({});
    sockets[0].onclose?.({ code: 1008, reason: "Unauthorized" });

    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    expect(onError).not.toHaveBeenCalled();
  });

  it("re-pairs once when the event stream fails before delivering events", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ accessToken: "access_old", expiresAt: "2026-07-03T12:00:00.000Z" }))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "access_new", expiresAt: "2026-07-03T12:05:00.000Z" }));
    const sockets: Array<{
      url: string;
      onopen: ((event: unknown) => void) | null;
      onmessage: ((event: { data: unknown }) => void) | null;
      onerror: ((event: unknown) => void) | null;
      onclose: ((event: unknown) => void) | null;
      close: () => void;
    }> = [];
    const onError = vi.fn();
    const client = new LocalHostSessionClient({
      host: "127.0.0.1",
      port: 17365,
      pairingToken: "pairing-token-123",
      fetchImpl,
      webSocketFactory: (url) => {
        const socket = {
          url,
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          close: vi.fn()
        };
        sockets.push(socket);
        return socket;
      }
    });

    client.subscribe({
      lastSeq: 11,
      onEvent: vi.fn(),
      onError
    });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].onerror?.({});
    sockets[0].onclose?.({ code: 1006, reason: "" });

    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    expect(sockets[0].url).toContain("token=access_old");
    expect(sockets[1].url).toContain("token=access_new");
    expect(sockets[1].url).toContain("lastSeq=11");
    expect(onError).not.toHaveBeenCalled();
  });
});
