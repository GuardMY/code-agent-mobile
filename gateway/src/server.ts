import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

export interface GatewayOptions {
  /**
   * A shared token for every relay channel. When omitted, the first host to
   * register a hostId establishes that channel's token instead.
   */
  relayToken?: string;
}

type PeerKind = "host" | "app";
type SocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: Buffer | string) => void): void;
  on(event: "close", listener: () => void): void;
};

interface PeerGroup {
  channelToken?: string;
  hosts: Set<SocketLike>;
  apps: Set<SocketLike>;
  pendingRelayRequests: Map<string, SocketLike>;
}

export function buildGatewayServer(options: GatewayOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const peers = new Map<string, PeerGroup>();

  app.register(websocket);
  app.register(async (routes) => {
    routes.get("/health", async () => ({ ok: true }));
    routes.get("/host", { websocket: true }, (connection, request) => {
      registerPeer("host", toSocket(connection), request.query, peers, options.relayToken);
    });
    routes.get("/app", { websocket: true }, (connection, request) => {
      registerPeer("app", toSocket(connection), request.query, peers, options.relayToken);
    });
  });

  return app;
}

function toSocket(connection: unknown): SocketLike {
  const maybeStream = connection as { socket?: SocketLike };
  return maybeStream.socket ?? (connection as SocketLike);
}

function registerPeer(
  kind: PeerKind,
  socket: SocketLike,
  query: unknown,
  peers: Map<string, PeerGroup>,
  relayToken?: string
): void {
  const params = Array.isArray(query) ? {} : (query as Record<string, unknown>);
  const hostId = readQueryString(params.hostId);
  const token = readQueryString(params.token);
  const hasStaticRelayToken = relayToken !== undefined;
  if (!hostId || (!hasStaticRelayToken && !token)) {
    socket.close(1008, "Unauthorized");
    return;
  }

  const group = authorizePeer(kind, hostId, token, peers, relayToken);
  if (!group) {
    socket.close(1008, "Unauthorized");
    return;
  }

  const ownSet = kind === "host" ? group.hosts : group.apps;
  const targetSet = kind === "host" ? group.apps : group.hosts;
  ownSet.add(socket);

  socket.on("message", (data) => {
    const text = typeof data === "string" ? data : data.toString("utf8");
    const relayMessage = readRelayMessage(text);
    if (kind === "app" && relayMessage?.type === "relay.request" && relayMessage.requestId) {
      group.pendingRelayRequests.set(relayMessage.requestId, socket);
    }
    if (kind === "host" && relayMessage?.type === "relay.response") {
      routeRelayResponse(group, relayMessage.requestId, text);
      return;
    }
    for (const target of targetSet) {
      target.send(text);
    }
  });
  socket.on("close", () => {
    ownSet.delete(socket);
    if (kind === "app") {
      removePendingRequestsForSocket(group, socket);
    }
    if (hasStaticRelayToken && group.hosts.size === 0 && group.apps.size === 0) {
      peers.delete(hostId);
    }
  });
}

function authorizePeer(
  kind: PeerKind,
  hostId: string,
  token: string | undefined,
  peers: Map<string, PeerGroup>,
  relayToken: string | undefined
): PeerGroup | undefined {
  const group = peers.get(hostId);

  if (relayToken !== undefined) {
    if (token !== relayToken || (kind === "app" && !group)) {
      return undefined;
    }
    if (group) {
      return group;
    }

    const newGroup = createPeerGroup();
    peers.set(hostId, newGroup);
    return newGroup;
  }

  if (!group) {
    if (kind === "app" || !token) {
      return undefined;
    }

    const newGroup = createPeerGroup(token);
    peers.set(hostId, newGroup);
    return newGroup;
  }

  if (!token || group.channelToken !== token) {
    return undefined;
  }
  return group;
}

function createPeerGroup(channelToken?: string): PeerGroup {
  return {
    channelToken,
    hosts: new Set<SocketLike>(),
    apps: new Set<SocketLike>(),
    pendingRelayRequests: new Map<string, SocketLike>()
  };
}

function readQueryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

type RelayMessage = {
  type: "relay.request" | "relay.response";
  requestId?: string;
};

function readRelayMessage(raw: string): RelayMessage | undefined {
  try {
    const message: unknown = JSON.parse(raw);
    if (!message || typeof message !== "object") {
      return undefined;
    }
    const type = (message as { type?: unknown }).type;
    if (type !== "relay.request" && type !== "relay.response") {
      return undefined;
    }
    const payload = (message as { payload?: unknown }).payload;
    const requestId =
      payload && typeof payload === "object" && typeof (payload as { requestId?: unknown }).requestId === "string"
        ? (payload as { requestId: string }).requestId
        : undefined;
    return { type, ...(requestId ? { requestId } : {}) };
  } catch {
    return undefined;
  }
}

function routeRelayResponse(group: PeerGroup, requestId: string | undefined, text: string): void {
  if (!requestId) {
    return;
  }
  const requester = group.pendingRelayRequests.get(requestId);
  group.pendingRelayRequests.delete(requestId);
  requester?.send(text);
}

function removePendingRequestsForSocket(group: PeerGroup, socket: SocketLike): void {
  for (const [requestId, requester] of group.pendingRelayRequests) {
    if (requester === socket) {
      group.pendingRelayRequests.delete(requestId);
    }
  }
}
