import {
  createEnvelope,
  type ApprovalDecision,
  type ApprovalRequest,
  type AgentAvailability,
  type DeviceSummary,
  type Envelope,
  type SessionSummary,
  type SessionStatus
} from "@agent-mobile/protocol";
import { nanoid } from "nanoid";

export interface AgentProcess {
  sendInput(input: string): void | Promise<void>;
  stop(): Promise<number>;
}

export interface AgentAdapter {
  id: string;
  displayName: string;
  start(options: {
    sessionId: string;
    workspace: string;
    onOutput: (stream: "stdout" | "stderr", text: string) => void;
    onExit: (exitCode: number) => void;
  }): Promise<AgentProcess>;
  discoverSessions?(options: { workspace: string }): Promise<DiscoveredAgentSession[]>;
  attachSession?(options: {
    externalId: string;
    sessionId: string;
    workspace: string;
    onOutput: (stream: "stdout" | "stderr", text: string) => void;
    onExit: (exitCode: number) => void;
  }): Promise<AgentProcess>;
}

export interface DiscoveredAgentSession {
  id: string;
  workspace: string;
  title?: string;
  updatedAt?: string;
}

export interface SessionManagerOptions {
  adapter?: AgentAdapter;
  adapters?: AgentAdapter[];
  workspace: string;
  eventCacheSize: number;
  storage?: SessionStorage;
}

export interface SessionStorage {
  loadSessions(): Promise<SessionSummary[]>;
  saveSessions(sessions: SessionSummary[]): Promise<void>;
  loadEvents(limit: number): Promise<Envelope[]>;
  appendEvent(event: Envelope): Promise<void>;
  loadDevices?(): Promise<DeviceSummary[]>;
  saveDevices?(devices: DeviceSummary[]): Promise<void>;
  loadApprovals?(): Promise<ApprovalRequest[]>;
  saveApprovals?(approvals: ApprovalRequest[]): Promise<void>;
}

export class NonRunningSessionError extends Error {
  constructor(sessionId: string, status: SessionStatus) {
    super(`Session ${sessionId} is ${status}`);
    this.name = "NonRunningSessionError";
  }
}

interface SessionRecord {
  summary: SessionSummary;
  process?: AgentProcess;
  externalId?: string;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly events: Envelope[] = [];
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly subscribers = new Set<(event: Envelope) => void>();
  private readonly adapters = new Map<string, AgentAdapter>();
  private seq = 0;
  private desktopSyncErrors = new Map<string, string>();

  constructor(private readonly options: SessionManagerOptions) {
    const adapterList = options.adapters ?? (options.adapter ? [options.adapter] : []);
    for (const a of adapterList) {
      this.adapters.set(a.id, a);
    }
  }

  getAdapterIds(): string[] {
    return Array.from(this.adapters.keys());
  }

  getPrimaryAdapterId(): string {
    const first = this.adapters.keys().next().value;
    if (!first) {
      throw new Error("No adapters registered");
    }
    return first;
  }

  async loadFromStorage(): Promise<void> {
    if (!this.options.storage) {
      return;
    }

    const [sessions, events, approvals] = await Promise.all([
      this.options.storage.loadSessions(),
      this.options.storage.loadEvents(this.options.eventCacheSize),
      this.options.storage.loadApprovals?.() ?? Promise.resolve([])
    ]);

    this.sessions.clear();
    for (const session of sessions) {
      const restoredStatus = session.status === "running" || session.status === "starting" ? "exited" : session.status;
      this.sessions.set(session.id, {
        summary: {
          ...session,
          status: restoredStatus
        }
      });
    }

    this.events.splice(0, this.events.length, ...events.slice(-this.options.eventCacheSize));
    this.seq = this.events.reduce((max, event) => Math.max(max, event.seq), 0);
    this.approvals.clear();
    for (const approval of approvals) {
      this.approvals.set(approval.approvalId, approval);
    }
  }

