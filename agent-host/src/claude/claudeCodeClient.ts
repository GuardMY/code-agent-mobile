import { createInterface } from "node:readline";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentProcess } from "../sessions/sessionManager.js";

export interface ClaudeCodeClientOptions {
  cwd: string;
  onOutput: (stream: "stdout" | "stderr", text: string) => void;
  onExit: (exitCode: number) => void;
  autoAllowTools?: boolean;
}

interface ClaudeCodeSystemInit {
  type: "system";
  subtype: "init";
  session_id: string;
  model: string;
  cwd: string;
  tools?: string[];
}

interface ClaudeCodeAssistantMessage {
  type: "assistant";
  message: {
    role: "assistant";
    content: Array<{ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
}

interface ClaudeCodeUserMessage {
  type: "user";
  message: {
    role: "user";
    content: Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }>;
  };
}

interface ClaudeCodeControlRequest {
  type: "control_request";
  request_id: string;
  request: {
    subtype: string;
    tool_name: string;
    input: Record<string, unknown>;
    decision_reason?: string;
    tool_use_id?: string;
  };
}

interface ClaudeCodeResult {
  type: "result";
  subtype: "success" | "error";
  result?: string;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: { input_tokens: number; output_tokens: number };
  errors?: string[];
}

interface ClaudeCodeStreamEvent {
  type: "stream_event";
  event: {
    type: string;
    content_block?: { type: string; name?: string };
    delta?: { type: string; text?: string; partial_json?: string };
  };
}

type ClaudeCodeOutputEvent =
  | ClaudeCodeSystemInit
  | ClaudeCodeAssistantMessage
  | ClaudeCodeUserMessage
  | ClaudeCodeControlRequest
  | ClaudeCodeResult
  | ClaudeCodeStreamEvent;

export class ClaudeCodeProcess implements AgentProcess {
  constructor(
    private readonly client: ClaudeCodeClient,
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly exited: Promise<number>
  ) {}

  sendInput(input: string): void {
    this.client.sendUserMessage(input);
  }

