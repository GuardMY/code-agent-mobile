import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { CodexAdapter } from "./adapters/codexAdapter.js";
import { startRelayClient } from "./relayClient.js";
import { buildServer } from "./server.js";
import { SessionManager } from "./sessions/sessionManager.js";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const port = Number(readArg("--port") ?? process.env.AGENT_MOBILE_PORT ?? 17365);
  const host = readArg("--host") ?? process.env.AGENT_MOBILE_HOST ?? "127.0.0.1";
  const workspace = readArg("--workspace") ?? process.cwd();
  const codexCommand = readArg("--codex-command") ?? "codex";
  const eventCacheSize = Number(readArg("--event-cache-size") ?? 500);
  const pairingToken = readArg("--pairing-token") ?? `pair_${randomBytes(18).toString("hex")}`;
  const relayUrl = readArg("--relay-url") ?? process.env.AGENT_MOBILE_RELAY_URL;
  const relayHostId = readArg("--relay-host-id") ?? process.env.AGENT_MOBILE_RELAY_HOST_ID;
  const relayToken = readArg("--relay-token") ?? process.env.AGENT_MOBILE_RELAY_TOKEN;
  const advertisedHost = host === "0.0.0.0" ? firstLanAddress() ?? "127.0.0.1" : host;
  const manager = new SessionManager({
    adapter: new CodexAdapter({ command: codexCommand, args: [] }),
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
    stopHost: async () => {
      setTimeout(() => {
        void app.close().finally(() => process.exit(0));
      }, 0);
    }
  });
  if (relayUrl && relayHostId && relayToken) {
    startRelayClient({ relayUrl, hostId: relayHostId, relayToken, manager });
  }

  await app.listen({ host, port });

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
