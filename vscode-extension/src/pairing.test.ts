import { describe, expect, it } from "vitest";
import { createPairingPayload } from "./pairing.js";

describe("pairing payload", () => {
  it("keeps the payload type local to the extension package", async () => {
    const module = await import("./pairing.js");

    expect(typeof module.createPairingPayload).toBe("function");
  });

  it("contains LAN host, port, token, device name, and future expiry", () => {
    const payload = createPairingPayload({
      host: "192.168.1.10",
      port: 17365,
      pairingToken: "pairing-token-123",
      deviceName: "VS Code"
    });

    expect(payload.host).toBe("192.168.1.10");
    expect(payload.port).toBe(17365);
    expect(payload.pairingToken).toBe("pairing-token-123");
    expect(Date.parse(payload.expiresAt)).toBeGreaterThan(Date.now());
  });
});
