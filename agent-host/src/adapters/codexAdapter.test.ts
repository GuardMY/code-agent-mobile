import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const createAppServerCodexProcessMock = vi.hoisted(() => vi.fn());
const appServerClientMock = vi.hoisted(() => vi.fn());
const createAttachedAppServerCodexProcessMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

vi.mock("../codex/appServerClient.js", () => ({
  AppServerClient: appServerClientMock,
  createAttachedAppServerCodexProcess: createAttachedAppServerCodexProcessMock,
  createAppServerCodexProcess: createAppServerCodexProcessMock
}));

import { CodexAdapter } from "./codexAdapter.js";

describe("CodexAdapter", () => {
  afterEach(() => {
    spawnMock.mockReset();
    appServerClientMock.mockReset();
    createAttachedAppServerCodexProcessMock.mockReset();
  });

  it("starts codex app-server over stdio", async () => {
    createAppServerCodexProcessMock.mockResolvedValue({} as never);
    spawnMock.mockReturnValue({} as never);

    const adapter = new CodexAdapter({ command: "codex", args: [] });

    await adapter.start({
      sessionId: "sess_1",
      workspace: "E:/repo",
      onOutput: vi.fn(),
      onExit: vi.fn()
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["app-server", "--listen", "stdio://"],
      expect.objectContaining({
        cwd: "E:/repo",
        shell: process.platform === "win32",
        stdio: ["pipe", "pipe", "pipe"]
      })
    );
    expect(createAppServerCodexProcessMock).toHaveBeenCalledOnce();
  });

  it("discovers threads using the workspace passed by SessionManager", async () => {
    spawnMock.mockReturnValue({ kill: vi.fn() } as never);
    appServerClientMock.mockImplementation(() => ({
      initialize: vi.fn(async () => undefined),
      listThreads: vi.fn(async () => [{ id: "thr_1", cwd: "E:/repo", updatedAt: "2026-07-02T20:00:00.000Z" }])
    }));
    const adapter = new CodexAdapter({ command: "codex", args: [] });

    const sessions = await adapter.discoverSessions?.({ workspace: "E:/repo" });

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["app-server", "--listen", "stdio://"],
      expect.objectContaining({ cwd: "E:/repo" })
    );
    expect(sessions).toEqual([
      {
        id: "thr_1",
        workspace: "E:/repo",
        title: undefined,
        updatedAt: "2026-07-02T20:00:00.000Z"
      }
    ]);
  });
});
