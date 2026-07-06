import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  approvalDecisionSchema,
  clientTypeSchema,
  type AgentCapabilitySummary,
  type DeviceSummary,
  type PairingPayload,
  type SessionSummary
} from "@agent-mobile/protocol";
import { NonRunningSessionError, type SessionManager } from "./sessions/sessionManager.js";

const pairRequestSchema = z.object({
  pairingToken: z.string().min(1),
  deviceId: z.string().min(1),
  clientType: clientTypeSchema.optional()
});

const inputRequestSchema = z.object({
  text: z.string()
});

const controlRequestSchema = z.object({
  command: z.literal("stop")
});

const approvalResponseSchema = z.object({
  decision: approvalDecisionSchema
});

export interface ServerOptions {
  manager: SessionManager;
  version: string;
  lanEnabled: boolean;
  pairingToken: string;
  deviceName: string;
  advertisedHost?: string;
  port?: number;
  accessTokenTtlMs?: number;
  stopHost?: () => Promise<void> | void;
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const accessTokens = new Map<string, { deviceId: string }>();
  const devices = new Map<string, DeviceSummary>();

  app.register(websocket);

  app.get("/health", async () => ({
    ok: true,
    version: options.version,
    lanEnabled: options.lanEnabled,
    deviceName: options.deviceName
  }));

