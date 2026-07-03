import { createInterface } from "node:readline";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentProcess } from "../sessions/sessionManager.js";

export interface AppServerClientOptions {
  clientInfo: {
    name: string;
    title: string;
    version: string;
  };
  cwd: string;
  onOutput: (stream: "stdout" | "stderr", text: string) => void;
  onExit: (exitCode: number) => void;
}

export interface CodexThreadSummary {
  id: string;
  cwd?: string;
  title?: string;
  updatedAt?: string;
}

export class AppServerCodexProcess implements AgentProcess {
  constructor(
    private readonly client: AppServerClient,
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly exited: Promise<number>
  ) {}

  sendInput(input: string): Promise<void> {
    return this.client.sendInput(input);
  }

  async stop(): Promise<number> {
    await this.client.interrupt();
    this.child.kill();
    return this.exited;
  }
}

export class AppServerClient {
  private nextId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private threadId?: string;
  private turnId?: string;
  private turnInFlight = false;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly options: AppServerClientOptions
  ) {
    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => this.handleStdoutLine(line));

    const stderr = createInterface({ input: child.stderr });
    stderr.on("line", (line) => {
      if (line.trim()) {
        this.options.onOutput("stderr", `${line}\n`);
      }
    });

    child.on("exit", (exitCode) => {
      this.rejectPending(new Error("app-server exited"));
      this.options.onExit(exitCode ?? 0);
    });
    child.on("error", (error) => {
      this.rejectPending(error instanceof Error ? error : new Error(String(error)));
      this.options.onExit(1);
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: this.options.clientInfo,
      capabilities: { experimentalApi: true }
    });
    this.notify("initialized", {});
  }

  async startThread(): Promise<string> {
    const result = await this.request("thread/start", {
      cwd: this.options.cwd
    });
    const threadId = readId(result, "thread");
    if (!threadId) {
      throw new Error("app-server did not return a thread id");
    }
    this.threadId = threadId;
    return threadId;
  }

  async listThreads(): Promise<CodexThreadSummary[]> {
    const result = await this.request("thread/list", {});
    return readThreads(result);
  }

  async resumeThread(threadId: string): Promise<string> {
    const result = await this.request("thread/resume", { threadId });
    const resumedThreadId = readId(result, "thread") ?? threadId;
    this.threadId = resumedThreadId;
    for (const text of readTexts(result)) {
      this.options.onOutput("stdout", text);
    }
    return resumedThreadId;
  }

  async sendInput(text: string): Promise<void> {
    if (!this.threadId) {
      throw new Error("app-server thread has not been started");
    }

    if (this.turnInFlight && this.turnId) {
      await this.request("turn/steer", {
        threadId: this.threadId,
        expectedTurnId: this.turnId,
        input: [{ type: "text", text }]
      });
      return;
    }

    const result = await this.request("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text }]
    });
    const turnId = readId(result, "turn");
    if (turnId) {
      this.turnId = turnId;
    }
    this.turnInFlight = true;
  }

  async interrupt(): Promise<void> {
    if (!this.threadId || !this.turnId) {
      return;
    }
    await this.request("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.turnId
    });
    this.turnInFlight = false;
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const message = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof message.id === "number") {
        this.handleResponse(message);
        return;
      }
      if (typeof message.method === "string") {
        this.handleNotification(message.method, message.params);
        return;
      }
    } catch {
      this.options.onOutput("stderr", `${line}\n`);
      return;
    }

    this.options.onOutput("stderr", `${line}\n`);
  }

  private handleResponse(message: Record<string, unknown>): void {
    const id = message.id;
    if (typeof id !== "number") {
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    if ("error" in message && message.error && typeof message.error === "object") {
      const error = message.error as { message?: unknown; code?: unknown };
      pending.reject(new Error(typeof error.message === "string" ? error.message : "app-server request failed"));
      return;
    }
    pending.resolve(message.result);
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === "turn/started") {
      const turnId = readNestedId(params, "turn");
      if (turnId) {
        this.turnId = turnId;
        this.turnInFlight = true;
      }
      return;
    }

    if (method === "turn/completed") {
      this.turnInFlight = false;
      return;
    }

    if (method === "item/agentMessage/delta") {
      const text = readText(params);
      if (text) {
        this.options.onOutput("stdout", text);
      }
      return;
    }

    if (method === "item/completed") {
      const text = readText(params);
      if (text) {
        this.options.onOutput("stdout", text);
      }
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const message = { id, method, params };
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  private notify(method: string, params: unknown): void {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function createAppServerCodexProcess(input: {
  child: ChildProcessWithoutNullStreams;
  options: AppServerClientOptions;
}): Promise<AppServerCodexProcess> {
  const client = new AppServerClient(input.child, input.options);
  return (async () => {
    await client.initialize();
    await client.startThread();
    const exited = new Promise<number>((resolve) => {
      input.child.on("exit", (exitCode) => resolve(exitCode ?? 0));
    });
    return new AppServerCodexProcess(client, input.child, exited);
  })();
}

export function createAttachedAppServerCodexProcess(input: {
  child: ChildProcessWithoutNullStreams;
  threadId: string;
  options: AppServerClientOptions;
}): Promise<AppServerCodexProcess> {
  const client = new AppServerClient(input.child, input.options);
  return (async () => {
    await client.initialize();
    await client.resumeThread(input.threadId);
    const exited = new Promise<number>((resolve) => {
      input.child.on("exit", (exitCode) => resolve(exitCode ?? 0));
    });
    return new AppServerCodexProcess(client, input.child, exited);
  })();
}

function readId(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const nested = (value as Record<string, unknown>)[key];
  if (!nested || typeof nested !== "object") {
    return undefined;
  }
  const id = (nested as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

function readNestedId(value: unknown, key: string): string | undefined {
  return readId(value, key);
}

function readThreads(value: unknown): CodexThreadSummary[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const threads = Array.isArray(record.threads) ? record.threads : record.data;
  if (!Array.isArray(threads)) {
    return [];
  }
  return threads.flatMap((thread) => {
    if (!thread || typeof thread !== "object") {
      return [];
    }
    const record = thread as Record<string, unknown>;
    if (typeof record.id !== "string") {
      return [];
    }
    return [
      {
        id: record.id,
        cwd: typeof record.cwd === "string" ? record.cwd : undefined,
        title: readOptionalString(record.title) ?? readOptionalString(record.name) ?? readOptionalString(record.preview),
        updatedAt: readOptionalDateTime(record.updatedAt)
      }
    ];
  });
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function readOptionalDateTime(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  return undefined;
}

function readText(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = readText(item);
      if (text) {
        return text;
      }
    }
    return undefined;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.delta === "string") {
    return record.delta;
  }
  if (record.delta) {
    const deltaText = readText(record.delta);
    if (deltaText) {
      return deltaText;
    }
  }
  if (record.content) {
    const contentText = readText(record.content);
    if (contentText) {
      return contentText;
    }
  }
  if (record.message) {
    const messageText = readText(record.message);
    if (messageText) {
      return messageText;
    }
  }
  if (record.item) {
    const itemText = readText(record.item);
    if (itemText) {
      return itemText;
    }
  }
  return undefined;
}

function readTexts(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => readTexts(item));
  }
  if (typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const ownText = typeof record.text === "string" ? [record.text] : [];
  return [
    ...ownText,
    ...readTexts(record.delta),
    ...readTexts(record.content),
    ...readTexts(record.message),
    ...readTexts(record.item),
    ...readTexts(record.items),
    ...readTexts(record.thread)
  ];
}
