import { createEnvelope, envelopeSchema, type Envelope } from "@agent-mobile/protocol";
import type { SessionManager } from "./sessions/sessionManager.js";

export interface RelayClientOptions {
  relayUrl: string;
  hostId: string;
  relayToken: string;
  manager: SessionManager;
}

export function startRelayClient(options: RelayClientOptions): WebSocket {
  const url = new URL("/host", options.relayUrl);
  url.searchParams.set("hostId", options.hostId);
  url.searchParams.set("token", options.relayToken);
  const socket = new WebSocket(url);

  socket.addEventListener("message", (event) => {
    void handleRelayMessage(options.manager, String(event.data));
  });
  options.manager.subscribe((event) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  });
  return socket;
}

export async function handleRelayMessage(manager: SessionManager, raw: string): Promise<void> {
  const message = envelopeSchema.parse(JSON.parse(raw)) as Envelope;
  if (message.type === "agent.start") {
    await manager.createSession();
    return;
  }
  if (message.type === "agent.input" && message.sessionId) {
    const payload = message.payload as { text?: unknown };
    if (typeof payload.text === "string") {
      await manager.sendInput(message.sessionId, payload.text);
    }
    return;
  }
  if (message.type === "agent.control.stop" && message.sessionId) {
    await manager.stopSession(message.sessionId);
    return;
  }
}

export function createRelayCommand(input: {
  type: Envelope["type"];
  deviceId: string;
  sessionId?: string;
  payload: unknown;
}): Envelope {
  return createEnvelope(input);
}
