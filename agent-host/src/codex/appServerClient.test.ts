import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { AppServerClient, createAppServerCodexProcess, createAttachedAppServerCodexProcess } from "./appServerClient.js";

function createFakeChild() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => void;
  };
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn(() => {
    child.emit("exit", 0);
  });
  return child;
}

describe("appServerClient", () => {
  it("initializes app-server and sends turns over json-rpc", async () => {
    const child = createFakeChild();
    const writes: string[] = [];
    let buffer = "";

    child.stdin.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim()) {
          writes.push(line);
          const message = JSON.parse(line) as { id?: number; method?: string };
          if (message.id === 0) {
            child.stdout.write(`${JSON.stringify({ id: 0, result: { ok: true } })}\n`);
          } else if (message.id === 1) {
            child.stdout.write(`${JSON.stringify({ id: 1, result: { thread: { id: "thr_1" } } })}\n`);
          } else if (message.id === 2) {
            child.stdout.write(`${JSON.stringify({ id: 2, result: { turn: { id: "turn_1" } } })}\n`);
            child.stdout.write(`${JSON.stringify({ method: "turn/started", params: { turn: { id: "turn_1" } } })}\n`);
            child.stdout.write(`${JSON.stringify({ method: "item/agentMessage/delta", params: { text: "hello" } })}\n`);
            child.stdout.write(`${JSON.stringify({ method: "turn/completed", params: { turn: { id: "turn_1" } } })}\n`);
          }
        }
        index = buffer.indexOf("\n");
      }
    });

    const outputs: string[] = [];
    const process = await createAppServerCodexProcess({
      child: child as never,
      options: {
        clientInfo: {
          name: "agent_mobile_vscode",
          title: "Agent Mobile VS Code",
          version: "0.1.0"
        },
        cwd: "E:/repo",
        onOutput: (_stream, text) => outputs.push(text),
        onExit: vi.fn()
      }
    });

    await process.sendInput("hello");

    expect(writes).toEqual([
      JSON.stringify({
        id: 0,
        method: "initialize",
        params: {
          clientInfo: {
            name: "agent_mobile_vscode",
            title: "Agent Mobile VS Code",
            version: "0.1.0"
          },
          capabilities: { experimentalApi: true }
        }
      }),
      JSON.stringify({ method: "initialized", params: {} }),
      JSON.stringify({
        id: 1,
        method: "thread/start",
        params: { cwd: "E:/repo" }
      }),
      JSON.stringify({
        id: 2,
        method: "turn/start",
        params: {
          threadId: "thr_1",
          input: [{ type: "text", text: "hello" }]
        }
      })
    ]);
    expect(outputs).toContain("hello");
  });

  it("lists existing Codex threads from app-server", async () => {
    const child = createFakeChild();
    const writes: string[] = [];
    child.stdin.on("data", (chunk) => {
      const line = chunk.toString("utf8").trim();
      if (!line) {
        return;
      }
      writes.push(line);
      const message = JSON.parse(line) as { id?: number };
      if (message.id === 0) {
        child.stdout.write(`${JSON.stringify({ id: 0, result: { ok: true } })}\n`);
      } else if (message.id === 1) {
        child.stdout.write(
          `${JSON.stringify({
            id: 1,
            result: {
              threads: [
                {
                  id: "thr_recent",
                  cwd: "E:/repo",
                  title: "Fix mobile handoff",
                  updatedAt: "2026-07-02T20:00:00.000Z"
                }
              ]
            }
          })}\n`
        );
      }
    });
    const client = new AppServerClient(child as never, {
      clientInfo: { name: "agent_mobile_vscode", title: "Agent Mobile VS Code", version: "0.1.0" },
      cwd: "E:/repo",
      onOutput: vi.fn(),
      onExit: vi.fn()
    });

    await client.initialize();
    const threads = await client.listThreads();

    expect(threads).toEqual([
      {
        id: "thr_recent",
        cwd: "E:/repo",
        title: "Fix mobile handoff",
        updatedAt: "2026-07-02T20:00:00.000Z"
      }
    ]);
    expect(writes.at(-1)).toBe(JSON.stringify({ id: 1, method: "thread/list", params: {} }));
  });

  it("lists Codex threads returned in the current app-server data envelope", async () => {
    const child = createFakeChild();
    child.stdin.on("data", (chunk) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (!line.trim()) {
          continue;
        }
        const message = JSON.parse(line) as { id?: number };
        if (message.id === 0) {
          child.stdout.write(`${JSON.stringify({ id: 0, result: { ok: true } })}\n`);
        } else if (message.id === 1) {
          child.stdout.write(
            `${JSON.stringify({
              id: 1,
              result: {
                data: [
                  {
                    id: "019f26f7-2293-7910-9f50-4260577b32d8",
                    cwd: "e:/Code/code-agent-mobile",
                    name: "Debug Codex connection",
                    updatedAt: 1783065347
                  }
                ],
                nextCursor: null
              }
            })}\n`
          );
        }
      }
    });
    const client = new AppServerClient(child as never, {
      clientInfo: { name: "agent_mobile_vscode", title: "Agent Mobile VS Code", version: "0.1.0" },
      cwd: "E:/repo",
      onOutput: vi.fn(),
      onExit: vi.fn()
    });

    await client.initialize();
    const threads = await client.listThreads();

    expect(threads).toEqual([
      {
        id: "019f26f7-2293-7910-9f50-4260577b32d8",
        cwd: "e:/Code/code-agent-mobile",
        title: "Debug Codex connection",
        updatedAt: "2026-07-03T07:55:47.000Z"
      }
    ]);
  });

  it("rejects pending app-server requests when the child process cannot spawn", async () => {
    const child = createFakeChild();
    const onExit = vi.fn();
    const client = new AppServerClient(child as never, {
      clientInfo: { name: "agent_mobile_vscode", title: "Agent Mobile VS Code", version: "0.1.0" },
      cwd: "E:/repo",
      onOutput: vi.fn(),
      onExit
    });

    const initializing = client.initialize();
    const error = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
    child.emit("error", error);

    await expect(initializing).rejects.toThrow("spawn codex ENOENT");
    expect(onExit).toHaveBeenCalledWith(1);
  });

  it("resumes an existing thread and sends input to it", async () => {
    const child = createFakeChild();
    const writes: string[] = [];
    child.stdin.on("data", (chunk) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (!line.trim()) {
          continue;
        }
        writes.push(line);
        const message = JSON.parse(line) as { id?: number };
        if (message.id === 0) {
          child.stdout.write(`${JSON.stringify({ id: 0, result: { ok: true } })}\n`);
        } else if (message.id === 1) {
          child.stdout.write(`${JSON.stringify({ id: 1, result: { thread: { id: "thr_existing" } } })}\n`);
        } else if (message.id === 2) {
          child.stdout.write(`${JSON.stringify({ id: 2, result: { turn: { id: "turn_existing" } } })}\n`);
        }
      }
    });

    const process = await createAttachedAppServerCodexProcess({
      child: child as never,
      threadId: "thr_existing",
      options: {
        clientInfo: { name: "agent_mobile_vscode", title: "Agent Mobile VS Code", version: "0.1.0" },
        cwd: "E:/repo",
        onOutput: vi.fn(),
        onExit: vi.fn()
      }
    });
    await process.sendInput("continue from phone");

    expect(writes).toContain(JSON.stringify({ id: 1, method: "thread/resume", params: { threadId: "thr_existing" } }));
    expect(writes).toContain(
      JSON.stringify({
        id: 2,
        method: "turn/start",
        params: {
          threadId: "thr_existing",
          input: [{ type: "text", text: "continue from phone" }]
        }
      })
    );
  });

  it("emits historical text returned by thread resume", async () => {
    const child = createFakeChild();
    child.stdin.on("data", (chunk) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (!line.trim()) {
          continue;
        }
        const message = JSON.parse(line) as { id?: number };
        if (message.id === 0) {
          child.stdout.write(`${JSON.stringify({ id: 0, result: { ok: true } })}\n`);
        } else if (message.id === 1) {
          child.stdout.write(
            `${JSON.stringify({
              id: 1,
              result: {
                thread: { id: "thr_existing" },
                items: [{ message: { content: [{ type: "text", text: "previous answer" }] } }]
              }
            })}\n`
          );
        }
      }
    });
    const outputs: string[] = [];

    await createAttachedAppServerCodexProcess({
      child: child as never,
      threadId: "thr_existing",
      options: {
        clientInfo: { name: "agent_mobile_vscode", title: "Agent Mobile VS Code", version: "0.1.0" },
        cwd: "E:/repo",
        onOutput: (_stream, text) => outputs.push(text),
        onExit: vi.fn()
      }
    });

    expect(outputs).toContain("previous answer");
  });

  it("emits historical text from current Codex thread turns", async () => {
    const child = createFakeChild();
    child.stdin.on("data", (chunk) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (!line.trim()) {
          continue;
        }
        const message = JSON.parse(line) as { id?: number };
        if (message.id === 0) {
          child.stdout.write(`${JSON.stringify({ id: 0, result: { ok: true } })}\n`);
        } else if (message.id === 1) {
          child.stdout.write(
            `${JSON.stringify({
              id: 1,
              result: {
                thread: {
                  id: "thr_existing",
                  turns: [
                    {
                      items: [
                        {
                          type: "userMessage",
                          content: [{ type: "text", text: "previous question" }]
                        },
                        {
                          type: "agentMessage",
                          text: "previous answer"
                        }
                      ]
                    }
                  ]
                }
              }
            })}\n`
          );
        }
      }
    });
    const outputs: string[] = [];

    await createAttachedAppServerCodexProcess({
      child: child as never,
      threadId: "thr_existing",
      options: {
        clientInfo: { name: "agent_mobile_vscode", title: "Agent Mobile VS Code", version: "0.1.0" },
        cwd: "E:/repo",
        onOutput: (_stream, text) => outputs.push(text),
        onExit: vi.fn()
      }
    });

    expect(outputs).toEqual(["previous question", "previous answer"]);
  });
});
