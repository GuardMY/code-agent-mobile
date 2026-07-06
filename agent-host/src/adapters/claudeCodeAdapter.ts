import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentAdapter, AgentProcess, DiscoveredAgentSession } from "../sessions/sessionManager.js";
import { createClaudeCodeProcess } from "../claude/claudeCodeClient.js";
import { discoverClaudeCodeSessions } from "../claude/sessionDiscovery.js";
import { replaySessionHistory } from "../claude/sessionTailer.js";

export interface ClaudeCodeAdapterOptions {
  command: string;
  args?: string[];
  permissionMode?: string;
  autoAllowTools?: boolean;
  /** Replay session history to onOutput before attaching (default: true) */
  replayHistory?: boolean;
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = "claude-code";
  readonly displayName = "Claude Code";

  constructor(private readonly options: ClaudeCodeAdapterOptions) {}

  async start(options: {
    sessionId: string;
    workspace: string;
    onOutput: (stream: "stdout" | "stderr", text: string) => void;
    onExit: (exitCode: number) => void;
  }): Promise<AgentProcess> {
    const child = this.spawnClaudeCode({
      workspace: options.workspace,
      sessionId: options.sessionId,
    });

    return createClaudeCodeProcess({
      child,
      options: {
        cwd: options.workspace,
        onOutput: options.onOutput,
        onExit: options.onExit,
        autoAllowTools: this.options.autoAllowTools ?? true,
      },
    });
  }

  async discoverSessions(options: { workspace: string }): Promise<DiscoveredAgentSession[]> {
    return discoverClaudeCodeSessions({ workspace: options.workspace });
  }

  async attachSession(options: {
    externalId: string;
    sessionId: string;
    workspace: string;
    onOutput: (stream: "stdout" | "stderr", text: string) => void;
    onExit: (exitCode: number) => void;
  }): Promise<AgentProcess> {
    const shouldReplay = this.options.replayHistory ?? true;

    if (shouldReplay) {
      // Replay existing session history before starting the new process,
      // so the mobile client sees full conversation context.
      const projectSlug = workspaceToProjectSlug(options.workspace);
      const filePath = join(homedir(), ".claude", "projects", projectSlug, `${options.externalId}.jsonl`);
      try {
        const replayed = await replaySessionHistory({
          filePath,
          onOutput: options.onOutput,
        });
        if (replayed > 0) {
          options.onOutput(
            "stdout",
            `\n--- 以上为历史会话内容 (${replayed} 条消息) ---\n\n`,
          );
        }
      } catch {
        // File doesn't exist or can't be read — proceed without replay
      }
    }

    const child = this.spawnClaudeCode({
      workspace: options.workspace,
      sessionId: options.sessionId,
      resumeSessionId: options.externalId,
    });

    return createClaudeCodeProcess({
      child,
      options: {
        cwd: options.workspace,
        onOutput: options.onOutput,
        onExit: options.onExit,
        autoAllowTools: this.options.autoAllowTools ?? true,
      },
    });
  }

  private spawnClaudeCode(params: {
    workspace: string;
    sessionId: string;
    resumeSessionId?: string;
  }): ChildProcessWithoutNullStreams {
    const command = this.options.command;
    const permissionMode = this.options.permissionMode ?? "acceptEdits";

    const args: string[] = [
      "--print",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      permissionMode,
    ];

    if (params.resumeSessionId) {
      args.push("--resume", params.resumeSessionId);
    } else {
      args.push("--name", params.sessionId);
    }

    if (this.options.args && this.options.args.length > 0) {
      args.push(...this.options.args);
    }

    return spawn(command, args, {
      cwd: params.workspace,
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
  }
}

function workspaceToProjectSlug(workspace: string): string {
  return workspace.replace(/:/g, "-").replace(/[\\/]/g, "-");
}
