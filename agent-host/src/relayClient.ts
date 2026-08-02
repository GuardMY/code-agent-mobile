import {
  createEnvelope,
  envelopeSchema,
  relayRequestSchema,
  relayResponseSchema,
  type Envelope,
  type RelayResponse
} from "@agent-mobile/protocol";
import type { SessionManager } from "./sessions/sessionManager.js";

export interface RelayClientOptions {
  relayUrl: string;
  hostId: string;
  relayToken: string;
  manager: SessionManager;
  /** The fixed, local Agent Mobile HTTP endpoint used for relay RPCs. */
  localBaseUrl: string;
  fetch?: RelayFetch;
}

export interface RelayFetchResponse {
  status: number;
  text(): Promise<string>;
}

export interface RelayFetchOptions {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export type RelayFetch = (url: string, options: RelayFetchOptions) => Promise<RelayFetchResponse>;
export type RelayResponder = (message: Envelope<RelayResponse>) => void | Promise<void>;

export interface RelayMessageHandlerOptions {
  manager: SessionManager;
  localBaseUrl?: string;
  fetch?: RelayFetch;
  responder?: RelayResponder;
  /** Legacy commands are only for trusted, in-process compatibility callers. */
  allowLegacyCommands?: boolean;
}

const RELAY_RECONNECT_DELAY_MS = 1_000;

export function startRelayClient(options: RelayClientOptions): WebSocket {
  const url = new URL("/host", options.relayUrl);
  url.searchParams.set("hostId", options.hostId);
  url.searchParams.set("token", options.relayToken);
  let activeSocket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  options.manager.subscribe((event) => {
    if (activeSocket?.readyState === WebSocket.OPEN) {
      activeSocket.send(JSON.stringify(event));
    }
  });

  const connect = (): WebSocket => {
    const socket = new WebSocket(url);
    activeSocket = socket;
    const messageOptions: RelayMessageHandlerOptions = {
      manager: options.manager,
      localBaseUrl: options.localBaseUrl,
      fetch: options.fetch,
      allowLegacyCommands: false,
      responder: (message) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      }
    };

    socket.addEventListener("message", (event) => {
      void handleRelayMessage(messageOptions, String(event.data)).catch(() => undefined);
    });
    socket.addEventListener("close", () => {
      if (activeSocket !== socket || reconnectTimer) {
        return;
      }
      activeSocket = undefined;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, RELAY_RECONNECT_DELAY_MS);
    });
    return socket;
  };

  return connect();
}

export async function handleRelayMessage(manager: SessionManager, raw: string): Promise<void>;
export async function handleRelayMessage(options: RelayMessageHandlerOptions, raw: string): Promise<void>;
export async function handleRelayMessage(
  managerOrOptions: SessionManager | RelayMessageHandlerOptions,
  raw: string
): Promise<void> {
  const options = toRelayMessageHandlerOptions(managerOrOptions);
  const message = envelopeSchema.parse(JSON.parse(raw)) as Envelope;
  if (message.type === "relay.request") {
    await proxyRelayRequest(message.payload, options);
    return;
  }
  if (!options.allowLegacyCommands) {
    return;
  }
  if (message.type === "agent.start") {
    await options.manager.createSession();
    return;
  }
  if (message.type === "agent.input" && message.sessionId) {
    const payload = message.payload as { text?: unknown };
    if (typeof payload.text === "string") {
      await options.manager.sendInput(message.sessionId, payload.text);
    }
    return;
  }
  if (message.type === "agent.control.stop" && message.sessionId) {
    await options.manager.stopSession(message.sessionId);
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

async function proxyRelayRequest(payload: unknown, options: RelayMessageHandlerOptions): Promise<void> {
  const parsedRequest = relayRequestSchema.safeParse(payload);
  if (!parsedRequest.success) {
    const requestId = readRequestId(payload);
    if (requestId) {
      await sendRelayResponse(options, {
        requestId,
        status: 400,
        error: "Invalid relay request"
      });
    }
    return;
  }

  const request = parsedRequest.data;
  if (!options.localBaseUrl) {
    await sendRelayResponse(options, {
      requestId: request.requestId,
      status: 503,
      error: "Relay RPC is not configured"
    });
    return;
  }

  let target: URL;
  try {
    target = new URL(request.path, options.localBaseUrl);
  } catch {
    await sendRelayResponse(options, {
      requestId: request.requestId,
      status: 400,
      error: "Invalid relay path"
    });
    return;
  }

  const localBase = new URL(options.localBaseUrl);
  if (target.origin !== localBase.origin || !isPublicAgentMobilePath(request.method, target.pathname)) {
    await sendRelayResponse(options, {
      requestId: request.requestId,
      status: 403,
      error: "Relay path is not allowed"
    });
    return;
  }

  try {
    const response = await (options.fetch ?? globalThis.fetch)(target.toString(), {
      method: request.method,
      headers: relayHeaders(request.headers, request.body),
      ...(request.body === undefined ? {} : { body: serializeRelayBody(request.body) })
    });
    const body = await readRelayResponseBody(response);
    await sendRelayResponse(options, {
      requestId: request.requestId,
      status: response.status,
      ...(body === undefined ? {} : { body })
    });
  } catch (error) {
    await sendRelayResponse(options, {
      requestId: request.requestId,
      status: 502,
      error: error instanceof Error ? error.message : "Relay request failed"
    });
  }
}

function toRelayMessageHandlerOptions(
  input: SessionManager | RelayMessageHandlerOptions
): RelayMessageHandlerOptions {
  return "manager" in input ? input : { manager: input, allowLegacyCommands: true };
}

function readRequestId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const requestId = (payload as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : undefined;
}

function relayHeaders(headers: Record<string, string> | undefined, body: unknown): Record<string, string> {
  const authorization = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "authorization")?.[1];
  return {
    "x-agent-mobile-relay-request": "1",
    ...(authorization === undefined ? {} : { authorization }),
    ...(body === undefined ? {} : { "content-type": "application/json" })
  };
}

function serializeRelayBody(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

async function readRelayResponseBody(response: RelayFetchResponse): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function sendRelayResponse(
  options: RelayMessageHandlerOptions,
  response: RelayResponse
): Promise<void> {
  if (!options.responder) {
    return;
  }
  await options.responder(
    createEnvelope({
      type: "relay.response",
      deviceId: "agent-host",
      payload: relayResponseSchema.parse(response)
    })
  );
}

function isPublicAgentMobilePath(method: "GET" | "POST", pathname: string): boolean {
  if (method === "GET") {
    return ["/health", "/status", "/sessions", "/events", "/approvals", "/devices"].includes(pathname);
  }

  return (
    pathname === "/pair" ||
    pathname === "/devices/reauth" ||
    pathname === "/sessions" ||
    /^\/devices\/[^/]+\/revoke$/.test(pathname) ||
    /^\/approvals\/[^/]+\/respond$/.test(pathname) ||
    /^\/sessions\/[^/]+\/(?:input|attach|control)$/.test(pathname)
  );
}
