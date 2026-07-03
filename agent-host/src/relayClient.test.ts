import { describe, expect, it, vi } from "vitest";
import { createEnvelope } from "@agent-mobile/protocol";
import { handleRelayMessage } from "./relayClient.js";
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
});
