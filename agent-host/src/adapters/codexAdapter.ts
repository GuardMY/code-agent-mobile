import { spawn } from "node:child_process";
import type { AgentAdapter, AgentProcess, DiscoveredAgentSession } from "../sessions/sessionManager.js";
import { AppServerClient, createAppServerCodexProcess, createAttachedAppServerCodexProcess } from "../codex/appServerClient.js";

export interface CodexAdapterOptions {
  command: string;
  args: string[];
}

export class CodexAdapter implements AgentAdapter {
  readonly id = "codex";
  readonly displayName = "Codex";

  constructor(private readonly options: CodexAdapterOptions) {}

  async start(options: {
    sessionId: string;
    workspace: string;
    onOutput: (stream: "stdout" | "stderr", text: string) => void;
    onExit: (exitCode: number) => void;
  }): Promise<AgentProcess> {
    const child = this.spawnAppServer(options.workspace);

    return createAppServerCodexProcess({
      child: child as typeof child & { stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream },
      options: {
        clientInfo: {
          name: "agent_mobile_vscode",
          title: "Agent Mobile VS Code",
          version: "0.1.0"
        },
        cwd: options.workspace,
        onOutput: options.onOutput,
        onExit: options.onExit
      }
    });
  }

  async discoverSessions(options: { workspace: string }): Promise<DiscoveredAgentSession[]> {
    const child = this.spawnAppServer(options.workspace);
    const client = new AppServerClient(child as typeof child & { stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream }, {
      clientInfo: {
        name: "agent_mobile_vscode",
        title: "Agent Mobile VS Code",
        version: "0.1.0"
      },
      cwd: options.workspace,
      onOutput: () => undefined,
      onExit: () => undefined
    });
    try {
      await client.initialize();
      const threads = await client.listThreads();
      return threads.map((thread) => ({
        id: thread.id,
        workspace: thread.cwd ?? options.workspace,
        title: thread.title,
        updatedAt: thread.updatedAt
      }));
    } finally {
      child.kill();
    }
  }

  async attachSession(options: {
    externalId: string;
    sessionId: string;
    workspace: string;
    onOutput: (stream: "stdout" | "stderr", text: string) => void;
    onExit: (exitCode: number) => void;
  }): Promise<AgentProcess> {
    const child = this.spawnAppServer(options.workspace);
    return createAttachedAppServerCodexProcess({
      child: child as typeof child & { stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream },
      threadId: options.externalId,
      options: {
        clientInfo: {
          name: "agent_mobile_vscode",
          title: "Agent Mobile VS Code",
          version: "0.1.0"
        },
        cwd: options.workspace,
        onOutput: options.onOutput,
        onExit: options.onExit
      }
    });
  }

  private spawnAppServer(workspace: string) {
    return spawn(this.options.command, ["app-server", "--listen", "stdio://"], {
      cwd: workspace,
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        RUST_LOG: process.env.RUST_LOG ?? "error"
      }
    });
  }
}
