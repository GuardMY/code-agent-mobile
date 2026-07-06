import type * as vscode from "vscode";
import { z } from "zod";
import type { TrustedDeviceRecord } from "@agent-mobile/protocol";

export type { TrustedDeviceRecord } from "@agent-mobile/protocol";

const STORAGE_KEY = "agentMobile.pairedDevices";
const trustedDeviceRecordSchema: z.ZodType<TrustedDeviceRecord> = z.object({
  deviceId: z.string().min(1),
  clientType: z.enum(["android-app", "ios-app", "wechat-mini-program", "desktop-extension", "unknown"]),
  displayName: z.string().min(1).optional(),
  pairedAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(),
  deviceSecretHash: z.string().min(1),
  lastSeenAt: z.string().datetime().optional()
});
const trustedDeviceRecordListSchema = z.array(trustedDeviceRecordSchema);
const bootstrapClientTypes = new Set<TrustedDeviceRecord["clientType"]>(["android-app", "ios-app", "wechat-mini-program"]);

type SecretStorageLike = Pick<vscode.SecretStorage, "get" | "store">;

export class DeviceRegistry {
  constructor(private readonly storage: SecretStorageLike) {}

  async load(): Promise<TrustedDeviceRecord[]> {
    const raw = await this.storage.get(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.flatMap((record) => {
        const trustedRecord = trustedDeviceRecordSchema.safeParse(record);
        if (!trustedRecord.success || !bootstrapClientTypes.has(trustedRecord.data.clientType)) {
          return [];
        }
        return [trustedRecord.data];
      });
    } catch {
      return [];
    }
  }

  async upsert(record: TrustedDeviceRecord): Promise<void> {
    const records = await this.load();
    const next = records.some((item) => item.deviceId === record.deviceId)
      ? records.map((item) => (item.deviceId === record.deviceId ? record : item))
      : [...records, record];
    await this.save(next);
  }

  async remove(deviceId: string): Promise<void> {
    const records = await this.load();
    await this.save(records.filter((item) => item.deviceId !== deviceId));
  }

  async sync(records: TrustedDeviceRecord[]): Promise<void> {
    const next = Array.from(
      records.reduce((active, record) => {
        if (record.revokedAt || !bootstrapClientTypes.has(record.clientType)) {
          active.delete(record.deviceId);
          return active;
        }
        active.set(record.deviceId, record);
        return active;
      }, new Map<string, TrustedDeviceRecord>()).values()
    );
    await this.save(next);
  }

  private async save(records: TrustedDeviceRecord[]): Promise<void> {
    await this.storage.store(STORAGE_KEY, JSON.stringify(records));
  }
}