  async stop(): Promise<number> {
    this.child.kill("SIGTERM");
    return this.exited;
  }
}

export class ClaudeCodeClient {
  private sessionId?: string;
  private initPromise: Promise<ClaudeCodeSystemInit>;
  private initResolve!: (value: ClaudeCodeSystemInit) => void;
  private initReject!: (error: Error) => void;
  private turnInFlight = false;
  private streamedMessageText = "";

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly options: ClaudeCodeClientOptions
  ) {
    this.initPromise = new Promise<ClaudeCodeSystemInit>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
    });

    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => this.handleStdoutLine(line));

    const stderr = createInterface({ input: child.stderr });
    stderr.on("line", (line) => {
      if (line.trim()) {
        this.options.onOutput("stderr", `${line}\n`);
      }
    });

    child.on("exit", (exitCode) => {
      this.options.onExit(exitCode ?? 0);
    });

    child.on("error", (error) => {
      this.initReject(error instanceof Error ? error : new Error(String(error)));
      this.options.onExit(1);
    });

    // Set a timeout for init
    setTimeout(() => {
      if (!this.sessionId) {
        this.initReject(new Error("Timed out waiting for Claude Code system/init event"));
      }
    }, 30_000);
  }

  waitForInit(): Promise<ClaudeCodeSystemInit> {
    return this.initPromise;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  sendUserMessage(text: string): void {
    const message = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text }]
      }
    };
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    this.turnInFlight = true;
  }

  sendControlResponse(requestId: string, behavior: "allow" | "deny", message?: string): void {
    const response: Record<string, unknown> = { behavior };
    if (message && behavior === "deny") {
      response.message = message;
    }
    const controlResponse = {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response
      }
    };
    this.child.stdin.write(`${JSON.stringify(controlResponse)}\n`);
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const event = JSON.parse(trimmed) as ClaudeCodeOutputEvent;
      this.dispatchEvent(event);
    } catch {
      // Non-JSON output (e.g., raw text) — forward as stdout
      this.options.onOutput("stdout", `${line}\n`);
    }
  }

  private dispatchEvent(event: ClaudeCodeOutputEvent): void {
    switch (event.type) {
      case "system":
        if (event.subtype === "init") {
          this.sessionId = event.session_id;
          this.initResolve(event as ClaudeCodeSystemInit);
        }
        break;

      case "assistant":
        this.handleAssistantEvent(event as ClaudeCodeAssistantMessage);
        break;

      case "user":
        this.handleUserEvent(event as ClaudeCodeUserMessage);
        break;

      case "control_request":
        this.handleControlRequest(event as ClaudeCodeControlRequest);
        break;

      case "result":
        this.handleResult(event as ClaudeCodeResult);
        break;

      case "stream_event":
        this.handleStreamEvent(event as ClaudeCodeStreamEvent);
        break;

      default:
        // Unknown event type — forward as stdout
        this.options.onOutput("stdout", `${JSON.stringify(event)}\n`);
        break;
    }
  }

  private handleAssistantEvent(event: ClaudeCodeAssistantMessage): void {
    this.streamedMessageText = "";

    for (const block of event.message.content) {
      if (block.type === "text") {
        this.options.onOutput("stdout", block.text);
      } else if (block.type === "tool_use") {
        // Emit tool use as structured output
        this.options.onOutput(
          "stdout",
          `\n[Tool: ${block.name}]\n`
        );
        try {
          this.options.onOutput(
            "stdout",
            JSON.stringify(block.input, null, 2) + "\n"
          );
        } catch {
          this.options.onOutput("stdout", `${String(block.input)}\n`);
        }
      }
    }

    if (event.message.usage) {
      this.options.onOutput(
        "stdout",
        `\n[Tokens: in=${event.message.usage.input_tokens}, out=${event.message.usage.output_tokens}]\n`
      );
    }
  }

  private handleUserEvent(event: ClaudeCodeUserMessage): void {
    for (const block of event.message.content) {
      if (block.type === "tool_result") {
        const prefix = block.is_error ? "[Tool Error]" : "[Tool Result]";
        this.options.onOutput("stdout", `\n${prefix}:\n`);
        try {
          const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          // Truncate very long results
          const truncated = content.length > 2000 ? content.slice(0, 2000) + "\n... (truncated)" : content;
          this.options.onOutput("stdout", truncated + "\n");
        } catch {
          this.options.onOutput("stdout", `${String(block.content)}\n`);
        }
      }
    }
  }

  private handleControlRequest(event: ClaudeCodeControlRequest): void {
    if (this.options.autoAllowTools) {
      this.sendControlResponse(event.request_id, "allow");
      this.options.onOutput(
        "stdout",
        `\n[Auto-allowed: ${event.request.tool_name}]\n`
      );
    } else {
      // Deny by default in non-interactive mode
      this.sendControlResponse(event.request_id, "deny", "Tool use denied in non-interactive mode");
      this.options.onOutput(
        "stderr",
        `\n[Tool denied: ${event.request.tool_name} — ${event.request.decision_reason ?? "not in allowlist"}]\n`
      );
    }
  }

  private handleResult(event: ClaudeCodeResult): void {
    this.turnInFlight = false;

    if (event.subtype === "success" && event.result) {
      try {
        // result field is double-encoded JSON
        const parsed = JSON.parse(event.result);
        if (typeof parsed === "string" && parsed.trim()) {
          this.options.onOutput("stdout", `\n${parsed}\n`);
        }
      } catch {
        // Not double-encoded JSON, use as-is
      }
    }

    if (event.subtype === "error") {
      const errorText = event.errors?.join("; ") ?? "Unknown error";
      this.options.onOutput("stderr", `\n[Error: ${errorText}]\n`);
    }
  }

  private handleStreamEvent(event: ClaudeCodeStreamEvent): void {
    const inner = event.event;
    if (inner.type === "content_block_delta" && inner.delta?.type === "text_delta" && inner.delta.text) {
      this.streamedMessageText += inner.delta.text;
      this.options.onOutput("stdout", inner.delta.text);
    }
  }
}

export async function createClaudeCodeProcess(input: {
  child: ChildProcessWithoutNullStreams;
  options: ClaudeCodeClientOptions;
}): Promise<ClaudeCodeProcess> {
  const client = new ClaudeCodeClient(input.child, input.options);
  await client.waitForInit();

  const exited = new Promise<number>((resolve) => {
    input.child.on("exit", (exitCode) => resolve(exitCode ?? 0));
  });

  return new ClaudeCodeProcess(client, input.child, exited);
}
