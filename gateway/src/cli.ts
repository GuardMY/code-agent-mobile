import { buildGatewayServer } from "./server.js";

const host = readArg("--host") ?? process.env.AGENT_MOBILE_GATEWAY_HOST ?? "127.0.0.1";
const port = Number(readArg("--port") ?? process.env.AGENT_MOBILE_GATEWAY_PORT ?? 17366);
const relayToken = readArg("--relay-token") ?? process.env.AGENT_MOBILE_RELAY_TOKEN ?? "dev-relay-token";

const app = buildGatewayServer({ relayToken });
await app.listen({ host, port });

console.log(
  JSON.stringify({
    type: "agent-mobile.gateway.ready",
    host,
    port
  })
);

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
