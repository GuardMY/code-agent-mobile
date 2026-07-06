import { describe, expect, it } from "vitest";
import {
  agentCapabilitySummarySchema,
  approvalDecisionSchema,
  approvalRequestSchema,
  clientTypeSchema,
  controlCommandSchema,
  deviceSummarySchema,
  envelopeSchema,
  hostDashboardStatusSchema,
  pairingPayloadSchema,
  sessionSummarySchema
} from "./index.js";

describe("protocol schemas", () => {
  it("accepts a valid envelope", () => {
    const result = envelopeSchema.parse({
      id: "msg_1",
      type: "agent.input",
      sessionId: "sess_1",
      deviceId: "android_1",
      timestamp: "2026-06-30T14:30:00.000Z",
      seq: 3,
      payload: { text: "hello" }
    });

    expect(result.type).toBe("agent.input");
    expect(result.seq).toBe(3);
  });

  it("rejects envelopes missing required routing fields", () => {
    const result = envelopeSchema.safeParse({
      sessionId: "sess_1",
      deviceId: "android_1",
      seq: 1,
      payload: {}
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown control commands", () => {
    const result = controlCommandSchema.safeParse("restart");

    expect(result.success).toBe(false);
  });

  it("accepts pairing payloads without expiry", () => {
    const result = pairingPayloadSchema.safeParse({
      host: "192.168.1.10",
      port: 17365,
      pairingToken: "pair_123",
      deviceName: "devbox"
    });

    expect(result.success).toBe(true);
  });

  it("accepts permanent device summaries without token expiry metadata", () => {
    const result = deviceSummarySchema.parse({
      deviceId: "android_1",
      clientType: "android-app",
      pairedAt: "2026-06-30T14:30:00.000Z",
      revokedAt: "2026-06-30T15:00:00.000Z"
    });

    expect(result.deviceId).toBe("android_1");
    expect(result.clientType).toBe("android-app");
    expect("accessToken" in result).toBe(false);
    expect("accessTokenExpiresAt" in result).toBe(false);
  });

  it("accepts supported mobile client types", () => {
    expect(clientTypeSchema.parse("wechat-mini-program")).toBe("wechat-mini-program");
    expect(clientTypeSchema.parse("desktop-extension")).toBe("desktop-extension");
    expect(clientTypeSchema.safeParse("browser").success).toBe(false);
  });

  it("accepts agent capability summaries", () => {
    const result = agentCapabilitySummarySchema.parse({
      id: "codex",
      displayName: "Codex",
      availability: "available",
      activeSessions: 1,
      latestSessionStatus: "running"
    });

    expect(result.activeSessions).toBe(1);
  });

  it("accepts optional session titles", () => {
    const result = sessionSummarySchema.parse({
      id: "codex_thr_desktop",
      adapterId: "codex",
      title: "Fix mobile handoff",
      workspace: "E:/repo",
      status: "running",
      startedAt: "2026-07-02T20:00:00.000Z",
      lastSeq: 7
    });

    expect(result.title).toBe("Fix mobile handoff");
  });

  it("accepts host dashboard status snapshots", () => {
    const result = hostDashboardStatusSchema.parse({
      server: {
        running: true,
        lanEnabled: true,
        host: "127.0.0.1",
        port: 17365,
        deviceName: "VS Code",
        version: "0.1.0"
      },
      pairing: {
        enabled: true,
        pairingPayload: {
          host: "127.0.0.1",
          port: 17365,
          pairingToken: "pairing-token-123",
          deviceName: "VS Code"
        }
      },
      devices: [
        {
          deviceId: "wechat_1",
          clientType: "wechat-mini-program",
          pairedAt: "2026-06-30T14:30:00.000Z"
        }
      ],
      agents: [
        {
          id: "codex",
          displayName: "Codex",
          availability: "available",
          activeSessions: 0
        }
      ],
      sessions: []
    });

    expect(result.devices[0].clientType).toBe("wechat-mini-program");
  });

  it("accepts approval requests and decisions", () => {
    const approval = approvalRequestSchema.parse({
      approvalId: "appr_1",
      sessionId: "sess_1",
      risk: "high",
      action: "shell.execute",
      summary: "npm install",
      status: "pending",
      createdAt: "2026-06-30T14:30:00.000Z",
      timeoutSeconds: 300
    });

    expect(approval.status).toBe("pending");
    expect(approvalDecisionSchema.parse("approve")).toBe("approve");
    expect(approvalDecisionSchema.safeParse("maybe").success).toBe(false);
  });
});
