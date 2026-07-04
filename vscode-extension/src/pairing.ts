import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";

export interface PairingPayload {
  host: string;
  port: number;
  pairingToken: string;
  deviceName: string;
}

export function createPairingToken(): string {
  return `pair_${randomBytes(18).toString("hex")}`;
}

export function createPairingPayload(input: {
  host: string;
  port: number;
  pairingToken: string;
  deviceName: string;
}): PairingPayload {
  return {
    host: input.host,
    port: input.port,
    pairingToken: input.pairingToken,
    deviceName: input.deviceName
  };
}

export function firstLanAddress(): string | undefined {
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        return info.address;
      }
    }
  }
  return undefined;
}
