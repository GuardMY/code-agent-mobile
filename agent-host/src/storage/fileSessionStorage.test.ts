import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEnvelope, type SessionSummary } from "@agent-mobile/protocol";
import { describe, expect, it } from "vitest";
import { FileSessionStorage } from "./fileSessionStorage.js";

describe("FileSessionStorage", () => {
  it("persists sessions and appends events under .agent-mobile", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-mobile-storage-"));
    const storage = new FileSessionStorage(workspace);
    const session: SessionSummary = {
      id: "sess_1",
      adapterId: "codex",
      workspace,
      status: "running",
      startedAt: "2026-06-30T14:30:00.000Z",
      lastSeq: 1
    };
    const first = createEnvelope({
      type: "agent.output",
      deviceId: "agent-host",
      sessionId: "sess_1",
      seq: 1,
      payload: { text: "one" }
    });
    const second = createEnvelope({
      type: "agent.output",
      deviceId: "agent-host",
      sessionId: "sess_1",
      seq: 2,
      payload: { text: "two" }
    });

    await storage.saveSessions([session]);
    await storage.appendEvent(first);
    await storage.appendEvent(second);

    expect(await storage.loadSessions()).toEqual([session]);
    expect(await storage.loadEvents(1)).toEqual([second]);
    const rawEvents = await readFile(join(workspace, ".agent-mobile", "events.jsonl"), "utf8");
    expect(rawEvents.trim().split("\n")).toHaveLength(2);
  });

  it("returns empty collections when storage files do not exist", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-mobile-storage-"));
    const storage = new FileSessionStorage(workspace);

    expect(await storage.loadSessions()).toEqual([]);
    expect(await storage.loadEvents(10)).toEqual([]);
    expect(await storage.loadDevices()).toEqual([]);
    expect(await storage.loadApprovals()).toEqual([]);
  });

  it("persists devices and approvals", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-mobile-storage-"));
    const storage = new FileSessionStorage(workspace);

    await storage.saveDevices([
      {
        deviceId: "android_1",
        clientType: "android-app",
        pairedAt: "2026-06-30T14:30:00.000Z",
        accessTokenExpiresAt: "2026-06-30T15:30:00.000Z",
        revokedAt: "2026-06-30T15:00:00.000Z"
      }
    ]);
    await storage.saveApprovals([
      {
        approvalId: "appr_1",
        sessionId: "sess_1",
        risk: "high",
        action: "shell.execute",
        summary: "npm install",
        status: "pending",
        createdAt: "2026-06-30T14:30:00.000Z",
        timeoutSeconds: 300
      }
    ]);

    expect(await storage.loadDevices()).toMatchObject([{ deviceId: "android_1", revokedAt: expect.any(String) }]);
    expect(await storage.loadApprovals()).toMatchObject([{ approvalId: "appr_1", status: "pending" }]);
  });

  it("loads legacy devices without client type as Android app devices", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-mobile-storage-"));
    const storage = new FileSessionStorage(workspace);
    const storageDir = join(workspace, ".agent-mobile");
    await mkdir(storageDir, { recursive: true });
    await writeFile(
      join(storageDir, "devices.json"),
      JSON.stringify([
        {
          deviceId: "android_legacy",
          pairedAt: "2026-06-30T14:30:00.000Z",
          accessTokenExpiresAt: "2026-06-30T15:30:00.000Z"
        }
      ]),
      "utf8"
    );

    expect(await storage.loadDevices()).toMatchObject([{ deviceId: "android_legacy", clientType: "android-app" }]);
  });
});