  app.post("/pair", async (request, reply) => {
    const body = pairRequestSchema.safeParse(request.body);
    if (!body.success || body.data.pairingToken !== options.pairingToken) {
      return reply.code(401).send({ error: "Invalid pairing token" });
    }

    const accessToken = `access_${nanoid(32)}`;
    accessTokens.set(accessToken, { deviceId: body.data.deviceId });
    devices.set(body.data.deviceId, {
      deviceId: body.data.deviceId,
      clientType: body.data.clientType ?? "android-app",
      pairedAt: new Date().toISOString()
    });
    return { accessToken };
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/health" || request.url === "/pair" || request.url.startsWith("/stream")) {
      return;
    }
    if (
      request.url === "/status" &&
      (request.headers["x-agent-mobile-pairing-token"] === options.pairingToken || isLoopbackRequest(request))
    ) {
      return;
    }
    if (request.url === "/host/control" && request.headers["x-agent-mobile-pairing-token"] === options.pairingToken) {
      return;
    }
    if (!isAuthorized(request, accessTokens, devices)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/devices", async () => Array.from(devices.values()));

  app.get("/status", async () => {
    await options.manager.syncDesktopSessions();
    const sessions = options.manager.listSessions();
    const pairingPayload: PairingPayload = {
      host: options.advertisedHost ?? "127.0.0.1",
      port: options.port ?? 17365,
      pairingToken: options.pairingToken,
      deviceName: options.deviceName
    };
    return {
      server: {
        running: true,
        lanEnabled: options.lanEnabled,
        host: pairingPayload.host,
        port: pairingPayload.port,
        deviceName: options.deviceName,
        version: options.version
      },
      pairing: {
        enabled: true,
        pairingPayload
      },
      devices: Array.from(devices.values()),
      agents: buildAgentSummaries(sessions, options.manager.getAdapterAvailability()),
      sessions
    };
  });

  app.post("/devices/:deviceId/revoke", async (request, reply) => {
    const params = z.object({ deviceId: z.string().min(1) }).parse(request.params);
    const existing = devices.get(params.deviceId);
    if (existing) {
      devices.set(params.deviceId, { ...existing, revokedAt: new Date().toISOString() });
    }
    for (const [token, record] of accessTokens.entries()) {
      if (record.deviceId === params.deviceId) {
        accessTokens.delete(token);
      }
    }
    return reply.code(202).send({ ok: true });
  });

  app.get("/approvals", async () => options.manager.listApprovals());

  app.post("/approvals/:approvalId/respond", async (request, reply) => {
    const params = z.object({ approvalId: z.string().min(1) }).parse(request.params);
    const body = approvalResponseSchema.parse(request.body);
    const approval = await options.manager.respondApproval(params.approvalId, body.decision);
    return reply.code(202).send(approval);
  });

  app.get("/sessions", async () => {
    await options.manager.syncDesktopSessions();
    return options.manager.listSessions();
  });

  app.get("/events", async (request) => {
    const lastSeq = Number(
      Array.isArray(request.query) ? 0 : (request.query as Record<string, string | undefined>).lastSeq ?? 0
    );
    return options.manager.eventsAfter(Number.isFinite(lastSeq) ? lastSeq : 0);
  });

  app.post("/sessions", async (_request, reply) =>
    reply.code(409).send({ error: "Start Codex sessions on the desktop first" })
  );

  app.post("/host/control", async (request, reply) => {
    const body = controlRequestSchema.parse(request.body);
    if (body.command === "stop") {
      await options.stopHost?.();
    }
    return reply.code(202).send({ ok: true });
  });

  app.post("/sessions/:id/input", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = inputRequestSchema.parse(request.body);
    await options.manager.syncDesktopSessions();
    try {
      await options.manager.sendInput(params.id, body.text);
      return reply.code(202).send({ ok: true });
    } catch (error) {
      if (error instanceof NonRunningSessionError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/sessions/:id/attach", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    await options.manager.syncDesktopSessions();
    try {
      await options.manager.attachSession(params.id);
      return reply.code(202).send({ ok: true });
    } catch (error) {
      if (error instanceof NonRunningSessionError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/sessions/:id/control", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = controlRequestSchema.parse(request.body);
    await options.manager.syncDesktopSessions();
    try {
      if (body.command === "stop") {
        await options.manager.stopSession(params.id);
      }
      return reply.code(202).send({ ok: true });
    } catch (error) {
      if (error instanceof NonRunningSessionError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.after(() => {
    app.get("/stream", { websocket: true }, (socket, request) => {
      const token = getQueryParam(request, "token");
      const lastSeq = Number(getQueryParam(request, "lastSeq") ?? 0);
      if (!token || !isAccessTokenValid(token, accessTokens, devices)) {
        socket.close(1008, "Unauthorized");
        return;
      }
      for (const event of options.manager.eventsAfter(Number.isFinite(lastSeq) ? lastSeq : 0)) {
        socket.send(JSON.stringify(event));
      }
      const unsubscribe = options.manager.subscribe((event) => {
        try {
          socket.send(JSON.stringify(event));
        } catch {
          unsubscribe();
        }
      });
      socket.on("close", unsubscribe);
    });
  });

  return app;
}

function buildAgentSummaries(sessions: SessionSummary[], codexAvailability: AgentCapabilitySummary["availability"]): AgentCapabilitySummary[] {
  return [
    buildAgentSummary("codex", "Codex", sessions, codexAvailability),
    buildAgentSummary("claude-code", "Claude Code", sessions),
    buildAgentSummary("opencode", "OpenCode", sessions)
  ];
}

function buildAgentSummary(
  id: AgentCapabilitySummary["id"],
  displayName: string,
  sessions: SessionSummary[],
  availability: AgentCapabilitySummary["availability"] = "unknown"
): AgentCapabilitySummary {
  const matching = sessions.filter((session) => session.adapterId === id);
  const activeSessions = matching.filter((session) => session.status === "running" || session.status === "starting").length;
  const latest = matching.at(-1);
  return {
    id,
    displayName,
    availability,
    activeSessions,
    latestSessionStatus: latest?.status
  };
}

function isAuthorized(
  request: FastifyRequest,
  accessTokens: Map<string, { deviceId: string }>,
  devices: Map<string, DeviceSummary>
): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return false;
  }
  return isAccessTokenValid(header.slice("Bearer ".length), accessTokens, devices);
}

function isAccessTokenValid(
  token: string,
  accessTokens: Map<string, { deviceId: string }>,
  devices: Map<string, DeviceSummary>
): boolean {
  const record = accessTokens.get(token);
  if (!record) {
    return false;
  }
  if (devices.get(record.deviceId)?.revokedAt) {
    accessTokens.delete(token);
    return false;
  }
  return true;
}

function getQueryParam(request: FastifyRequest, name: string): string | undefined {
  const query = request.query;
  if (query && !Array.isArray(query)) {
    const value = (query as Record<string, string | string[] | undefined>)[name];
    return Array.isArray(value) ? value[0] : value;
  }
  return new URL(request.url, "http://agent-mobile.local").searchParams.get(name) ?? undefined;
}

function isLoopbackRequest(request: FastifyRequest): boolean {
  return request.ip === "127.0.0.1" || request.ip === "::1" || request.ip === "::ffff:127.0.0.1";
}
