import { describe, expect, it, vi } from "vitest";
import { createEnvelope, type Envelope, type SessionSummary } from "@agent-mobile/protocol";
import {
  NonRunningSessionError,
  SessionManager,
  type AgentAdapter,
  type SessionStorage
} from "./sessions/sessionManager.js";

function fakeAdapter(): AgentAdapter {
  return {
    id: "codex",
    displayName: "Codex",
    start: vi.fn(async ({ onOutput }) => {
      onOutput("stdout", "ready");
      return {
        sendInput: vi.fn(),
        stop: vi.fn(async () => 0)
      };
    })
  };
}

describe("SessionManager", () => {
  it("creates a session summary and records the startup event", async () => {
    const manager = new SessionManager({ adapter: fakeAdapter(), eventCacheSize: 10, workspace: "E:/repo" });

    const summary = await manager.createSession();

    expect(summary.adapterId).toBe("codex");
    expect(summary.status).toBe("running");
    expect(manager.listSessions()).toHaveLength(1);
    expect(manager.eventsAfter(0).map((event) => event.type)).toEqual(["agent.output", "session.started"]);
  });

  it("forwards input to the active process with a newline", async () => {
    const process = { sendInput: vi.fn(), stop: vi.fn(async () => 0) };
    const adapter: AgentAdapter = {
      id: "codex",
      displayName: "Codex",
      start: vi.fn(async () => process)
    };
    const manager = new SessionManager({ adapter, eventCacheSize: 10, workspace: "E:/repo" });
    const session = await manager.createSession();

    await manager.sendInput(session.id, "build this");

    expect(process.sendInput).toHaveBeenCalledWith("build this\n");
  });

  it("marks a stopped session as stopped and emits a finished event", async () => {
    const process = { sendInput: vi.fn(), stop: vi.fn(async () => 0) };
    const adapter: AgentAdapter = {
      id: "codex",
      displayName: "Codex",
      start: vi.fn(async () => process)
    };
    const manager = new SessionManager({ adapter, eventCacheSize: 10, workspace: "E:/repo" });
    const session = await manager.createSession();

    await manager.stopSession(session.id);

    expect(manager.listSessions()[0].status).toBe("stopped");
    expect(manager.eventsAfter(0).at(-1)?.type).toBe("session.finished");
  });

  it("notifies subscribers when new events are appended", async () => {
    const manager = new SessionManager({ adapter: fakeAdapter(), eventCacheSize: 10, workspace: "E:/repo" });
    const events: string[] = [];
    const unsubscribe = manager.subscribe((event) => events.push(event.type));

    await manager.createSession();
    unsubscribe();

    expect(events).toEqual(["agent.output", "session.started"]);
  });

  it("restores cached sessions and events from storage", async () => {
    const restoredSession: SessionSummary = {
      id: "sess_restored",
      adapterId: "codex",
      workspace: "E:/repo",
      status: "running",
      startedAt: "2026-06-30T14:30:00.000Z",
      lastSeq: 2
    };
    const restoredEvent = createEnvelope({
      type: "agent.output",
      deviceId: "agent-host",
      sessionId: "sess_restored",
      seq: 2,
      payload: { text: "cached output" }
    });
    const storage: SessionStorage = {
      loadSessions: vi.fn(async () => [restoredSession]),
      saveSessions: vi.fn(),
      loadEvents: vi.fn(async () => [restoredEvent]),
      appendEvent: vi.fn()
    };
    const manager = new SessionManager({ adapter: fakeAdapter(), eventCacheSize: 10, workspace: "E:/repo", storage });

    await manager.loadFromStorage();

    expect(manager.listSessions()).toEqual([
      {
        ...restoredSession,
        status: "exited"
      }
    ]);
    expect(manager.eventsAfter(1)).toEqual([restoredEvent]);
  });

  it("persists appended events and session summaries", async () => {
    const storage: SessionStorage = {
      loadSessions: vi.fn(async () => []),
      saveSessions: vi.fn(),
      loadEvents: vi.fn(async () => []),
      appendEvent: vi.fn()
    };
    const manager = new SessionManager({ adapter: fakeAdapter(), eventCacheSize: 10, workspace: "E:/repo", storage });

    await manager.createSession();

    expect(storage.appendEvent).toHaveBeenCalledTimes(2);
    expect(storage.saveSessions).toHaveBeenCalledWith(manager.listSessions());
  });

  it("rejects input for restored non-running sessions", async () => {
    const restoredSession: SessionSummary = {
      id: "sess_restored",
      adapterId: "codex",
      workspace: "E:/repo",
      status: "exited",
      startedAt: "2026-06-30T14:30:00.000Z",
      lastSeq: 1
    };
    const storage: SessionStorage = {
      loadSessions: vi.fn(async () => [restoredSession]),
      saveSessions: vi.fn(),
      loadEvents: vi.fn(async (): Promise<Envelope[]> => []),
      appendEvent: vi.fn()
    };
    const manager = new SessionManager({ adapter: fakeAdapter(), eventCacheSize: 10, workspace: "E:/repo", storage });
    await manager.loadFromStorage();

    await expect(manager.sendInput("sess_restored", "hello")).rejects.toBeInstanceOf(NonRunningSessionError);
  });

  it("syncs desktop Codex threads into running sessions", async () => {
    const process = { sendInput: vi.fn(), stop: vi.fn(async () => 0) };
    const adapter: AgentAdapter = {
      id: "codex",
      displayName: "Codex",
      start: vi.fn(async () => process),
      discoverSessions: vi.fn(async () => [
        {
          id: "thr_desktop",
          workspace: "E:/repo",
          title: "Desktop thread",
          updatedAt: "2026-07-02T20:00:00.000Z"
        }
      ]),
      attachSession: vi.fn(async () => process)
    };
    const manager = new SessionManager({ adapter, eventCacheSize: 10, workspace: "E:/repo" });

    await manager.syncDesktopSessions();

    expect(manager.listSessions()).toEqual([
      expect.objectContaining({
        id: "codex_thr_desktop",
        adapterId: "codex",
        workspace: "E:/repo",
        status: "running"
      })
    ]);
  });

  it("attaches to a desktop Codex thread before forwarding mobile input", async () => {
    const process = { sendInput: vi.fn(), stop: vi.fn(async () => 0) };
    const adapter: AgentAdapter = {
      id: "codex",
      displayName: "Codex",
      start: vi.fn(async () => process),
      discoverSessions: vi.fn(async () => [
        {
          id: "thr_desktop",
          workspace: "E:/repo",
          title: "Desktop thread",
          updatedAt: "2026-07-02T20:00:00.000Z"
        }
      ]),
      attachSession: vi.fn(async () => process)
    };
    const manager = new SessionManager({ adapter, eventCacheSize: 10, workspace: "E:/repo" });

    await manager.syncDesktopSessions();
    await manager.sendInput("codex_thr_desktop", "from phone");

    expect(adapter.attachSession).toHaveBeenCalledWith({
      externalId: "thr_desktop",
      sessionId: "codex_thr_desktop",
      workspace: "E:/repo",
      onOutput: expect.any(Function),
      onExit: expect.any(Function)
    });
    expect(process.sendInput).toHaveBeenCalledWith("from phone\n");
  });

  it("attaches to a desktop Codex thread without sending input", async () => {
    const process = { sendInput: vi.fn(), stop: vi.fn(async () => 0) };
    const adapter: AgentAdapter = {
      id: "codex",
      displayName: "Codex",
      start: vi.fn(async () => process),
      discoverSessions: vi.fn(async () => [
        {
          id: "thr_desktop",
          workspace: "E:/repo",
          title: "Desktop thread",
          updatedAt: "2026-07-02T20:00:00.000Z"
        }
      ]),
      attachSession: vi.fn(async ({ onOutput }) => {
        onOutput("stdout", "previous answer");
        return process;
      })
    };
    const manager = new SessionManager({ adapter, eventCacheSize: 10, workspace: "E:/repo" });

    await manager.syncDesktopSessions();
    await manager.attachSession("codex_thr_desktop");
    await manager.attachSession("codex_thr_desktop");

    expect(adapter.attachSession).toHaveBeenCalledTimes(1);
    expect(process.sendInput).not.toHaveBeenCalled();
    expect(manager.eventsAfter(0)).toEqual([
      expect.objectContaining({
        type: "agent.output",
        sessionId: "codex_thr_desktop",
        payload: { text: "previous answer" }
      })
    ]);
  });
});
