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
          clientType: "unknown"
        })
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
});
