import { describe, expect, it, vi } from "vitest";
import { DeviceRegistry, type TrustedDeviceRecord } from "./deviceRegistry.js";

function createRecord(overrides: Partial<TrustedDeviceRecord> = {}): TrustedDeviceRecord {
  return {
    deviceId: "android-001",
    clientType: "android-app",
    pairedAt: "2026-07-06T10:00:00.000Z",
    deviceSecretHash: "hash_abc",
    ...overrides
  };
}

function createSecretStorage(initial: Record<string, string | undefined> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => values.get(key)),
    store: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    })
  };
}

describe("DeviceRegistry", () => {
  it("loads trusted devices from SecretStorage", async () => {
    const storage = createSecretStorage({
      "agentMobile.pairedDevices": JSON.stringify([createRecord()])
    });
    const registry = new DeviceRegistry(storage);

    await expect(registry.load()).resolves.toEqual([createRecord()]);
  });

  it("falls back to an empty list when stored JSON is malformed", async () => {
    const storage = createSecretStorage({
      "agentMobile.pairedDevices": "{not-json"
    });
    const registry = new DeviceRegistry(storage);

    await expect(registry.load()).resolves.toEqual([]);
  });

  it("falls back to an empty list when stored records do not match the trusted device schema", async () => {
    const storage = createSecretStorage({
      "agentMobile.pairedDevices": JSON.stringify([{ deviceId: "android-001" }])
    });
    const registry = new DeviceRegistry(storage);

    await expect(registry.load()).resolves.toEqual([]);
  });

  it("keeps valid remembered mobile records when some stored records are malformed", async () => {
    const storage = createSecretStorage({
      "agentMobile.pairedDevices": JSON.stringify([
        createRecord(),
        { deviceId: "broken-record" },
        { ...createRecord({ deviceId: "android-002" }), pairedAt: "not-a-datetime" }
      ])
    });
    const registry = new DeviceRegistry(storage);

    await expect(registry.load()).resolves.toEqual([createRecord()]);
  });

  it("drops persisted desktop-extension records during bootstrap load", async () => {
    const storage = createSecretStorage({
      "agentMobile.pairedDevices": JSON.stringify([
        createRecord({ deviceId: "android-001" }),
        createRecord({
          deviceId: "vscode-extension",
          clientType: "desktop-extension",
          deviceSecretHash: "hash_desktop"
        })
      ])
    });
    const registry = new DeviceRegistry(storage);

    await expect(registry.load()).resolves.toEqual([createRecord({ deviceId: "android-001" })]);
  });

  it("upserts a trusted device after first pair", async () => {
    const storage = createSecretStorage();
    const registry = new DeviceRegistry(storage);

    await registry.upsert(createRecord());

    await expect(registry.load()).resolves.toEqual([createRecord()]);
  });

  it("replaces an existing trusted device record with the latest version", async () => {
    const storage = createSecretStorage({
      "agentMobile.pairedDevices": JSON.stringify([createRecord({ lastSeenAt: "2026-07-06T11:00:00.000Z" })])
    });
    const registry = new DeviceRegistry(storage);

    await registry.upsert(createRecord({ lastSeenAt: "2026-07-06T12:00:00.000Z" }));

    await expect(registry.load()).resolves.toEqual([createRecord({ lastSeenAt: "2026-07-06T12:00:00.000Z" })]);
  });

  it("removes a trusted device record by device id", async () => {
    const storage = createSecretStorage({
      "agentMobile.pairedDevices": JSON.stringify([createRecord(), createRecord({ deviceId: "android-002" })])
    });
    const registry = new DeviceRegistry(storage);

    await registry.remove("android-001");

    await expect(registry.load()).resolves.toEqual([createRecord({ deviceId: "android-002" })]);
  });

  it("syncs trusted devices from the host dashboard by storing active devices and dropping revoked ones", async () => {
    const storage = createSecretStorage({
      "agentMobile.pairedDevices": JSON.stringify([createRecord(), createRecord({ deviceId: "android-stale" })])
    });
    const registry = new DeviceRegistry(storage);

    await registry.sync([
      createRecord({ deviceId: "android-001", lastSeenAt: "2026-07-06T12:00:00.000Z" }),
      createRecord({
        deviceId: "android-revoked",
        deviceSecretHash: "hash_revoked",
        revokedAt: "2026-07-06T13:00:00.000Z"
      })
    ]);

    await expect(registry.load()).resolves.toEqual([
      createRecord({ deviceId: "android-001", lastSeenAt: "2026-07-06T12:00:00.000Z" })
    ]);
  });

  it("does not persist the VS Code extension trusted-device record during dashboard sync", async () => {
    const storage = createSecretStorage();
    const registry = new DeviceRegistry(storage);

    await registry.sync([
      createRecord({ deviceId: "android-001" }),
      createRecord({
        deviceId: "vscode-extension",
        clientType: "desktop-extension",
        deviceSecretHash: "hash_desktop"
      })
    ]);

    await expect(registry.load()).resolves.toEqual([createRecord({ deviceId: "android-001" })]);
  });
});
