import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

export interface GatewayOptions {
  relayToken: string;
}

type PeerKind = "host" | "app";
type SocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: Buffer | string) => void): void;
  on(event: "close", listener: () => void): void;
};

interface PeerGroup {
  hosts: Set<SocketLike>;
  apps: Set<SocketLike>;
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
  relayToken: string
): void {
  const params = Array.isArray(query) ? {} : (query as Record<string, string | undefined>);
  const hostId = params.hostId;
  const token = params.token;
  if (!hostId || token !== relayToken) {
    socket.close(1008, "Unauthorized");
    return;
  }

  const group = peers.get(hostId) ?? { hosts: new Set<SocketLike>(), apps: new Set<SocketLike>() };
  peers.set(hostId, group);
  const ownSet = kind === "host" ? group.hosts : group.apps;
  const targetSet = kind === "host" ? group.apps : group.hosts;
  ownSet.add(socket);

  socket.on("message", (data) => {
    const text = typeof data === "string" ? data : data.toString("utf8");
    for (const target of targetSet) {
      target.send(text);
    }
  });
  socket.on("close", () => {
    ownSet.delete(socket);
    if (group.hosts.size === 0 && group.apps.size === 0) {
      peers.delete(hostId);
    }
  });
}
