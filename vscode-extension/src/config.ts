export interface AgentMobileConfig {
  port: number;
  codexCommand: string;
  eventCacheSize: number;
  relayUrl?: string;
  relayHostId?: string;
  relayToken?: string;
}

export interface RelayConfig {
  relayUrl: string;
  hostId: string;
  relayToken: string;
}

export interface ConfigReader {
  get<T>(key: string, fallback: T): T;
}

export function readAgentMobileConfig(reader: ConfigReader): AgentMobileConfig {
  const relayUrl = reader.get("relayUrl", "").trim();
  const relayHostId = reader.get("relayHostId", "").trim();
  const relayToken = reader.get("relayToken", "").trim();
  return {
    port: reader.get("port", 17365),
    codexCommand: reader.get("codexCommand", "codex"),
    eventCacheSize: reader.get("eventCacheSize", 500),
    relayUrl: relayUrl || undefined,
    relayHostId: relayHostId || undefined,
    relayToken: relayToken || undefined
  };
}

export function resolveRelayConfig(config: AgentMobileConfig): RelayConfig | undefined {
  if (!config.relayUrl && !config.relayHostId && !config.relayToken) {
    return undefined;
  }
  if (!config.relayUrl || !config.relayHostId || !config.relayToken) {
    throw new Error("agentMobile.relayUrl, relayHostId, and relayToken must be configured together");
  }
  const url = new URL(config.relayUrl);
  if (url.protocol !== "wss:") {
    throw new Error("agentMobile.relayUrl must use wss:// for public connections");
  }
  if (config.relayHostId.length < 8) {
    throw new Error("agentMobile.relayHostId must be at least 8 characters");
  }
  if (config.relayToken.length < 16) {
    throw new Error("agentMobile.relayToken must be at least 16 characters");
  }
  return {
    relayUrl: url.toString().replace(/\/$/, ""),
    hostId: config.relayHostId,
    relayToken: config.relayToken
  };
}

export function buildHostArgs(input: {
  host: string;
  workspace: string;
  pairingToken: string;
  config: AgentMobileConfig;
  relay?: RelayConfig;
}): string[] {
  const args = [
    "--host",
    input.host,
    "--port",
    String(input.config.port),
    "--workspace",
    input.workspace,
    "--pairing-token",
    input.pairingToken,
    "--codex-command",
    input.config.codexCommand,
    "--event-cache-size",
    String(input.config.eventCacheSize)
  ];
  if (input.relay) {
    args.push(
      "--relay-url",
      input.relay.relayUrl,
      "--relay-host-id",
      input.relay.hostId,
      "--relay-token",
      input.relay.relayToken
    );
  }
  return args;
}
