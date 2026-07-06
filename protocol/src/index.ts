import { z } from "zod";

export const messageTypeSchema = z.enum([
  "agent.start",
  "agent.input",
  "agent.control.pause",
  "agent.control.resume",
  "agent.control.stop",
  "approval.approve",
  "approval.deny",
  "workspace.status.request",
  "agent.output",
  "agent.status",
  "approval.required",
  "workspace.status",
  "file.changed",
  "git.status",
  "error",
  "session.started",
  "session.finished",
  "session.resume"
]);

export const controlCommandSchema = z.enum(["pause", "resume", "stop"]);
export type ControlCommand = z.infer<typeof controlCommandSchema>;

export const envelopeSchema = z.object({
  id: z.string().min(1),
  type: messageTypeSchema,
  sessionId: z.string().min(1).optional(),
  deviceId: z.string().min(1),
  timestamp: z.string().datetime(),
  seq: z.number().int().nonnegative(),
  payload: z.unknown()
});
export type Envelope<TPayload = unknown> = Omit<z.infer<typeof envelopeSchema>, "payload"> & {
  payload: TPayload;
};

export const pairingPayloadSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  pairingToken: z.string().min(8),
  deviceName: z.string().min(1)
});
export type PairingPayload = z.infer<typeof pairingPayloadSchema>;

export const pairSuccessResponseSchema = z.object({
  accessToken: z.string().min(1),
  deviceId: z.string().min(1),
  deviceSecret: z.string().min(1).optional()
});
export type PairSuccessResponse = z.infer<typeof pairSuccessResponseSchema>;

export const clientTypeSchema = z.enum(["android-app", "ios-app", "wechat-mini-program", "desktop-extension", "unknown"]);
export type ClientType = z.infer<typeof clientTypeSchema>;

export const sessionStatusSchema = z.enum(["starting", "running", "stopped", "exited", "failed"]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionSummarySchema = z.object({
  id: z.string().min(1),
  adapterId: z.string().min(1),
  title: z.string().min(1).optional(),
  workspace: z.string().min(1),
  status: sessionStatusSchema,
  startedAt: z.string().datetime(),
  lastSeq: z.number().int().nonnegative()
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const deviceSummarySchema = z.object({
  deviceId: z.string().min(1),
  clientType: clientTypeSchema,
  pairedAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional()
});
export type DeviceSummary = z.infer<typeof deviceSummarySchema>;

export const trustedDeviceRecordSchema = z.object({
  deviceId: z.string().min(1),
  clientType: clientTypeSchema,
  displayName: z.string().min(1).optional(),
  pairedAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(),
  deviceSecretHash: z.string().min(1),
  lastSeenAt: z.string().datetime().optional()
});
export type TrustedDeviceRecord = z.infer<typeof trustedDeviceRecordSchema>;

export const reauthRequestSchema = z.object({
  deviceId: z.string().min(1),
  deviceSecret: z.string().min(1)
});
export type ReauthRequest = z.infer<typeof reauthRequestSchema>;

export const reauthResponseSchema = z.object({
  accessToken: z.string().min(1)
});
export type ReauthResponse = z.infer<typeof reauthResponseSchema>;

export const agentAvailabilitySchema = z.enum(["available", "missing", "unknown"]);
export type AgentAvailability = z.infer<typeof agentAvailabilitySchema>;

export const agentCapabilitySummarySchema = z.object({
  id: z.enum(["codex", "claude-code", "opencode"]),
  displayName: z.string().min(1),
  availability: agentAvailabilitySchema,
  activeSessions: z.number().int().nonnegative(),
  latestSessionStatus: sessionStatusSchema.optional()
});
export type AgentCapabilitySummary = z.infer<typeof agentCapabilitySummarySchema>;

export const hostDashboardStatusSchema = z.object({
  server: z.object({
    running: z.literal(true),
    lanEnabled: z.boolean(),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    deviceName: z.string().min(1),
    version: z.string().min(1)
  }),
  pairing: z.object({
    enabled: z.boolean(),
    pairingPayload: pairingPayloadSchema
  }),
  devices: z.array(deviceSummarySchema),
  trustedDevices: z.array(trustedDeviceRecordSchema).default([]),
  agents: z.array(agentCapabilitySummarySchema),
  sessions: z.array(sessionSummarySchema)
});
export type HostDashboardStatus = z.infer<typeof hostDashboardStatusSchema>;

export const approvalStatusSchema = z.enum(["pending", "approved", "denied"]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalDecisionSchema = z.enum(["approve", "deny"]);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const approvalRequestSchema = z.object({
  approvalId: z.string().min(1),
  sessionId: z.string().min(1),
  risk: z.string().min(1),
  action: z.string().min(1),
  summary: z.string().min(1),
  status: approvalStatusSchema,
  createdAt: z.string().datetime(),
  timeoutSeconds: z.number().int().positive().optional()
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session_started"),
    sessionId: z.string(),
    workspace: z.string(),
    seq: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal("stdout"),
    sessionId: z.string(),
    text: z.string(),
    seq: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal("stderr"),
    sessionId: z.string(),
    text: z.string(),
    seq: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal("assistant_message"),
    sessionId: z.string(),
    text: z.string(),
    seq: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal("tool_call"),
    sessionId: z.string(),
    tool: z.string(),
    args: z.unknown(),
    seq: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal("approval_required"),
    sessionId: z.string(),
    action: z.unknown(),
    seq: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal("file_changed"),
    sessionId: z.string(),
    path: z.string(),
    changeType: z.string(),
    seq: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal("session_finished"),
    sessionId: z.string(),
    exitCode: z.number().int(),
    seq: z.number().int().nonnegative()
  })
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

export function createEnvelope<TPayload>(input: {
  type: z.infer<typeof messageTypeSchema>;
  deviceId: string;
  payload: TPayload;
  sessionId?: string;
  seq?: number;
}): Envelope<TPayload> {
  return {
    id: `msg_${crypto.randomUUID()}`,
    type: input.type,
    sessionId: input.sessionId,
    deviceId: input.deviceId,
    timestamp: new Date().toISOString(),
    seq: input.seq ?? 0,
    payload: input.payload
  };
}
