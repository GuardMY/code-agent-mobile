import { createReadStream, createWriteStream, type Stats, type FSWatcher, watch } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createInterface } from "node:readline";

export type OutputCallback = (stream: "stdout" | "stderr", text: string) => void;

export interface ReplayOptions {
  filePath: string;
  onOutput: OutputCallback;
  /** If set, only replay events after this ISO timestamp */
  since?: string;
  /** If set, stop replay when a line with this uuid is reached */
  untilUuid?: string;
}

export interface WatchOptions {
  filePath: string;
  onOutput: OutputCallback;
}

/**
 * Replay relevant events from a Claude Code session JSONL file as output.
 *
 * Relevant event types: assistant, user, result, stream_event.
 * Control messages (queue-operation, control_request, system, etc.) are skipped.
 */
export async function replaySessionHistory(options: ReplayOptions): Promise<number> {
  const stream = createReadStream(options.filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let count = 0;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;

      // Stop at the given uuid boundary (for dedup with live output)
      if (options.untilUuid && event.uuid === options.untilUuid) {
        break;
      }

      // Filter by timestamp if requested
      if (options.since && typeof event.timestamp === "string" && event.timestamp <= options.since) {
        continue;
      }

      const text = formatEventAsOutput(event);
      if (text !== null) {
        options.onOutput("stdout", text);
        count++;
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return count;
}

/**
 * Start watching a session JSONL file for new lines and emit them as output.
 * Returns a stop function. Use this for real-time sync of externally-launched
 * Claude Code sessions that agent-mobile doesn't own.
 */
export function watchSessionFile(options: WatchOptions): () => void {
  let lastSize = 0;

  // Get initial size so we skip existing content
  stat(options.filePath)
    .then((st: Stats) => {
      lastSize = st.size;
    })
    .catch(() => {
      lastSize = 0;
    });

  const watcher: FSWatcher = watch(options.filePath, async (eventType) => {
    if (eventType !== "change") return;

    let currentStat: Stats;
    try {
      currentStat = await stat(options.filePath);
    } catch {
      return;
    }

    // File was truncated — reset offset
    if (currentStat.size < lastSize) {
      lastSize = 0;
    }

    if (currentStat.size <= lastSize) return;

    // Read the new portion
    const newBytes = currentStat.size - lastSize;
    const fd = await open(options.filePath, "r");
    try {
      const buf = Buffer.alloc(newBytes);
      const { bytesRead } = await fd.read(buf, 0, newBytes, lastSize);
      const newContent = buf.toString("utf-8", 0, bytesRead);

      for (const line of newContent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;
          const text = formatEventAsOutput(event);
          if (text !== null) {
            options.onOutput("stdout", text);
          }
        } catch {
          // skip
        }
      }
    } finally {
      await fd.close();
    }

    lastSize = currentStat.size;
  });

  return () => watcher.close();
}

// ---- internal formatters ----

function formatEventAsOutput(event: Record<string, unknown>): string | null {
  switch (event.type) {
    case "assistant":
      return formatAssistantEvent(event);
    case "user":
      return formatUserEvent(event);
    case "result":
      return formatResultEvent(event);
    case "stream_event":
      return formatStreamEvent(event);
    default:
      return null;
  }
}

function formatAssistantEvent(event: Record<string, unknown>): string | null {
  const message = event.message as Record<string, unknown> | undefined;
  if (!message || message.role !== "assistant") return null;

  const content = message.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "tool_use") {
      parts.push(`\n[Tool: ${block.name}]`);
      try {
        parts.push(JSON.stringify(block.input, null, 2));
      } catch {
        parts.push(String(block.input));
      }
      parts.push("");
    }
  }

  return parts.length > 0 ? parts.join("") : null;
}

function formatUserEvent(event: Record<string, unknown>): string | null {
  const message = event.message as Record<string, unknown> | undefined;
  if (!message || message.role !== "user") return null;

  const content = message.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "tool_result") {
      const prefix = block.is_error ? "[Tool Error]" : "[Tool Result]";
      parts.push(`\n${prefix}:\n`);
      try {
        const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
        const truncated = text.length > 2000 ? text.slice(0, 2000) + "\n... (truncated)" : text;
        parts.push(truncated);
      } catch {
        parts.push(String(block.content));
      }
      parts.push("");
    }
  }

  return parts.length > 0 ? parts.join("") : null;
}

function formatResultEvent(event: Record<string, unknown>): string | null {
  if (event.subtype === "success" && typeof event.result === "string") {
    try {
      const parsed = JSON.parse(event.result);
      if (typeof parsed === "string" && parsed.trim()) {
        return `\n${parsed}\n`;
      }
    } catch {
      // not double-encoded
    }
    return null;
  }

  if (event.subtype === "error") {
    const errors = event.errors as string[] | undefined;
    return `\n[Error: ${errors?.join("; ") ?? "Unknown error"}]\n`;
  }

  return null;
}

function formatStreamEvent(event: Record<string, unknown>): string | null {
  const inner = event.event as Record<string, unknown> | undefined;
  if (!inner) return null;

  if (
    inner.type === "content_block_delta" &&
    (inner.delta as Record<string, unknown>)?.type === "text_delta" &&
    typeof (inner.delta as Record<string, unknown>)?.text === "string"
  ) {
    return (inner.delta as Record<string, string>).text;
  }

  return null;
}
