import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  buildHostStatusUrl,
  fetchHostDashboardStatus,
  HostController,
  resolveBundledHostCliPath,
  resolveWorkspaceHostCliPath
} from "./hostController.js";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

describe("host controller", () => {
  it("resolves the bundled agent host CLI from the extension install directory", () => {
    expect(resolveBundledHostCliPath("E:/extensions/agent-mobile-control")).toBe(
      "E:\\extensions\\agent-mobile-control\\host-dist\\agent-host\\cli.cjs"
    );
  });

  it("resolves the workspace agent host CLI fallback from the opened workspace", () => {
    expect(resolveWorkspaceHostCliPath("E:/repo")).toBe("E:\\repo\\agent-host\\dist\\cli.js");
  });

  it("builds a local status URL from host and port", () => {
    expect(buildHostStatusUrl("127.0.0.1", 17365)).toBe("http://127.0.0.1:17365/status");
  });

  it("returns unreachable status when fetching host dashboard fails", async () => {
    const result = await fetchHostDashboardStatus({
      host: "127.0.0.1",
      port: 17365,
      fetchImpl: async () => {
        throw new Error("offline");
      }
    });

    expect(result).toMatchObject({ reachable: false, error: "offline" });
  });

  it("passes the pairing token as a local dashboard credential", async () => {
    let headers: HeadersInit | undefined;

    await fetchHostDashboardStatus({
      host: "127.0.0.1",
      port: 17365,
      pairingToken: "pairing-token-123",
      fetchImpl: async (_url, init) => {
        headers = init?.headers;
        return new Response(
          JSON.stringify({
            server: {
              running: true,
              lanEnabled: false,
              host: "127.0.0.1",
              port: 17365,
              deviceName: "VS Code",
              version: "0.1.0"
            },
            pairing: {
              enabled: true,
              pairingPayload: {
                host: "127.0.0.1",
                port: 17365,
                pairingToken: "pairing-token-123",
                deviceName: "VS Code"
              }
            },
            devices: [],
            agents: [],
            sessions: []
          }),
          { status: 200 }
        );
      }
    });

    expect(headers).toMatchObject({ "x-agent-mobile-pairing-token": "pairing-token-123" });
  });

  it("stays starting until the spawned host reports ready", async () => {
    const child = new FakeChild();
    const controller = new HostController({
      existsSync: () => true,
      spawn: () => child as never,
      fetchHostDashboardStatus: async () => ({ reachable: false, error: "offline" }),
      requestHostStop: async () => undefined
    });

    await controller.start({
      host: "127.0.0.1",
      extensionPath: "E:/extensions/agent-mobile-control",
      workspace: "E:/repo",
      pairingToken: "pairing-token-123",
      config: { port: 17365, codexCommand: "codex", eventCacheSize: 500 },
      onOutput: () => undefined
    });

    expect(controller.getStatus()).toBe("starting");

    child.stdout.emit("data", Buffer.from('{"type":"agent-mobile.ready"}\n'));

    expect(controller.getStatus()).toBe("running");
  });

  it("reuses an existing local host instead of spawning a new process", async () => {
    const controller = new HostController({
      existsSync: () => true,
      spawn: () => {
        throw new Error("spawn should not be called");
      },
      fetchHostDashboardStatus: async () => ({
        reachable: true,
        status: {
          server: {
            running: true,
            lanEnabled: true,
            host: "192.168.1.10",
            port: 17365,
            deviceName: "VS Code",
            version: "0.1.0"
          },
          pairing: {
            enabled: true,
            pairingPayload: {
              host: "192.168.1.10",
              port: 17365,
              pairingToken: "pairing-token-123",
              deviceName: "VS Code"
            }
          },
          devices: [],
          agents: [],
          sessions: []
        }
      }),
      requestHostStop: async () => undefined
    });

    const result = await controller.start({
      host: "0.0.0.0",
      extensionPath: "E:/extensions/agent-mobile-control",
      workspace: "E:/repo",
      pairingToken: "pairing-token-next",
      config: { port: 17365, codexCommand: "codex", eventCacheSize: 500 },
      onOutput: () => undefined
    });

    expect(result).toMatchObject({
      mode: "reused",
      dashboard: {
        pairing: {
          pairingPayload: {
            pairingToken: "pairing-token-123"
          }
        }
      }
    });
    expect(controller.getStatus()).toBe("running");
  });

  it("waits for an existing host to stop before spawning when LAN mode changes", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child as never);
    let stopRequested = false;
    const fetchHostDashboardStatus = vi.fn(async () => {
      if (!stopRequested) {
        return {
          reachable: true as const,
          status: {
            server: {
              running: true as const,
              lanEnabled: false,
              host: "127.0.0.1",
              port: 17365,
              deviceName: "VS Code",
              version: "0.1.0"
            },
            pairing: {
              enabled: true,
              pairingPayload: {
                host: "127.0.0.1",
                port: 17365,
                pairingToken: "pairing-token-old",
                deviceName: "VS Code"
              }
            },
            devices: [],
            agents: [],
            sessions: []
          }
        };
      }
      return { reachable: false as const, error: "offline" };
    });
    const controller = new HostController({
      existsSync: () => true,
      spawn,
      fetchHostDashboardStatus,
      requestHostStop: vi.fn(async () => {
        stopRequested = true;
      })
    });

    await controller.start({
      host: "0.0.0.0",
      extensionPath: "E:/extensions/agent-mobile-control",
      workspace: "E:/repo",
      pairingToken: "pairing-token-next",
      config: { port: 17365, codexCommand: "codex", eventCacheSize: 500 },
      onOutput: () => undefined
    });

    expect(fetchHostDashboardStatus).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("waits for the previous host to exit before spawning a replacement", async () => {
    const oldChild = new FakeChild();
    const newChild = new FakeChild();
    const children = [oldChild, newChild];
    const controller = new HostController({
      existsSync: () => true,
      spawn: () => children.shift() as never,
      fetchHostDashboardStatus: async () => ({ reachable: false, error: "offline" }),
      requestHostStop: async () => undefined
    });
    const input = {
      host: "127.0.0.1",
      extensionPath: "E:/extensions/agent-mobile-control",
      workspace: "E:/repo",
      pairingToken: "pairing-token-123",
      config: { port: 17365, codexCommand: "codex", eventCacheSize: 500 },
      onOutput: () => undefined
    };

    await controller.start(input);
    const restart = controller.start({ ...input, pairingToken: "pairing-token-456" });
    await vi.waitFor(() => expect(oldChild.killed).toBe(true));

    expect(children).toHaveLength(1);

    oldChild.emit("exit", 0);
    await restart;

    expect(children).toHaveLength(0);
  });

  it("applies the latest requested host when starts overlap", async () => {
    const oldChild = new FakeChild();
    const lanChild = new FakeChild();
    const localChild = new FakeChild();
    const children = [oldChild, lanChild, localChild];
    const hosts: string[] = [];
    const controller = new HostController({
      existsSync: () => true,
      spawn: (_command, args) => {
        const hostFlag = (args as string[]).indexOf("--host");
        hosts.push((args as string[])[hostFlag + 1]);
        return children.shift() as never;
      },
      fetchHostDashboardStatus: async () => ({ reachable: false, error: "offline" }),
      requestHostStop: async () => undefined
    });
    const input = {
      host: "127.0.0.1",
      extensionPath: "E:/extensions/agent-mobile-control",
      workspace: "E:/repo",
      pairingToken: "pairing-token-123",
      config: { port: 17365, codexCommand: "codex", eventCacheSize: 500 },
      onOutput: () => undefined
    };

    await controller.start({ ...input, host: "0.0.0.0" });
    const enable = controller.start({ ...input, host: "0.0.0.0", pairingToken: "pairing-token-456" });
    const disable = controller.start({ ...input, host: "127.0.0.1", pairingToken: "pairing-token-789" });

    expect(hosts).toEqual(["0.0.0.0"]);

    oldChild.emit("exit", 0);
    await enable;

    expect(hosts).toEqual(["0.0.0.0", "0.0.0.0"]);

    lanChild.emit("exit", 0);
    await disable;

    expect(hosts).toEqual(["0.0.0.0", "0.0.0.0", "127.0.0.1"]);
    expect(lanChild.killed).toBe(true);
    expect(localChild.killed).toBe(false);
  });

  it("does not let an old host exit clear the current host state", async () => {
    const oldChild = new FakeChild();
    const newChild = new FakeChild();
    const children = [oldChild, newChild];
    const controller = new HostController({
      existsSync: () => true,
      spawn: () => children.shift() as never,
      fetchHostDashboardStatus: async () => ({ reachable: false, error: "offline" }),
      requestHostStop: async () => undefined
    });
    const input = {
      host: "127.0.0.1",
      extensionPath: "E:/extensions/agent-mobile-control",
      workspace: "E:/repo",
      pairingToken: "pairing-token-123",
      config: { port: 17365, codexCommand: "codex", eventCacheSize: 500 },
      onOutput: () => undefined
    };

    await controller.start(input);
    const restart = controller.start({ ...input, pairingToken: "pairing-token-456" });
    oldChild.emit("exit", 0);
    await restart;
    newChild.stdout.emit("data", Buffer.from('{"type":"agent-mobile.ready"}\n'));

    expect(controller.getStatus()).toBe("running");
    expect(controller.isRunning()).toBe(true);
  });

  it("prefers the bundled host CLI over the workspace fallback", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child as never);
    const controller = new HostController({
      existsSync: (path) =>
        path === resolveBundledHostCliPath("E:/extensions/agent-mobile-control") ||
        path === resolveWorkspaceHostCliPath("E:/repo"),
      spawn,
      fetchHostDashboardStatus: async () => ({ reachable: false, error: "offline" }),
      requestHostStop: async () => undefined
    });

    await controller.start({
      host: "127.0.0.1",
      extensionPath: "E:/extensions/agent-mobile-control",
      workspace: "E:/repo",
      pairingToken: "pairing-token-123",
      config: { port: 17365, codexCommand: "codex", eventCacheSize: 500 },
      onOutput: () => undefined
    });

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([resolveBundledHostCliPath("E:/extensions/agent-mobile-control")]),
      expect.any(Object)
    );
  });
});
