import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { hostDashboardStatusSchema, type HostDashboardStatus } from "@agent-mobile/protocol";
import type { AgentMobileConfig } from "./config.js";
import { buildHostArgs } from "./config.js";

export type HostControllerStatus = "stopped" | "starting" | "running";

export function resolveHostCliPath(workspace: string): string {
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
    return { reachable: true, status: hostDashboardStatusSchema.parse(json) };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export class HostController {
  private child?: ChildProcess;
  private status: HostControllerStatus = "stopped";
  private startQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dependencies: {
      existsSync: typeof existsSync;
      spawn: typeof spawn;
    } = { existsSync, spawn }
  ) {}

  async start(input: {
    host: string;
    workspace: string;
    pairingToken: string;
    config: AgentMobileConfig;
    onOutput: (line: string) => void;
  }): Promise<void> {
    this.startQueue = this.startQueue.then(() => this.startNow(input), () => this.startNow(input));
    return this.startQueue;
  }

  private async startNow(input: {
    host: string;
    workspace: string;
    pairingToken: string;
    config: AgentMobileConfig;
    onOutput: (line: string) => void;
  }): Promise<void> {
    const previousChild = this.child;
    if (previousChild) {
      this.child = undefined;
      this.status = "stopped";
      const killed = previousChild.kill();
      if (killed) {
        await waitForExit(previousChild);
      }
    }
    const cliPath = resolveHostCliPath(input.workspace);
    if (!this.dependencies.existsSync(cliPath)) {
      throw new Error(`Agent host build not found at ${cliPath}. Run npm run build -w agent-host in this workspace first.`);
    }
    const args = [cliPath, ...buildHostArgs(input)];
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

function waitForExit(child: ChildProcess, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
