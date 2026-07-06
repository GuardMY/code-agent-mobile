import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { DiscoveredAgentSession } from "../sessions/sessionManager.js";

export interface DiscoverClaudeCodeSessionsOptions {
  workspace: string;
  /** Max lines to read per session file when extracting title (default: 50) */
  maxLineReadPerFile?: number;
}

/**
 * Discover Claude Code sessions by scanning the project directory
 * under ~/.claude/projects/<slug>/*.jsonl.
 */
export async function discoverClaudeCodeSessions(
  options: DiscoverClaudeCodeSessionsOptions,
): Promise<DiscoveredAgentSession[]> {
  const projectSlug = workspaceToProjectSlug(options.workspace);
  const projectDir = join(homedir(), ".claude", "projects", projectSlug);

  let entries: string[];
  try {
    entries = await readdir(projectDir);
  } catch {
    return [];
  }

  const maxLines = options.maxLineReadPerFile ?? 50;
  const sessions: DiscoveredAgentSession[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const sessionId = entry.replace(/\.jsonl$/, "");
    const filePath = join(projectDir, entry);

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      continue;
    }

    let title: string | undefined;
    try {
      title = await extractSessionTitle(filePath, maxLines);
    } catch {
      // ignore read errors for individual files
    }

    sessions.push({
      id: sessionId,
      workspace: options.workspace,
      title,
      updatedAt: fileStat.mtime.toISOString(),
    });
  }

  return sessions;
}

/**
 * Convert a workspace path to the Claude Code project slug used under
 * ~/.claude/projects/.  Replaces ':' and path separators with '-'.
 *
 *   e:\Code\code-agent-mobile  →  e--Code-code-agent-mobile
 *   /home/user/project         →  -home-user-project
 */
export function workspaceToProjectSlug(workspace: string): string {
  return workspace
    .replace(/:/g, "-")
    .replace(/[\\/]/g, "-");
}

/**
 * Read the first N lines of a session JSONL file and extract a title.
 *
 * Prefers the last `ai-title` event (Claude auto-generates a concise title).
 * Falls back to the first user message if no ai-title is present.
 * Returns undefined if neither is found.
 */
async function extractSessionTitle(
  filePath: string,
  maxLines: number,
): Promise<string | undefined> {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let aiTitle: string | undefined;
  let firstUserText: string | undefined;

  let lineCount = 0;
  for await (const line of rl) {
    lineCount++;
    if (lineCount > maxLines) break;

    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "ai-title" && typeof event.aiTitle === "string" && event.aiTitle.trim()) {
        aiTitle = event.aiTitle.trim();
      }
      if (!firstUserText && event.type === "user" && isUserMessage(event.message)) {
        const text = firstTextContent(event.message);
        if (text) {
          firstUserText = text.trim();
        }
      }
    } catch {
      // skip non-JSON lines
    }
  }

  const title = aiTitle ?? firstUserText;
  if (!title) return undefined;
  return title.length > 80 ? title.slice(0, 80) + "..." : title;
}

interface UserMessage {
  role: "user";
  content: Array<{ type: string; text?: string }>;
}

function isUserMessage(message: unknown): message is UserMessage {
  if (!message || typeof message !== "object") return false;
  const m = message as Record<string, unknown>;
  return m.role === "user" && Array.isArray(m.content);
}

function firstTextContent(message: UserMessage): string | undefined {
  for (const block of message.content) {
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      return block.text;
    }
  }
  return undefined;
}
