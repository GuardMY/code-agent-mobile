import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildGatewayServer } from "./server.js";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("gateway relay", () => {
  it("relays messages between app and host peers with the same hostId", async () => {
    const { url } = await startGateway();
    const host = new WebSocket(`${url}/host?hostId=devbox&token=relay-token`);
    const app = new WebSocket(`${url}/app?hostId=devbox&token=relay-token`);
    await Promise.all([opened(host), opened(app)]);
    const received = onceMessage(host);

    app.send(JSON.stringify({ type: "agent.input", payload: { text: "hello" } }));

    expect(await received).toEqual({ type: "agent.input", payload: { text: "hello" } });
    host.close();
    app.close();
  });

  it("does not relay messages to a different hostId", async () => {
    const { url } = await startGateway();
    const host = new WebSocket(`${url}/host?hostId=devbox-a&token=relay-token`);
    const app = new WebSocket(`${url}/app?hostId=devbox-b&token=relay-token`);
    await Promise.all([opened(host), opened(app)]);
    let delivered = false;
    host.on("message", () => {
      delivered = true;
    });

    app.send(JSON.stringify({ type: "agent.input", payload: { text: "hello" } }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(delivered).toBe(false);
    host.close();
    app.close();
  });

  it("rejects peers with an invalid relay token", async () => {
    const { url } = await startGateway();
    const socket = new WebSocket(`${url}/app?hostId=devbox&token=wrong`);
    const close = await closed(socket);

    expect(close.code).toBe(1008);
  });
});

async function startGateway(): Promise<{ url: string }> {
  const app = buildGatewayServer({ relayToken: "relay-token" });
  await app.listen({ host: "127.0.0.1", port: 0 });
  servers.push(app);
  const address = app.server.address();
  if (typeof address !== "object" || !address) {
    throw new Error("No gateway address");
  }
  return { url: `ws://127.0.0.1:${address.port}` };
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", () => reject(new Error("socket error")));
  });
}

function closed(socket: WebSocket): Promise<{ code: number }> {
  return new Promise((resolve) => {
    socket.once("close", (code) => resolve({ code }));
  });
}

function onceMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}
