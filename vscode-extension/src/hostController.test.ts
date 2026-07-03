import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { buildHostStatusUrl, fetchHostDashboardStatus, HostController, resolveHostCliPath } from "./hostController.js";

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
  it("resolves the agent host CLI from the opened workspace", () => {
    expect(resolveHostCliPath("E:/repo")).toBe("E:\\repo\\agent-host\\dist\\cli.js");
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
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              pairingPayload: {
                host: "127.0.0.1",
                port: 17365,
                pairingToken: "pairing-token-123",
                deviceName: "VS Code",
                expiresAt: new Date(Date.now() + 300_000).toISOString()
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
      spawn: () => child as never
    });

    await controller.start({
      host: "127.0.0.1",
      workspace: "E:/repo",
      pairingToken: "pairing-token-123",
      config: { port: 17365, codexCommand: "codex", eventCacheSize: 500 },
      onOutput: () => undefined
    });

    expect(controller.getStatus()).toBe("starting");

    child.stdout.emit("data", Buffer.from('{"type":"agent-mobile.ready"}\n'));

    expect(controller.getStatus()).toBe("running");
  });

  it("waits for the previous host to exit before spawning a replacement", async () => {
    const oldChild = new FakeChild();
    const newChild = new FakeChild();
    const children = [oldChild, newChild];
    const controller = new HostController({
      existsSync: () => true,
      spawn: () => children.shift() as never
    });
    const input = {
      host: "127.0.0.1",
      workspace: "E:/repo",
      pairingToken: "pairing-token-123",
      config: { port: 17365, codexCommand: "codex", eventCacheSize: 500 },
      onOutput: () => undefined
    };

    await controller.start(input);
    const restart = controller.start({ ...input, pairingToken: "pairing-token-456" });
    await Promise.resolve();

    expect(oldChild.killed).toBe(true);
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
      }
    });
    const input = {
      host: "127.0.0.1",
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
      spawn: () => children.shift() as never
    });
    const input = {
      host: "127.0.0.1",
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
});
