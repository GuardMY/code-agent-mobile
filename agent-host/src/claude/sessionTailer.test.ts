import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { replaySessionHistory } from "./sessionTailer.js";

const testDir = join(homedir(), ".claude", "projects", "__agent_mobile_test_tailer__");

describe("replaySessionHistory", () => {
  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("replays assistant messages as output", async () => {
    const events = [
      {
        type: "queue-operation",
        operation: "enqueue",
        timestamp: "2026-07-06T10:00:00.000Z",
        uuid: "evt-1",
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
        uuid: "evt-2",
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hi there!" }],
        },
        uuid: "evt-3",
      },
    ];

    const filePath = join(testDir, "replay-assistant.jsonl");
    await writeFile(
      filePath,
      events.map((e) => JSON.stringify(e)).join("\n"),
      "utf-8",
    );

    const onOutput = vi.fn();
    const count = await replaySessionHistory({ filePath, onOutput });

    // assistant event with text content should produce at least 1 output
    expect(count).toBeGreaterThanOrEqual(1);
    expect(onOutput).toHaveBeenCalledWith("stdout", expect.stringContaining("Hi there!"));

    await rm(filePath);
  });

  it("replays tool_use and tool_result events", async () => {
    const events = [
      {
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "list files" }] },
        uuid: "evt-10",
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "ls" } },
          ],
        },
        uuid: "evt-11",
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tool-1", content: "file1.txt\nfile2.txt" },
          ],
        },
        uuid: "evt-12",
      },
    ];

    const filePath = join(testDir, "replay-tools.jsonl");
    await writeFile(
      filePath,
      events.map((e) => JSON.stringify(e)).join("\n"),
      "utf-8",
    );

    const onOutput = vi.fn();
    await replaySessionHistory({ filePath, onOutput });

    expect(onOutput).toHaveBeenCalledWith("stdout", expect.stringContaining("Tool: Bash"));
    expect(onOutput).toHaveBeenCalledWith("stdout", expect.stringContaining("Tool Result"));

    await rm(filePath);
  });

  it("stops replay at untilUuid boundary", async () => {
    const events = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "First" }],
        },
        uuid: "evt-first",
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Second" }],
        },
        uuid: "evt-stop-here",
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Third" }],
        },
        uuid: "evt-third",
      },
    ];

    const filePath = join(testDir, "replay-until.jsonl");
    await writeFile(
      filePath,
      events.map((e) => JSON.stringify(e)).join("\n"),
      "utf-8",
    );

    const onOutput = vi.fn();
    await replaySessionHistory({ filePath, onOutput, untilUuid: "evt-stop-here" });

    expect(onOutput).toHaveBeenCalledWith("stdout", expect.stringContaining("First"));

    // "Second" is at the stop boundary itself — stops BEFORE it
    const secondCalls = onOutput.mock.calls.filter(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Second"),
    );
    expect(secondCalls).toHaveLength(0);

    // "Third" should not be reached
    const thirdCalls = onOutput.mock.calls.filter(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Third"),
    );
    expect(thirdCalls).toHaveLength(0);

    await rm(filePath);
  });

  it("throws for non-existent file", async () => {
    const onOutput = vi.fn();
    await expect(
      replaySessionHistory({
        filePath: join(testDir, "does-not-exist.jsonl"),
        onOutput,
      }),
    ).rejects.toThrow();
  });

  it("skips non-relevant event types", async () => {
    const events = [
      { type: "system", subtype: "init", uuid: "sys-1" },
      { type: "control_request", request_id: "r1", uuid: "ctrl-1" },
      { type: "queue-operation", operation: "enqueue", uuid: "q-1" },
    ];

    const filePath = join(testDir, "replay-skip.jsonl");
    await writeFile(
      filePath,
      events.map((e) => JSON.stringify(e)).join("\n"),
      "utf-8",
    );

    const onOutput = vi.fn();
    const count = await replaySessionHistory({ filePath, onOutput });

    expect(count).toBe(0);
    expect(onOutput).not.toHaveBeenCalled();

    await rm(filePath);
  });
});
