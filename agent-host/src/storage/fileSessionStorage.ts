import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import {
  approvalRequestSchema,
  deviceSummarySchema,
  envelopeSchema,
  sessionSummarySchema,
  type ApprovalRequest,
  type DeviceSummary,
  type Envelope,
  type SessionSummary
} from "@agent-mobile/protocol";
import type { SessionStorage } from "../sessions/sessionManager.js";

export class FileSessionStorage implements SessionStorage {
  private readonly dir: string;
  private readonly sessionsPath: string;
  private readonly eventsPath: string;
  private readonly devicesPath: string;
  private readonly approvalsPath: string;

  constructor(workspace: string) {
    this.dir = join(workspace, ".agent-mobile");
    this.sessionsPath = join(this.dir, "sessions.json");
    this.eventsPath = join(this.dir, "events.jsonl");
    this.devicesPath = join(this.dir, "devices.json");
    this.approvalsPath = join(this.dir, "approvals.json");
  }

  async loadSessions(): Promise<SessionSummary[]> {
    const text = await readOptionalFile(this.sessionsPath);
    if (!text) {
      return [];
    }
    const parsed = JSON.parse(text);
    return sessionSummarySchema.array().parse(parsed);
  }

  async saveSessions(sessions: SessionSummary[]): Promise<void> {
    await this.ensureDir();
    await writeFile(this.sessionsPath, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
  }

  async loadEvents(limit: number): Promise<Envelope[]> {
    const text = await readOptionalFile(this.eventsPath);
    if (!text) {
      return [];
    }
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines
      .slice(Math.max(0, lines.length - limit))
      .map((line) => envelopeSchema.parse(JSON.parse(line)) as Envelope);
  }

  async appendEvent(event: Envelope): Promise<void> {
    await this.ensureDir();
    await appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, "utf8");
  }

  async loadDevices(): Promise<DeviceSummary[]> {
    const text = await readOptionalFile(this.devicesPath);
    if (!text) {
      return [];
    }
    const parsed = JSON.parse(text);
    const migrated = Array.isArray(parsed)
      ? parsed.map((device) =>
          device && typeof device === "object" && !("clientType" in device)
            ? { ...device, clientType: "android-app" }
            : device
        )
      : parsed;
    return deviceSummarySchema.array().parse(migrated);
  }

  async saveDevices(devices: DeviceSummary[]): Promise<void> {
    await this.ensureDir();
    await writeFile(this.devicesPath, `${JSON.stringify(devices, null, 2)}\n`, "utf8");
  }

  async loadApprovals(): Promise<ApprovalRequest[]> {
    const text = await readOptionalFile(this.approvalsPath);
    if (!text) {
      return [];
    }
    return approvalRequestSchema.array().parse(JSON.parse(text));
  }

  async saveApprovals(approvals: ApprovalRequest[]): Promise<void> {
    await this.ensureDir();
    await writeFile(this.approvalsPath, `${JSON.stringify(approvals, null, 2)}\n`, "utf8");
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
