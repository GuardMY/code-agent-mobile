import { describe, expect, it, vi } from "vitest";
import { createEnvelope } from "@agent-mobile/protocol";
import { handleRelayMessage, type RelayFetch, type RelayResponder } from "./relayClient.js";
import type { SessionManager } from "./sessions/sessionManager.js";

describe("relay client message handling", () => {
  it("maps relay agent.start messages to session creation", async () => {
    const manager = {
      createSession: vi.fn(async () => ({ id: "sess_1" }))
    } as unknown as SessionManager;
    const message = createEnvelope({
      type: "agent.start",
      deviceId: "android_1",
      payload: {}
    });

    await handleRelayMessage(manager, JSON.stringify(message));

    expect(manager.createSession).toHaveBeenCalledOnce();
  });

  it("maps relay input and stop control messages to the target session", async () => {
    const manager = {
      sendInput: vi.fn(),
      stopSession: vi.fn()
    } as unknown as SessionManager;
    const input = createEnvelope({
      type: "agent.input",
      deviceId: "android_1",
      sessionId: "sess_1",
      payload: { text: "hello" }
    });
    const stop = createEnvelope({
      type: "agent.control.stop",
      deviceId: "android_1",
      sessionId: "sess_1",
      payload: {}
    });

    await handleRelayMessage(manager, JSON.stringify(input));
    await handleRelayMessage(manager, JSON.stringify(stop));

    expect(manager.sendInput).toHaveBeenCalledWith("sess_1", "hello");
    expect(manager.stopSession).toHaveBeenCalledWith("sess_1");
  });

  it("does not execute legacy commands received over the public relay handler", async () => {
    const manager = {
      createSession: vi.fn(),
      sendInput: vi.fn(),
      stopSession: vi.fn()
    } as unknown as SessionManager;
    const options = {
      manager,
      localBaseUrl: "http://127.0.0.1:17365"
    };
    const start = createEnvelope({ type: "agent.start", deviceId: "android_1", payload: {} });
    const input = createEnvelope({
      type: "agent.input",
      deviceId: "android_1",
      sessionId: "sess_1",
      payload: { text: "hello" }
    });
    const stop = createEnvelope({
      type: "agent.control.stop",
      deviceId: "android_1",
      sessionId: "sess_1",
      payload: {}
    });

    await handleRelayMessage(options, JSON.stringify(start));
    await handleRelayMessage(options, JSON.stringify(input));
    await handleRelayMessage(options, JSON.stringify(stop));

    expect(manager.createSession).not.toHaveBeenCalled();
    expect(manager.sendInput).not.toHaveBeenCalled();
    expect(manager.stopSession).not.toHaveBeenCalled();
  });

  it("proxies an allowed relay request to the fixed local API URL and returns its response", async () => {
    const fetch = vi.fn(async () => ({
      status: 202,
      text: vi.fn(async () => JSON.stringify({ ok: true }))
    })) as unknown as RelayFetch;
    const responder = vi.fn() as unknown as RelayResponder;
    const request = createEnvelope({
      type: "relay.request",
      deviceId: "android_1",
      payload: {
        requestId: "request_1",
        method: "POST",
        path: "/sessions/sess_1/input",
        headers: { Authorization: "Bearer access_123" },
        body: { text: "hello" }
      }
    });

    await handleRelayMessage(
      {
        manager: {} as SessionManager,
        localBaseUrl: "http://127.0.0.1:17365",
        fetch,
        responder
      },
      JSON.stringify(request)
    );

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17365/sessions/sess_1/input", {
      method: "POST",
      headers: {
        "x-agent-mobile-relay-request": "1",
        authorization: "Bearer access_123",
        "content-type": "application/json"
      },
      body: JSON.stringify({ text: "hello" })
    });
    expect(responder).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "relay.response",
        deviceId: "agent-host",
        payload: { requestId: "request_1", status: 202, body: { ok: true } }
      })
    );
  });

  it("forwards a serialized mobile JSON body without encoding it again", async () => {
    const fetch = vi.fn(async () => ({
      status: 202,
      text: vi.fn(async () => "")
    })) as unknown as RelayFetch;
    const responder = vi.fn() as unknown as RelayResponder;
    const body = JSON.stringify({ text: "hello" });
    const request = createEnvelope({
      type: "relay.request",
      deviceId: "android_1",
      payload: {
        requestId: "request_raw_body",
        method: "POST",
        path: "/sessions/sess_1/input",
        body
      }
    });

    await handleRelayMessage(
      {
        manager: {} as SessionManager,
        localBaseUrl: "http://127.0.0.1:17365",
        fetch,
        responder
      },
      JSON.stringify(request)
    );

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:17365/sessions/sess_1/input",
      expect.objectContaining({ body })
    );
  });

  it("rejects an invalid relay request with an RPC error response", async () => {
    const fetch = vi.fn() as unknown as RelayFetch;
    const responder = vi.fn() as unknown as RelayResponder;
    const request = createEnvelope({
      type: "relay.request",
      deviceId: "android_1",
      payload: {
        requestId: "request_2",
        method: "DELETE",
        path: "/sessions"
      }
    });

    await handleRelayMessage(
      {
        manager: {} as SessionManager,
        localBaseUrl: "http://127.0.0.1:17365",
        fetch,
        responder
      },
      JSON.stringify(request)
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(responder).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "relay.response",
        payload: { requestId: "request_2", status: 400, error: "Invalid relay request" }
      })
    );
  });

  it("does not proxy host-only or cross-origin relay paths", async () => {
    const fetch = vi.fn() as unknown as RelayFetch;
    const responder = vi.fn() as unknown as RelayResponder;
    const hostControl = createEnvelope({
      type: "relay.request",
      deviceId: "android_1",
      payload: {
        requestId: "request_3",
        method: "POST",
        path: "/host/control",
        body: { command: "stop" }
      }
    });
    const crossOrigin = createEnvelope({
      type: "relay.request",
      deviceId: "android_1",
      payload: {
        requestId: "request_4",
        method: "GET",
        path: "//example.com/status"
      }
    });
    const options = {
      manager: {} as SessionManager,
      localBaseUrl: "http://127.0.0.1:17365",
      fetch,
      responder
    };

    await handleRelayMessage(options, JSON.stringify(hostControl));
    await handleRelayMessage(options, JSON.stringify(crossOrigin));

    expect(fetch).not.toHaveBeenCalled();
    expect(responder).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "relay.response",
        payload: { requestId: "request_3", status: 403, error: "Relay path is not allowed" }
      })
    );
    expect(responder).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "relay.response",
        payload: { requestId: "request_4", status: 403, error: "Relay path is not allowed" }
      })
    );
  });

  it("returns a gateway error when the local Agent Mobile API cannot be reached", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as RelayFetch;
    const responder = vi.fn() as unknown as RelayResponder;
    const request = createEnvelope({
      type: "relay.request",
      deviceId: "android_1",
      payload: {
        requestId: "request_5",
        method: "GET",
        path: "/status"
      }
    });

    await handleRelayMessage(
      {
        manager: {} as SessionManager,
        localBaseUrl: "http://127.0.0.1:17365",
        fetch,
        responder
      },
      JSON.stringify(request)
    );

    expect(responder).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "relay.response",
        payload: { requestId: "request_5", status: 502, error: "connect ECONNREFUSED" }
      })
    );
  });
});