  listSessions(): SessionSummary[] {
    return Array.from(this.sessions.values())
      .map((record) => record.summary)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  async syncDesktopSessions(): Promise<void> {
    for (const [adapterId, adapter] of this.adapters.entries()) {
      if (!adapter.discoverSessions) {
        continue;
      }
      let discovered: DiscoveredAgentSession[] | undefined;
      try {
        discovered = await adapter.discoverSessions({ workspace: this.options.workspace });
        this.desktopSyncErrors.delete(adapterId);
      } catch (error) {
        this.desktopSyncErrors.set(adapterId, error instanceof Error ? error.message : String(error));
        continue;
      }
      if (!discovered) {
        continue;
      }
      const workspaceSessions = discovered.filter(
        (item) => normalizePath(item.workspace) === normalizePath(this.options.workspace)
      );
      const discoveredExternalIds = new Set(workspaceSessions.map((session) => session.id));

      for (const [sessionId, record] of this.sessions.entries()) {
        if (
          record.summary.adapterId !== adapterId ||
          !record.externalId ||
          normalizePath(record.summary.workspace) !== normalizePath(this.options.workspace)
        ) {
          continue;
        }
        if (!discoveredExternalIds.has(record.externalId) && !record.process) {
          this.sessions.delete(sessionId);
        }
      }

      for (const session of workspaceSessions) {
        const sessionId = `${adapterId}_${session.id}`;
        const existing = this.sessions.get(sessionId);
        if (existing) {
          existing.externalId = session.id;
          existing.summary.title = session.title;
          if (existing.summary.status !== "running") {
            existing.summary.status = "running";
            existing.process = undefined;
          }
          continue;
        }
        this.sessions.set(sessionId, {
          externalId: session.id,
          summary: {
            id: sessionId,
            adapterId,
            title: session.title,
            workspace: session.workspace,
            status: "running",
            startedAt: session.updatedAt ?? new Date().toISOString(),
            lastSeq: this.seq
          }
        });
      }
    }
  }

  getAdapterAvailability(adapterId?: string): AgentAvailability {
    const id = adapterId ?? this.getPrimaryAdapterId();
    if (!this.adapters.has(id)) {
      return "unknown";
    }
    return this.desktopSyncErrors.has(id) ? "missing" : "available";
  }

  getAdaptersAvailability(): Map<string, AgentAvailability> {
    const result = new Map<string, AgentAvailability>();
    for (const id of this.adapters.keys()) {
      result.set(id, this.getAdapterAvailability(id));
    }
    return result;
  }

  async createSession(adapterId?: string): Promise<SessionSummary> {
    const id = adapterId ?? this.getPrimaryAdapterId();
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Unknown adapter ${id}`);
    }
    const sessionId = `sess_${nanoid(10)}`;
    const startedAt = new Date().toISOString();

    const process = await adapter.start({
      sessionId,
      workspace: this.options.workspace,
      onOutput: (_stream, text) => {
        this.appendEvent({
          type: "agent.output",
          sessionId,
          payload: { text }
        });
      },
      onExit: (exitCode) => {
        const record = this.sessions.get(sessionId);
        if (record) {
          record.process = undefined;
        }
        if (record?.summary.status === "running") {
          record.summary.status = exitCode === 0 ? "exited" : "failed";
          this.appendEvent({
            type: "session.finished",
            sessionId,
            payload: { exitCode }
          });
        }
      }
    });

    const summary: SessionSummary = {
      id: sessionId,
      adapterId: adapter.id,
      workspace: this.options.workspace,
      status: "running",
      startedAt,
      lastSeq: this.seq
    };
    this.sessions.set(sessionId, { summary, process });
    this.appendEvent({
      type: "session.started",
      sessionId,
      payload: { session: summary }
    });
    return summary;
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const record = this.requireSession(sessionId);
    if (record.summary.status === "running" && !record.process && record.externalId) {
      record.process = await this.attachDesktopSession(sessionId, record.externalId);
    }
    if (record.summary.status !== "running" || !record.process) {
      throw new NonRunningSessionError(sessionId, record.summary.status);
    }
    const line = input.endsWith("\n") ? input : `${input}\n`;
    await record.process.sendInput(line);
    this.appendEvent({
      type: "agent.input",
      sessionId,
      payload: { text: input }
    });
    record.summary.lastSeq = this.seq;
  }

  async attachSession(sessionId: string): Promise<void> {
    const record = this.requireSession(sessionId);
    if (record.summary.status !== "running") {
      throw new NonRunningSessionError(sessionId, record.summary.status);
    }
    if (record.process) {
      return;
    }
    if (!record.externalId) {
      throw new NonRunningSessionError(sessionId, record.summary.status);
    }
    record.process = await this.attachDesktopSession(sessionId, record.externalId);
  }

  async stopSession(sessionId: string): Promise<void> {
    const record = this.requireSession(sessionId);
    if (record.summary.status !== "running") {
      throw new NonRunningSessionError(sessionId, record.summary.status);
    }
    if (!record.process) {
      if (!record.externalId) {
        throw new NonRunningSessionError(sessionId, record.summary.status);
      }
      record.process = await this.attachDesktopSession(sessionId, record.externalId);
    }
    const exitCode = await record.process.stop();
    record.process = undefined;
    record.summary.status = "stopped" satisfies SessionStatus;
    this.appendEvent({
      type: "session.finished",
      sessionId,
      payload: { exitCode }
    });
  }

  eventsAfter(lastSeq: number): Envelope[] {
    return this.events.filter((event) => event.seq > lastSeq);
  }

  subscribe(listener: (event: Envelope) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  listApprovals(): ApprovalRequest[] {
    return Array.from(this.approvals.values()).filter((approval) => approval.status === "pending");
  }

  async requestApproval(input: Omit<ApprovalRequest, "status" | "createdAt"> & { createdAt?: string }): Promise<ApprovalRequest> {
    const approval: ApprovalRequest = {
      ...input,
      status: "pending",
      createdAt: input.createdAt ?? new Date().toISOString()
    };
    this.approvals.set(approval.approvalId, approval);
    await this.persistApprovals();
    this.appendEvent({
      type: "approval.required",
      sessionId: approval.sessionId,
      payload: { approval }
    });
    return approval;
  }

  async respondApproval(approvalId: string, decision: ApprovalDecision): Promise<ApprovalRequest> {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      throw new Error(`Unknown approval ${approvalId}`);
    }
    const updated: ApprovalRequest = {
      ...approval,
      status: decision === "approve" ? "approved" : "denied"
    };
    this.approvals.set(approvalId, updated);
    await this.persistApprovals();
    this.appendEvent({
      type: decision === "approve" ? "approval.approve" : "approval.deny",
      sessionId: updated.sessionId,
      payload: { approval: updated }
    });
    return updated;
  }

  private appendEvent(input: { type: Envelope["type"]; sessionId: string; payload: unknown }): Envelope {
    const envelope = createEnvelope({
      type: input.type,
      sessionId: input.sessionId,
      deviceId: "agent-host",
      seq: ++this.seq,
      payload: input.payload
    });
    this.events.push(envelope);
    while (this.events.length > this.options.eventCacheSize) {
      this.events.shift();
    }

    const record = this.sessions.get(input.sessionId);
    if (record) {
      record.summary.lastSeq = envelope.seq;
    }
    void this.options.storage?.appendEvent(envelope);
    void this.options.storage?.saveSessions(this.listSessions());
    for (const subscriber of this.subscribers) {
      subscriber(envelope);
    }
    return envelope;
  }

  private async persistApprovals(): Promise<void> {
    await this.options.storage?.saveApprovals?.(Array.from(this.approvals.values()));
  }

  private requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new Error(`Unknown session ${sessionId}`);
    }
    return record;
  }

  private async attachDesktopSession(sessionId: string, externalId: string): Promise<AgentProcess> {
    const record = this.requireSession(sessionId);
    const adapter = this.adapters.get(record.summary.adapterId);
    if (!adapter) {
      throw new Error(`Unknown adapter ${record.summary.adapterId}`);
    }
    if (!adapter.attachSession) {
      throw new Error(`Adapter ${adapter.id} cannot attach sessions`);
    }
    return adapter.attachSession({
      externalId,
      sessionId,
      workspace: this.options.workspace,
      onOutput: (_stream, text) => {
        this.appendEvent({
          type: "agent.output",
          sessionId,
          payload: { text }
        });
      },
      onExit: (exitCode) => {
        const record = this.sessions.get(sessionId);
        if (record) {
          record.process = undefined;
        }
        if (record?.summary.status === "running") {
          record.summary.status = exitCode === 0 ? "exited" : "failed";
          this.appendEvent({
            type: "session.finished",
            sessionId,
            payload: { exitCode }
          });
        }
      }
    });
  }
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase();
}
