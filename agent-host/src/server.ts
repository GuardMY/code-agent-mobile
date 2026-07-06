import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  approvalDecisionSchema,
  clientTypeSchema,
  deviceSummarySchema,
  reauthRequestSchema,
  type AgentCapabilitySummary,
  type DeviceSummary,
  type PairingPayload,
  type SessionSummary,
  type TrustedDeviceRecord
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
  trustedDevices?: TrustedDeviceRecord[];
  stopHost?: () => Promise<void> | void;
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const accessTokens = new Map<string, { deviceId: string }>();
  const devices = new Map<string, TrustedDeviceRecord>(
    (options.trustedDevices ?? []).map((device) => [device.deviceId, device])
  );

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
    const existing = devices.get(body.data.deviceId);
    if (existing && !existing.revokedAt) {
      return reply.code(409).send({ error: "Device already paired" });
    }

    const accessToken = issueAccessToken(body.data.deviceId, accessTokens);
    const deviceSecret = createDeviceSecret();
    devices.set(body.data.deviceId, {
      deviceId: body.data.deviceId,
      clientType: body.data.clientType ?? "android-app",
      pairedAt: new Date().toISOString(),
      deviceSecretHash: hashDeviceSecret(deviceSecret)
    });
    return { accessToken, deviceId: body.data.deviceId, deviceSecret };
  });

  app.addHook("preHandler", async (request, reply) => {
    if (
      request.url === "/health" ||
      request.url === "/pair" ||
      request.url === "/devices/reauth" ||
      request.url.startsWith("/stream")
    ) {
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

  app.post("/devices/reauth", async (request, reply) => {
    const body = reauthRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid reauth request" });
    }
    const device = devices.get(body.data.deviceId);
    if (!device || device.revokedAt || !verifyDeviceSecret(body.data.deviceSecret, device.deviceSecretHash)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const accessToken = issueAccessToken(body.data.deviceId, accessTokens);
    devices.set(body.data.deviceId, {
      ...device,
      lastSeenAt: new Date().toISOString()
    });
    return { accessToken };
  });

  app.get("/devices", async () => Array.from(devices.values()).map(toDeviceSummary));

  app.get("/status", async (request) => {
    await options.manager.syncDesktopSessions();
    const sessions = options.manager.listSessions();
    const trustedDevices = Array.from(devices.values());
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
      devices: trustedDevices.map(toDeviceSummary),
      trustedDevices:
        request.headers["x-agent-mobile-pairing-token"] === options.pairingToken || isLoopbackRequest(request)
          ? trustedDevices
          : [],
      agents: buildAgentSummaries(sessions, options.manager.getAdaptersAvailability()),
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

function buildAgentSummaries(
  sessions: SessionSummary[],
  adapterAvailability: Map<string, AgentCapabilitySummary["availability"]>
): AgentCapabilitySummary[] {
  const knownAgents: Array<{ id: AgentCapabilitySummary["id"]; displayName: string }> = [
    { id: "codex", displayName: "Codex" },
    { id: "claude-code", displayName: "Claude Code" },
    { id: "opencode", displayName: "OpenCode" }
  ];
  return knownAgents.map((agent) =>
    buildAgentSummary(agent.id, agent.displayName, sessions, adapterAvailability.get(agent.id) ?? "unknown")
  );
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
  devices: Map<string, TrustedDeviceRecord>
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
  devices: Map<string, TrustedDeviceRecord>
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

function issueAccessToken(
  deviceId: string,
  accessTokens: Map<string, { deviceId: string }>
): string {
  const accessToken = `access_${nanoid(32)}`;
  accessTokens.set(accessToken, { deviceId });
  return accessToken;
}

function createDeviceSecret(): string {
  return `secret_${nanoid(32)}`;
}

function hashDeviceSecret(deviceSecret: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = createHash("sha256").update(`${salt}:${deviceSecret}`).digest("hex");
  return `sha256:${salt}:${digest}`;
}

function verifyDeviceSecret(deviceSecret: string, deviceSecretHash: string): boolean {
  const [algorithm, salt, expectedDigest] = deviceSecretHash.split(":");
  if (algorithm !== "sha256" || !salt || !expectedDigest) {
    return false;
  }

  const actualDigest = createHash("sha256").update(`${salt}:${deviceSecret}`).digest("hex");
  const actualBuffer = Buffer.from(actualDigest, "hex");
  const expectedBuffer = Buffer.from(expectedDigest, "hex");
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function toDeviceSummary(device: TrustedDeviceRecord): DeviceSummary {
  return deviceSummarySchema.parse({
    deviceId: device.deviceId,
    clientType: device.clientType,
    pairedAt: device.pairedAt,
    revokedAt: device.revokedAt
  });
}
