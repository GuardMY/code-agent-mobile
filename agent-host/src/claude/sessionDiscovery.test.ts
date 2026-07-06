import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverClaudeCodeSessions, workspaceToProjectSlug } from "./sessionDiscovery.js";

// Use a simple workspace name (no colons/slashes) so the slug is the same string
const testWorkspace = "test_workspace_for_agent_mobile";
const testProjectDir = join(homedir(), ".claude", "projects", testWorkspace);

describe("workspaceToProjectSlug", () => {
  it("converts Windows paths", () => {
    expect(workspaceToProjectSlug("e:\\Code\\code-agent-mobile")).toBe(
      "e--Code-code-agent-mobile",
    );
  });

  it("converts Unix paths", () => {
    expect(workspaceToProjectSlug("/home/user/project")).toBe(
      "-home-user-project",
    );
  });

  it("converts WSL-style paths", () => {
    expect(workspaceToProjectSlug("C:\\Users\\guard\\repo")).toBe(
      "C--Users-guard-repo",
    );
  });
});

describe("discoverClaudeCodeSessions", () => {
  beforeAll(async () => {
    await mkdir(testProjectDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testProjectDir, { recursive: true, force: true });
  });

  it("returns empty array when project directory does not exist", async () => {
    const result = await discoverClaudeCodeSessions({
      workspace: "/nonexistent/path/that/does/not/exist",
    });
    expect(result).toEqual([]);
  });

  it("discovers sessions from jsonl files", async () => {
    const session1 = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "帮我写一个函数" }],
      },
      sessionId: "aaa-bbb-ccc",
      timestamp: "2026-07-06T10:00:00.000Z",
    };

    const session2 = {
      type: "queue-operation",
      operation: "enqueue",
      timestamp: "2026-07-06T11:00:00.000Z",
      sessionId: "ddd-eee-fff",
    };
    const session2User = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "帮我调试这个bug，它会导致程序崩溃" }],
      },
      sessionId: "ddd-eee-fff",
      timestamp: "2026-07-06T11:00:01.000Z",
    };

    await writeFile(
      join(testProjectDir, "aaa-bbb-ccc.jsonl"),
      JSON.stringify(session1) + "\n",
      "utf-8",
    );
    await writeFile(
      join(testProjectDir, "ddd-eee-fff.jsonl"),
      JSON.stringify(session2) + "\n" + JSON.stringify(session2User) + "\n",
      "utf-8",
    );
    // Non-jsonl file should be ignored
    await writeFile(join(testProjectDir, "readme.txt"), "hello", "utf-8");

    const result = await discoverClaudeCodeSessions({ workspace: testWorkspace });

    expect(result).toHaveLength(2);

    const byId = new Map(result.map((s) => [s.id, s]));
    expect(byId.get("aaa-bbb-ccc")).toMatchObject({
      id: "aaa-bbb-ccc",
      title: "帮我写一个函数",
    });
    expect(byId.get("ddd-eee-fff")).toMatchObject({
      id: "ddd-eee-fff",
      title: "帮我调试这个bug，它会导致程序崩溃",
    });

    // Cleanup individual files
    await rm(join(testProjectDir, "aaa-bbb-ccc.jsonl"));
    await rm(join(testProjectDir, "ddd-eee-fff.jsonl"));
    await rm(join(testProjectDir, "readme.txt"));
  });

  it("truncates long titles to 80 characters", async () => {
    const longText = "A".repeat(200);
    const session = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: longText }],
      },
      sessionId: "long-title-test",
      timestamp: "2026-07-06T12:00:00.000Z",
    };

    await writeFile(
      join(testProjectDir, "long-title-test.jsonl"),
      JSON.stringify(session) + "\n",
      "utf-8",
    );

    const result = await discoverClaudeCodeSessions({ workspace: testWorkspace });

    const session_ = result.find((s) => s.id === "long-title-test");
    expect(session_).toBeDefined();
    expect(session_?.title).toHaveLength(83); // 80 chars + "..."
    expect(session_?.title).toMatch(/^A{80}\.\.\.$/);

    await rm(join(testProjectDir, "long-title-test.jsonl"));
  });

  it("prefers ai-title over first user message text", async () => {
    const session = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "<ide_opened_file>..." }],
      },
      sessionId: "ai-title-test",
      timestamp: "2026-07-06T14:00:00.000Z",
    };
    const aiTitleLine = {
      type: "ai-title",
      aiTitle: "修改 Git 远程仓库并推送",
      sessionId: "ai-title-test",
    };

    await writeFile(
      join(testProjectDir, "ai-title-test.jsonl"),
      JSON.stringify(session) + "\n" + JSON.stringify(aiTitleLine) + "\n",
      "utf-8",
    );

    const result = await discoverClaudeCodeSessions({ workspace: testWorkspace });

    const session_ = result.find((s) => s.id === "ai-title-test");
    expect(session_).toBeDefined();
    // Should use aiTitle, not the messy first user message
    expect(session_?.title).toBe("修改 Git 远程仓库并推送");

    await rm(join(testProjectDir, "ai-title-test.jsonl"));
  });

  it("uses last ai-title when multiple ai-title events exist", async () => {
    const session = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
      sessionId: "multi-ai-title-test",
      timestamp: "2026-07-06T15:00:00.000Z",
    };
    const firstTitle = {
      type: "ai-title",
      aiTitle: "first draft title",
      sessionId: "multi-ai-title-test",
    };
    const secondTitle = {
      type: "ai-title",
      aiTitle: "最终版本标题",
      sessionId: "multi-ai-title-test",
    };

    await writeFile(
      join(testProjectDir, "multi-ai-title-test.jsonl"),
      JSON.stringify(session) + "\n" +
      JSON.stringify(firstTitle) + "\n" +
      JSON.stringify(secondTitle) + "\n",
      "utf-8",
    );

    const result = await discoverClaudeCodeSessions({ workspace: testWorkspace });

    const session_ = result.find((s) => s.id === "multi-ai-title-test");
    expect(session_).toBeDefined();
    expect(session_?.title).toBe("最终版本标题");

    await rm(join(testProjectDir, "multi-ai-title-test.jsonl"));
  });

  it("returns sessions without title when first message is not a user type", async () => {
    const session = {
      type: "queue-operation",
      operation: "enqueue",
      timestamp: "2026-07-06T13:00:00.000Z",
      sessionId: "no-title-test",
    };

    await writeFile(
      join(testProjectDir, "no-title-test.jsonl"),
      JSON.stringify(session) + "\n",
      "utf-8",
    );

    const result = await discoverClaudeCodeSessions({ workspace: testWorkspace });

    const session_ = result.find((s) => s.id === "no-title-test");
    expect(session_).toBeDefined();
    expect(session_?.title).toBeUndefined();

    await rm(join(testProjectDir, "no-title-test.jsonl"));
  });
});
