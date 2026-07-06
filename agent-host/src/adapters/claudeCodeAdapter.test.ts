import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const createClaudeCodeProcessMock = vi.hoisted(() => vi.fn());
const discoverClaudeCodeSessionsMock = vi.hoisted(() => vi.fn());
const replaySessionHistoryMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../claude/claudeCodeClient.js", () => ({
  createClaudeCodeProcess: createClaudeCodeProcessMock,
}));

vi.mock("../claude/sessionDiscovery.js", () => ({
  discoverClaudeCodeSessions: discoverClaudeCodeSessionsMock,
}));

vi.mock("../claude/sessionTailer.js", () => ({
  replaySessionHistory: replaySessionHistoryMock,
}));

import { ClaudeCodeAdapter } from "./claudeCodeAdapter.js";

describe("ClaudeCodeAdapter", () => {
  afterEach(() => {
    spawnMock.mockReset();
    createClaudeCodeProcessMock.mockReset();
    discoverClaudeCodeSessionsMock.mockReset();
    replaySessionHistoryMock.mockReset();
  });

  describe("start", () => {
    it("starts claude with stream-json flags", async () => {
      createClaudeCodeProcessMock.mockResolvedValue({} as never);
      spawnMock.mockReturnValue({} as never);

      const adapter = new ClaudeCodeAdapter({ command: "claude" });

      await adapter.start({
        sessionId: "sess_1",
        workspace: "E:/repo",
        onOutput: vi.fn(),
        onExit: vi.fn(),
      });

      expect(spawnMock).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining([
          "--print",
          "--output-format",
          "stream-json",
          "--input-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--permission-mode",
          "acceptEdits",
          "--name",
          "sess_1",
        ]),
        expect.objectContaining({
          cwd: "E:/repo",
          shell: process.platform === "win32",
          stdio: ["pipe", "pipe", "pipe"],
        }),
      );
      expect(createClaudeCodeProcessMock).toHaveBeenCalledOnce();
    });

    it("passes autoAllowTools option to client", async () => {
      createClaudeCodeProcessMock.mockResolvedValue({} as never);
      spawnMock.mockReturnValue({} as never);

      const adapter = new ClaudeCodeAdapter({ command: "claude", autoAllowTools: false });

      await adapter.start({
        sessionId: "sess_2",
        workspace: "E:/repo",
        onOutput: vi.fn(),
        onExit: vi.fn(),
      });

      expect(createClaudeCodeProcessMock).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            autoAllowTools: false,
          }),
        }),
      );
    });

    it("supports custom permission mode", async () => {
      createClaudeCodeProcessMock.mockResolvedValue({} as never);
      spawnMock.mockReturnValue({} as never);

      const adapter = new ClaudeCodeAdapter({ command: "claude", permissionMode: "bypassPermissions" });

      await adapter.start({
        sessionId: "sess_3",
        workspace: "E:/repo",
        onOutput: vi.fn(),
        onExit: vi.fn(),
      });

      expect(spawnMock).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["--permission-mode", "bypassPermissions"]),
        expect.any(Object),
      );
    });
  });

  describe("discoverSessions", () => {
    it("delegates to discoverClaudeCodeSessions", async () => {
      const mockSessions = [
        { id: "abc-123", workspace: "E:/repo", title: "Hello", updatedAt: "2026-01-01T00:00:00Z" },
        { id: "def-456", workspace: "E:/repo", title: undefined, updatedAt: "2026-01-02T00:00:00Z" },
      ];
      discoverClaudeCodeSessionsMock.mockResolvedValue(mockSessions);

      const adapter = new ClaudeCodeAdapter({ command: "claude" });
      const result = await adapter.discoverSessions({ workspace: "E:/repo" });

      expect(result).toEqual(mockSessions);
      expect(discoverClaudeCodeSessionsMock).toHaveBeenCalledWith({ workspace: "E:/repo" });
    });
  });

  describe("attachSession", () => {
    it("uses --resume when attaching to an existing session", async () => {
      createClaudeCodeProcessMock.mockResolvedValue({} as never);
      spawnMock.mockReturnValue({} as never);
      replaySessionHistoryMock.mockResolvedValue(0);

      const adapter = new ClaudeCodeAdapter({ command: "claude" });

      await adapter.attachSession({
        externalId: "abc-123-session",
        sessionId: "sess_attach",
        workspace: "E:/repo",
        onOutput: vi.fn(),
        onExit: vi.fn(),
      });

      expect(spawnMock).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["--resume", "abc-123-session"]),
        expect.any(Object),
      );
    });

    it("replays session history before attaching", async () => {
      createClaudeCodeProcessMock.mockResolvedValue({} as never);
      spawnMock.mockReturnValue({} as never);
      replaySessionHistoryMock.mockResolvedValue(5);
      const onOutput = vi.fn();

      const adapter = new ClaudeCodeAdapter({ command: "claude" });

      await adapter.attachSession({
        externalId: "abc-123-session",
        sessionId: "sess_attach",
        workspace: "E:/repo",
        onOutput,
        onExit: vi.fn(),
      });

      // Should have called replay with the correct file path
      expect(replaySessionHistoryMock).toHaveBeenCalledOnce();
      const replayCall = replaySessionHistoryMock.mock.calls[0][0];
      expect(replayCall.filePath).toContain(".claude");
      expect(replayCall.filePath).toContain("abc-123-session.jsonl");
      expect(replayCall.onOutput).toBe(onOutput);

      // Should emit a separator after replay
      expect(onOutput).toHaveBeenCalledWith("stdout", expect.stringContaining("--- 以上为历史会话内容"));
    });

    it("skips separator when no history was replayed", async () => {
      createClaudeCodeProcessMock.mockResolvedValue({} as never);
      spawnMock.mockReturnValue({} as never);
      replaySessionHistoryMock.mockResolvedValue(0);
      const onOutput = vi.fn();

      const adapter = new ClaudeCodeAdapter({ command: "claude" });

      await adapter.attachSession({
        externalId: "abc-123-session",
        sessionId: "sess_attach",
        workspace: "E:/repo",
        onOutput,
        onExit: vi.fn(),
      });

      // Should NOT emit separator when count is 0
      expect(onOutput).not.toHaveBeenCalledWith("stdout", expect.stringContaining("--- 以上为历史会话内容"));
    });

    it("skips history replay when replayHistory is disabled", async () => {
      createClaudeCodeProcessMock.mockResolvedValue({} as never);
      spawnMock.mockReturnValue({} as never);

      const adapter = new ClaudeCodeAdapter({ command: "claude", replayHistory: false });

      await adapter.attachSession({
        externalId: "abc-123-session",
        sessionId: "sess_attach",
        workspace: "E:/repo",
        onOutput: vi.fn(),
        onExit: vi.fn(),
      });

      expect(replaySessionHistoryMock).not.toHaveBeenCalled();
    });

    it("proceeds without history when replay fails", async () => {
      createClaudeCodeProcessMock.mockResolvedValue({} as never);
      spawnMock.mockReturnValue({} as never);
      replaySessionHistoryMock.mockRejectedValue(new Error("File not found"));

      const adapter = new ClaudeCodeAdapter({ command: "claude" });

      // Should not throw even if replay fails
      await expect(
        adapter.attachSession({
          externalId: "abc-123-session",
          sessionId: "sess_attach",
          workspace: "E:/repo",
          onOutput: vi.fn(),
          onExit: vi.fn(),
        }),
      ).resolves.not.toThrow();

      // Should still spawn the process
      expect(spawnMock).toHaveBeenCalled();
    });
  });

  describe("id and displayName", () => {
    it("has correct id and displayName", () => {
      const adapter = new ClaudeCodeAdapter({ command: "claude" });
      expect(adapter.id).toBe("claude-code");
      expect(adapter.displayName).toBe("Claude Code");
    });
  });
});
