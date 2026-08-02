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
    const otherHost = new WebSocket(`${url}/host?hostId=devbox-b&token=relay-token`);
    const app = new WebSocket(`${url}/app?hostId=devbox-b&token=relay-token`);
    await Promise.all([opened(host), opened(otherHost), opened(app)]);
    let delivered = false;
    host.on("message", () => {
      delivered = true;
    });
    const receivedByOtherHost = onceMessage(otherHost);

    app.send(JSON.stringify({ type: "agent.input", payload: { text: "hello" } }));

    expect(await receivedByOtherHost).toEqual({ type: "agent.input", payload: { text: "hello" } });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(delivered).toBe(false);
    host.close();
    otherHost.close();
    app.close();
  });

  it("rejects peers with an invalid relay token", async () => {
    const { url } = await startGateway();
    const host = new WebSocket(`${url}/host?hostId=devbox&token=relay-token`);
    await opened(host);
    const socket = new WebSocket(`${url}/app?hostId=devbox&token=wrong`);
    const close = await closed(socket);

    expect(close.code).toBe(1008);
    host.close();
  });

  it("routes relay responses only to the app that started the request", async () => {
    const { url } = await startGateway();
    const host = new WebSocket(`${url}/host?hostId=devbox&token=relay-token`);
    const sourceApp = new WebSocket(`${url}/app?hostId=devbox&token=relay-token`);
    const otherApp = new WebSocket(`${url}/app?hostId=devbox&token=relay-token`);
    await Promise.all([opened(host), opened(sourceApp), opened(otherApp)]);
    const request = relayRequest("request-1");
    const response = relayResponse("request-1");
    const receivedByHost = onceMessage(host);
    const receivedBySource = onceMessage(sourceApp);
    let deliveredToOtherApp = false;
    otherApp.on("message", () => {
      deliveredToOtherApp = true;
    });

    sourceApp.send(JSON.stringify(request));
    expect(await receivedByHost).toEqual(request);

    host.send(JSON.stringify(response));

    expect(await receivedBySource).toEqual(response);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(deliveredToOtherApp).toBe(false);
    host.close();
    sourceApp.close();
    otherApp.close();
  });

  it("broadcasts normal host events to all apps", async () => {
    const { url } = await startGateway();
    const host = new WebSocket(`${url}/host?hostId=devbox&token=relay-token`);
    const appA = new WebSocket(`${url}/app?hostId=devbox&token=relay-token`);
    const appB = new WebSocket(`${url}/app?hostId=devbox&token=relay-token`);
    await Promise.all([opened(host), opened(appA), opened(appB)]);
    const event = { type: "agent.output", payload: { text: "shared output" } };
    const receivedByAppA = onceMessage(appA);
    const receivedByAppB = onceMessage(appB);

    host.send(JSON.stringify(event));

    await expect(Promise.all([receivedByAppA, receivedByAppB])).resolves.toEqual([event, event]);
    host.close();
    appA.close();
    appB.close();
  });

  it("binds the first host token to a dynamic relay channel", async () => {
    const { url } = await startGateway({});
    const host = new WebSocket(`${url}/host?hostId=devbox&token=channel-token`);
    await opened(host);
    const app = new WebSocket(`${url}/app?hostId=devbox&token=channel-token`);
    await opened(app);
    const received = onceMessage(host);

    app.send(JSON.stringify({ type: "agent.input", payload: { text: "remote hello" } }));

    expect(await received).toEqual({ type: "agent.input", payload: { text: "remote hello" } });
    host.close();
    app.close();
  });

  it("does not let an app create a dynamic relay channel", async () => {
    const { url } = await startGateway({});
    const app = new WebSocket(`${url}/app?hostId=unregistered-host&token=channel-token`);

    expect((await closed(app)).code).toBe(1008);
  });

  it("requires a nonempty token when a host creates a dynamic relay channel", async () => {
    const { url } = await startGateway({});
    const host = new WebSocket(`${url}/host?hostId=devbox&token=`);

    expect((await closed(host)).code).toBe(1008);
  });

  it("requires dynamic app and reconnecting host tokens to match the channel token", async () => {
    const { url } = await startGateway({});
    const firstHost = new WebSocket(`${url}/host?hostId=devbox&token=channel-token`);
    await opened(firstHost);
    const mismatchedApp = new WebSocket(`${url}/app?hostId=devbox&token=wrong-token`);
    const mismatchedHost = new WebSocket(`${url}/host?hostId=devbox&token=wrong-token`);
    const mismatchedAppClose = closed(mismatchedApp);
    const mismatchedHostClose = closed(mismatchedHost);

    expect((await mismatchedAppClose).code).toBe(1008);
    expect((await mismatchedHostClose).code).toBe(1008);

    const firstHostClose = closed(firstHost);
    firstHost.close();
    await firstHostClose;

    const reconnectedHost = new WebSocket(`${url}/host?hostId=devbox&token=channel-token`);
    await opened(reconnectedHost);
    reconnectedHost.close();
  });

  it("keeps dynamic channels isolated by hostId", async () => {
    const { url } = await startGateway({});
    const hostA = new WebSocket(`${url}/host?hostId=devbox-a&token=token-a`);
    const hostB = new WebSocket(`${url}/host?hostId=devbox-b&token=token-b`);
    const appA = new WebSocket(`${url}/app?hostId=devbox-a&token=token-a`);
    await Promise.all([opened(hostA), opened(hostB), opened(appA)]);
    let deliveredToHostB = false;
    hostB.on("message", () => {
      deliveredToHostB = true;
    });
    const receivedByHostA = onceMessage(hostA);

    appA.send(JSON.stringify({ type: "agent.input", payload: { text: "only a" } }));

    expect(await receivedByHostA).toEqual({ type: "agent.input", payload: { text: "only a" } });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(deliveredToHostB).toBe(false);
    hostA.close();
    hostB.close();
    appA.close();
  });
});

async function startGateway(options: Parameters<typeof buildGatewayServer>[0] = { relayToken: "relay-token" }): Promise<{ url: string }> {
  const app = buildGatewayServer(options);
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

function relayRequest(requestId: string): object {
  return {
    id: `request-${requestId}`,
    type: "relay.request",
    deviceId: "android-a",
    timestamp: "2026-08-01T00:00:00.000Z",
    seq: 0,
    payload: {
      requestId,
      method: "GET",
      path: "/status"
    }
  };
}

function relayResponse(requestId: string): object {
  return {
    id: `response-${requestId}`,
    type: "relay.response",
    deviceId: "agent-host",
    timestamp: "2026-08-01T00:00:00.000Z",
    seq: 0,
    payload: {
      requestId,
      status: 200,
      body: { ok: true }
    }
  };
}
