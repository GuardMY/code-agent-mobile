export interface AgentMobileConfig {
  port: number;
  codexCommand: string;
  eventCacheSize: number;
}

export interface ConfigReader {
  get<T>(key: string, fallback: T): T;
}

export function readAgentMobileConfig(reader: ConfigReader): AgentMobileConfig {
  return {
    port: reader.get("port", 17365),
    codexCommand: reader.get("codexCommand", "codex"),
    eventCacheSize: reader.get("eventCacheSize", 500)
  };
}

export function buildHostArgs(input: {
  host: string;
  workspace: string;
  pairingToken: string;
  config: AgentMobileConfig;
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
  return args;
}
