import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { hostDashboardStatusSchema, type HostDashboardStatus } from "@agent-mobile/protocol";
import type { AgentMobileConfig, RelayConfig } from "./config.js";
import { buildHostArgs } from "./config.js";
import type { TrustedDeviceRecord } from "./deviceRegistry.js";

export type HostControllerStatus = "stopped" | "starting" | "running";
export type HostStartResult =
  | { mode: "spawned" }
  | { mode: "reused"; dashboard: HostDashboardStatus };

export function resolveBundledHostCliPath(extensionPath: string): string {
  return resolve(extensionPath, "host-dist", "agent-host", "cli.cjs");
}

export function resolveWorkspaceHostCliPath(workspace: string): string {
  return resolve(workspace, "agent-host/dist/cli.js");
}

export type DashboardFetchResult =
  | { reachable: true; status: HostDashboardStatus }
  | { reachable: false; error: string };

export function buildHostStatusUrl(host: string, port: number): string {
  return `http://${host}:${port}/status`;
}

export async function fetchHostDashboardStatus(input: {
  host: string;
  port: number;
  pairingToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<DashboardFetchResult> {
  try {
    const fetchImpl = input.fetchImpl ?? fetch;
    const response = await fetchImpl(buildHostStatusUrl(input.host, input.port), {
      headers: input.pairingToken ? { "x-agent-mobile-pairing-token": input.pairingToken } : undefined
    });
    if (!response.ok) {
      return { reachable: false, error: `Host status returned ${response.status}` };
    }
    const json = await response.json();
    const payload =
      json && typeof json === "object"
        ? { ...json, trustedDevices: (json as { trustedDevices?: unknown }).trustedDevices ?? [] }
        : json;
    return { reachable: true, status: hostDashboardStatusSchema.parse(payload) };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function requestHostStop(input: { port: number; pairingToken: string; fetchImpl?: typeof fetch }): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`http://127.0.0.1:${input.port}/host/control`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-mobile-pairing-token": input.pairingToken
    },
    body: JSON.stringify({ command: "stop" })
  });
  if (!response.ok) {
    throw new Error(`Host stop returned ${response.status}`);
  }
}

async function waitForHostShutdown(input: {
  port: number;
  pairingToken: string;
  fetchHostDashboardStatus: typeof fetchHostDashboardStatus;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<void> {
  const timeoutAt = Date.now() + (input.timeoutMs ?? 2_000);
  while (Date.now() < timeoutAt) {
    const status = await input.fetchHostDashboardStatus({
      host: "127.0.0.1",
      port: input.port,
      pairingToken: input.pairingToken
    });
    if (!status.reachable) {
      return;
    }
    await delay(input.intervalMs ?? 100);
  }
  throw new Error(`Existing host on port ${input.port} did not stop in time`);
}

export class HostController {
  private child?: ChildProcess;
  private status: HostControllerStatus = "stopped";
  private startQueue: Promise<HostStartResult | undefined> = Promise.resolve(undefined);

  constructor(
    private readonly dependencies: {
      existsSync: typeof existsSync;
      spawn: typeof spawn;
      fetchHostDashboardStatus: typeof fetchHostDashboardStatus;
      requestHostStop: typeof requestHostStop;
    } = { existsSync, spawn, fetchHostDashboardStatus, requestHostStop }
  ) {}

  async start(input: {
    host: string;
    extensionPath: string;
    workspace: string;
    pairingToken: string;
    config: AgentMobileConfig;
    relay?: RelayConfig;
    trustedDevices?: TrustedDeviceRecord[];
    onOutput: (line: string) => void;
  }): Promise<HostStartResult> {
    this.startQueue = this.startQueue.then(() => this.startNow(input), () => this.startNow(input));
    return this.startQueue.then((result) => {
      if (!result) {
        throw new Error("Host start did not produce a result");
      }
      return result;
    });
  }

  private async startNow(input: {
    host: string;
    extensionPath: string;
    workspace: string;
    pairingToken: string;
    config: AgentMobileConfig;
    relay?: RelayConfig;
    trustedDevices?: TrustedDeviceRecord[];
    onOutput: (line: string) => void;
  }): Promise<HostStartResult> {
    const existing = await this.dependencies.fetchHostDashboardStatus({
      host: "127.0.0.1",
      port: input.config.port
    });
    if (existing.reachable) {
      const wantsLan = input.host === "0.0.0.0";
      if (existing.status.server.lanEnabled !== wantsLan || !matchesRelay(existing.status, input.relay)) {
        await this.dependencies.requestHostStop({
          port: input.config.port,
          pairingToken: existing.status.pairing.pairingPayload.pairingToken
        });
        await waitForHostShutdown({
          port: input.config.port,
          pairingToken: existing.status.pairing.pairingPayload.pairingToken,
          fetchHostDashboardStatus: this.dependencies.fetchHostDashboardStatus
        });
      } else {
      this.status = "running";
      return { mode: "reused", dashboard: existing.status };
      }
    }
    const previousChild = this.child;
    if (previousChild) {
      this.child = undefined;
      this.status = "stopped";
      const killed = previousChild.kill();
      if (killed) {
        await waitForExit(previousChild);
      }
    }
    const bundledCliPath = resolveBundledHostCliPath(input.extensionPath);
    const workspaceCliPath = resolveWorkspaceHostCliPath(input.workspace);
    const cliPath = this.dependencies.existsSync(bundledCliPath) ? bundledCliPath : workspaceCliPath;
    if (!this.dependencies.existsSync(cliPath)) {
      throw new Error(
        `Agent host build not found at ${bundledCliPath} or ${workspaceCliPath}. Package the extension with the bundled host or run npm run build -w agent-host in this workspace first.`
      );
    }
    const args = [cliPath, ...buildHostArgs(input)];
    if (input.trustedDevices && input.trustedDevices.length > 0) {
      args.push("--trusted-devices", JSON.stringify(input.trustedDevices));
    }
    const child = this.dependencies.spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    this.child = child;
    this.status = "starting";
    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      input.onOutput(text);
      if (text.includes('"type":"agent-mobile.ready"')) {
        this.status = "running";
      }
    });
    child.stderr?.on("data", (chunk) => input.onOutput(String(chunk)));
    child.on("exit", () => {
      if (this.child === child) {
        this.child = undefined;
        this.status = "stopped";
      }
    });
    return { mode: "spawned" };
  }

  stop(): void {
    this.child?.kill();
    this.child = undefined;
    this.status = "stopped";
  }

  isRunning(): boolean {
    return this.status === "running";
  }

  getStatus(): HostControllerStatus {
    return this.status;
  }
}

function matchesRelay(status: HostDashboardStatus, relay: RelayConfig | undefined): boolean {
  const pairing = status.pairing.pairingPayload;
  if (!relay) {
    return !pairing.relayUrl && !pairing.hostId && !pairing.relayToken;
  }
  return (
    pairing.relayUrl === relay.relayUrl &&
    pairing.hostId === relay.hostId &&
    pairing.relayToken === relay.relayToken
  );
}

function waitForExit(child: ChildProcess, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
