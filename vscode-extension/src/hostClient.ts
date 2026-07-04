import type { Envelope } from "@agent-mobile/protocol";

export interface SessionConsoleEvent {
  seq: number;
  sessionId?: string;
  type: string;
  text: string;
}

interface WebSocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  close(): void;
}

interface WebSocketCloseLike {
  code?: number;
  reason?: string;
}

export interface LocalHostSessionClientOptions {
  host: string;
  port: number;
  pairingToken: string;
  fetchImpl?: typeof fetch;
  webSocketFactory?: (url: string) => WebSocketLike;
}

interface PairResponse {
  accessToken: string;
}

export class LocalHostSessionClient {
  private accessToken?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LocalHostSessionClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async attachSession(sessionId: string): Promise<void> {
    await this.authorizedRequest(`/sessions/${encodeURIComponent(sessionId)}/attach`, {
      method: "POST"
    });
  }

  async sendInput(sessionId: string, text: string): Promise<void> {
    await this.authorizedRequest(`/sessions/${encodeURIComponent(sessionId)}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    });
  }

  async stopSession(sessionId: string): Promise<void> {
    await this.authorizedRequest(`/sessions/${encodeURIComponent(sessionId)}/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "stop" })
    });
  }

  async fetchEvents(lastSeq: number): Promise<SessionConsoleEvent[]> {
    const response = await this.authorizedRequest(`/events?lastSeq=${encodeURIComponent(String(lastSeq))}`, {
      method: "GET"
    });
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) {
      return [];
    }
    return body.flatMap((event) => {
      const parsed = parseEnvelopeEvent(event);
      return parsed ? [parsed] : [];
    });
  }

  subscribe(input: {
    lastSeq: number;
    onEvent: (event: SessionConsoleEvent) => void;
    onError?: (error: string) => void;
  }): () => void {
    let closed = false;
    let socket: WebSocketLike | undefined;

    const openStream = async (retryOnUnauthorized: boolean, retryOnStreamFailure: boolean): Promise<void> => {
      try {
        const token = await this.ensureAccessToken();
        if (closed) {
          return;
        }
        const factory = this.options.webSocketFactory ?? createDefaultWebSocket;
        socket = factory(`${this.wsBaseUrl()}/stream?token=${encodeURIComponent(token)}&lastSeq=${input.lastSeq}`);
        socket.onmessage = (message) => {
          const event = parseConsoleEvent(message.data);
          if (event) {
            input.onEvent(event);
          }
        };
        let streamFailed = false;
        socket.onerror = () => {
          streamFailed = true;
        };
        socket.onclose = (event) => {
          if (closed) {
            return;
          }
          const close = event as WebSocketCloseLike;
          if (retryOnUnauthorized && (close.code === 1008 || close.reason === "Unauthorized")) {
            this.accessToken = undefined;
            void openStream(false, retryOnStreamFailure);
            return;
          }
          if (streamFailed && retryOnStreamFailure) {
            this.accessToken = undefined;
            void openStream(false, false);
            return;
          }
          if (streamFailed) {
            input.onError?.("Host event stream failed");
          }
        };
      } catch (error) {
        input.onError?.(error instanceof Error ? error.message : String(error));
      }
    };

    void openStream(true, true);

    return () => {
      closed = true;
      socket?.close();
    };
  }

  reset(input: { host: string; port: number; pairingToken: string }): void {
    this.accessToken = undefined;
    this.options.host = input.host;
    this.options.port = input.port;
    this.options.pairingToken = input.pairingToken;
  }

  private async authorizedRequest(path: string, init: RequestInit, retry = true): Promise<Response> {
    const token = await this.ensureAccessToken();
    const response = await this.fetchImpl(`${this.baseUrl()}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        authorization: `Bearer ${token}`
      }
    });
    if (response.status === 401 && retry) {
      this.accessToken = undefined;
      return this.authorizedRequest(path, init, false);
    }
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    return response;
  }

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }
    const response = await this.fetchImpl(`${this.baseUrl()}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairingToken: this.options.pairingToken,
        deviceId: "vscode-extension",
        clientType: "unknown"
      })
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const body = (await response.json()) as PairResponse;
    this.accessToken = body.accessToken;
    return body.accessToken;
  }

  private baseUrl(): string {
    return `http://${this.options.host}:${this.options.port}`;
  }

  private wsBaseUrl(): string {
    return `ws://${this.options.host}:${this.options.port}`;
  }
}

function createDefaultWebSocket(url: string): WebSocketLike {
  const Constructor = (globalThis as typeof globalThis & { WebSocket?: new (url: string) => unknown }).WebSocket;
  if (!Constructor) {
    throw new Error("WebSocket is not available in this VS Code extension host");
  }
  return new Constructor(url) as WebSocketLike;
}

function parseConsoleEvent(data: unknown): SessionConsoleEvent | undefined {
  try {
    return parseEnvelopeEvent(JSON.parse(String(data)) as Envelope);
  } catch {
    return undefined;
  }
}

function parseEnvelopeEvent(event: unknown): SessionConsoleEvent | undefined {
  const envelope = event as Envelope | undefined;
  if (!envelope?.sessionId) {
    return undefined;
  }
  const payload = envelope.payload as Record<string, unknown> | undefined;
  if (envelope.type === "agent.output" || envelope.type === "agent.input") {
    return {
      seq: envelope.seq,
      sessionId: envelope.sessionId,
      type: envelope.type,
      text: typeof payload?.text === "string" ? payload.text : ""
    };
  }
  if (envelope.type === "session.started" || envelope.type === "session.finished") {
    return {
      seq: envelope.seq,
      sessionId: envelope.sessionId,
      type: envelope.type,
      text: envelope.type === "session.started" ? "Session started" : "Session finished"
    };
  }
  return {
    seq: envelope.seq,
    sessionId: envelope.sessionId,
    type: envelope.type,
    text: envelope.type
  };
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Fall through to status text.
  }
  return response.statusText || `Host request failed with ${response.status}`;
}
