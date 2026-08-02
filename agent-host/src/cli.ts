import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { z } from "zod";
import { trustedDeviceRecordSchema, type TrustedDeviceRecord } from "@agent-mobile/protocol";
import { CodexAdapter } from "./adapters/codexAdapter.js";
import { ClaudeCodeAdapter } from "./adapters/claudeCodeAdapter.js";
import { startRelayClient } from "./relayClient.js";
import { buildServer } from "./server.js";
import { SessionManager, type AgentAdapter } from "./sessions/sessionManager.js";

const trustedDeviceRecordListSchema = z.array(trustedDeviceRecordSchema);

if (isDirectExecution(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const port = Number(readArg("--port") ?? process.env.AGENT_MOBILE_PORT ?? 17365);
  const host = readArg("--host") ?? process.env.AGENT_MOBILE_HOST ?? "127.0.0.1";
  const workspace = readArg("--workspace") ?? process.cwd();
  const codexCommand = readArg("--codex-command") ?? "codex";
  const claudeCodeCommand = readArg("--claude-code-command") ?? "claude";
  const enableClaudeCode = readArg("--enable-claude-code") ?? "true";
  const eventCacheSize = Number(readArg("--event-cache-size") ?? 500);
  const pairingToken = readArg("--pairing-token") ?? `pair_${randomBytes(18).toString("hex")}`;
  const relayUrl = readArg("--relay-url") ?? process.env.AGENT_MOBILE_RELAY_URL;
  const relayHostId = readArg("--relay-host-id") ?? process.env.AGENT_MOBILE_RELAY_HOST_ID;
  const relayToken = readArg("--relay-token") ?? process.env.AGENT_MOBILE_RELAY_TOKEN;
  const relay = resolveRelayOptions({ relayUrl, relayHostId, relayToken });
  const trustedDevices = parseTrustedDevicesArgument(readArg("--trusted-devices"));
  const advertisedHost = host === "0.0.0.0" ? firstLanAddress() ?? "127.0.0.1" : host;

  const adapters: AgentAdapter[] = [new CodexAdapter({ command: codexCommand, args: [] })];
  if (enableClaudeCode !== "false" && enableClaudeCode !== "0") {
    adapters.push(new ClaudeCodeAdapter({ command: claudeCodeCommand }));
  }

  const manager = new SessionManager({
    adapters,
    workspace,
    eventCacheSize
  });

  const app = buildServer({
    manager,
    version: "0.1.0",
    lanEnabled: host === "0.0.0.0",
    pairingToken,
    deviceName: "VS Code",
    advertisedHost,
    port,
    ...(relay ?? {}),
    trustedDevices,
    stopHost: async () => {
      setTimeout(() => {
        void app.close().finally(() => process.exit(0));
      }, 0);
    }
  });
  await app.listen({ host, port });

  if (relay) {
    startRelayClient({
      ...relay,
      manager,
      localBaseUrl: `http://127.0.0.1:${port}`
    });
  }

  console.log(
    JSON.stringify({
      type: "agent-mobile.ready",
      host: advertisedHost,
      port,
      pairingToken
    })
  );
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function parseTrustedDevicesArgument(value: string | undefined): TrustedDeviceRecord[] {
  if (!value) {
    return [];
  }
  return trustedDeviceRecordListSchema.parse(JSON.parse(value));
}

export function resolveRelayOptions(input: {
  relayUrl?: string;
  relayHostId?: string;
  relayToken?: string;
}): { relayUrl: string; hostId: string; relayToken: string } | undefined {
  const relayUrl = input.relayUrl?.trim();
  const hostId = input.relayHostId?.trim();
  const relayToken = input.relayToken?.trim();
  if (!relayUrl && !hostId && !relayToken) {
    return undefined;
  }
  if (!relayUrl || !hostId || !relayToken) {
    throw new Error("--relay-url, --relay-host-id, and --relay-token must be configured together");
  }

  const url = new URL(relayUrl);
  if (url.protocol !== "wss:") {
    throw new Error("--relay-url must use wss:// for public connections");
  }
  if (hostId.length < 8) {
    throw new Error("--relay-host-id must be at least 8 characters");
  }
  if (relayToken.length < 16) {
    throw new Error("--relay-token must be at least 16 characters");
  }
  return {
    relayUrl: url.toString().replace(/\/$/, ""),
    hostId,
    relayToken
  };
}

function firstLanAddress(): string | undefined {
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        return info.address;
      }
    }
  }
  return undefined;
}

function isDirectExecution(moduleUrl: string | undefined, entryArg: string | undefined): boolean {
  // When bundled as CJS (e.g. by esbuild), import.meta.url is undefined.
  // In that case the bundle is always executed directly, never imported.
  if (!moduleUrl) return true;
  return Boolean(entryArg && fileURLToPath(moduleUrl) === entryArg);
}
