# VS Code SecretStorage Device Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist paired mobile-device trust in the VS Code extension so previously bound devices can silently recover after plugin, VS Code, or Host restarts without rescanning a QR code.

**Architecture:** The protocol layer grows explicit trusted-device and re-auth schemas. Agent Host keeps runtime trust and short-lived access tokens in memory, but accepts a trusted-device bootstrap list from the VS Code extension and exposes `/devices/reauth` for remembered devices. The VS Code extension becomes the persistence source of truth via `SecretStorage`, and Android stores `deviceId + deviceSecret` so it can recover from `401` responses by fetching a fresh runtime access token.

**Tech Stack:** TypeScript, Zod, Fastify, VS Code Extension API (`SecretStorage`), Kotlin, OkHttp, Gradle, npm workspaces, Vitest/Jest-style TS tests already present in repo, Android unit tests.

---

## File Structure

### Protocol

- Modify: `protocol/src/index.ts`
- Modify: `protocol/src/index.test.ts`

Add schemas and types for:

- trusted device persistence records
- pair response payloads
- re-auth request/response payloads
- dashboard/device summaries if new fields are surfaced

### Agent Host

- Modify: `agent-host/src/server.ts`
- Modify: `agent-host/src/server.test.ts`
- Modify: `agent-host/src/cli.ts`
- Modify: `agent-host/src/cli.test.ts`
- Modify: `agent-host/src/index.ts` if exports need to widen

Add support for:

- bootstrapped trusted devices passed in from the extension
- `/devices/reauth`
- `/pair` returning device secret material
- invalidating runtime tokens when a device is revoked

### VS Code Extension

- Create: `vscode-extension/src/deviceRegistry.ts`
- Create: `vscode-extension/src/deviceRegistry.test.ts`
- Modify: `vscode-extension/src/hostController.ts`
- Modify: `vscode-extension/src/hostController.test.ts`
- Modify: `vscode-extension/src/hostClient.ts`
- Modify: `vscode-extension/src/hostClient.test.ts`
- Modify: `vscode-extension/src/extension.ts`
- Modify: `vscode-extension/src/extension.test.ts`
- Modify: `vscode-extension/src/webview.ts`
- Modify: `vscode-extension/src/webview.test.ts`

Add:

- `SecretStorage` read/write module for trusted devices
- Host bootstrap path that injects trusted devices at startup
- persistence updates after first pair and after revoke
- dashboard continuity for remembered devices after restart

### Android

- Modify: `android/app/src/main/java/com/agentmobile/app/model/Models.kt`
- Modify: `android/app/src/main/java/com/agentmobile/app/net/AgentMobileClient.kt`
- Modify: `android/app/src/main/java/com/agentmobile/app/net/PairingParser.kt`
- Modify: `android/app/src/main/java/com/agentmobile/app/ui/ConsoleViewModel.kt`
- Modify: `android/app/src/test/java/com/agentmobile/app/net/AgentMobileClientTest.kt`
- Modify: `android/app/src/test/java/com/agentmobile/app/net/PairingParserTest.kt`
- Modify: `android/app/src/test/java/com/agentmobile/app/ui/ConsoleViewModelTest.kt`

Add:

- device credential models
- parse/store pair response with `deviceSecret`
- `/devices/reauth` client call
- silent recovery on `401`

### Verification and Packaging

- Run TS tests for `protocol`, `agent-host`, and `vscode-extension`
- Run Android unit tests
- Package the VS Code extension because plugin runtime behavior changes

---

### Task 1: Extend Protocol Contracts First

**Files:**
- Modify: `protocol/src/index.ts`
- Test: `protocol/src/index.test.ts`

- [ ] **Step 1: Write the failing protocol tests**

```ts
import {
  pairSuccessResponseSchema,
  reauthRequestSchema,
  reauthResponseSchema,
  trustedDeviceRecordSchema
} from "./index.js";

it("accepts trusted device records used by SecretStorage", () => {
  const result = trustedDeviceRecordSchema.safeParse({
    deviceId: "android-001",
    clientType: "android-app",
    pairedAt: "2026-07-06T10:00:00.000Z",
    deviceSecretHash: "hash_abc",
    lastSeenAt: "2026-07-06T10:05:00.000Z"
  });
  expect(result.success).toBe(true);
});

it("requires deviceId and deviceSecret for reauth", () => {
  const result = reauthRequestSchema.safeParse({
    deviceId: "android-001",
    deviceSecret: "secret_123"
  });
  expect(result.success).toBe(true);
});

it("returns accessToken and optional deviceSecret on pair success", () => {
  const result = pairSuccessResponseSchema.safeParse({
    accessToken: "access_123",
    deviceId: "android-001",
    deviceSecret: "secret_123"
  });
  expect(result.success).toBe(true);
});

it("accepts reauth success responses", () => {
  const result = reauthResponseSchema.safeParse({
    accessToken: "access_456"
  });
  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: Run protocol tests to verify they fail**

Run: `npm test --workspace protocol`
Expected: FAIL with missing schema/type exports in `protocol/src/index.ts`

- [ ] **Step 3: Add minimal schemas and exports**

```ts
export const trustedDeviceRecordSchema = z.object({
  deviceId: z.string().min(1),
  clientType: clientTypeSchema,
  displayName: z.string().min(1).optional(),
  pairedAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(),
  deviceSecretHash: z.string().min(1),
  lastSeenAt: z.string().datetime().optional()
});
export type TrustedDeviceRecord = z.infer<typeof trustedDeviceRecordSchema>;

export const pairSuccessResponseSchema = z.object({
  accessToken: z.string().min(1),
  deviceId: z.string().min(1),
  deviceSecret: z.string().min(1).optional()
});
export type PairSuccessResponse = z.infer<typeof pairSuccessResponseSchema>;

export const reauthRequestSchema = z.object({
  deviceId: z.string().min(1),
  deviceSecret: z.string().min(1)
});
export type ReauthRequest = z.infer<typeof reauthRequestSchema>;

export const reauthResponseSchema = z.object({
  accessToken: z.string().min(1)
});
export type ReauthResponse = z.infer<typeof reauthResponseSchema>;
```

- [ ] **Step 4: Run protocol tests to verify they pass**

Run: `npm test --workspace protocol`
Expected: PASS with the new schema coverage

- [ ] **Step 5: Commit**

```bash
git add protocol/src/index.ts protocol/src/index.test.ts
git commit -m "feat: add trusted device protocol contracts"
```

### Task 2: Teach Agent Host About Remembered Devices

**Files:**
- Modify: `agent-host/src/server.ts`
- Modify: `agent-host/src/server.test.ts`
- Modify: `agent-host/src/cli.ts`
- Modify: `agent-host/src/cli.test.ts`
- Modify: `agent-host/src/index.ts`

- [ ] **Step 1: Write failing Host tests for pair, reauth, and revoke**

```ts
it("returns device secret on first pairing and remembers the hashed secret", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/pair",
    payload: { pairingToken: "pairing-token-123", deviceId: "android-001", clientType: "android-app" }
  });
  expect(response.statusCode).toBe(200);
  const body = pairSuccessResponseSchema.parse(response.json());
  expect(body.deviceId).toBe("android-001");
  expect(body.deviceSecret).toBeDefined();
});

it("issues a fresh access token for a remembered device", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/devices/reauth",
    payload: { deviceId: "android-001", deviceSecret: "secret_123" }
  });
  expect(response.statusCode).toBe(200);
  expect(reauthResponseSchema.parse(response.json()).accessToken).toMatch(/^access_/);
});

it("rejects reauth after revoke", async () => {
  await app.inject({ method: "POST", url: "/devices/android-001/revoke", headers: authHeaders });
  const response = await app.inject({
    method: "POST",
    url: "/devices/reauth",
    payload: { deviceId: "android-001", deviceSecret: "secret_123" }
  });
  expect(response.statusCode).toBe(401);
});
```

- [ ] **Step 2: Run Host tests to verify they fail**

Run: `npm test --workspace agent-host -- server.test.ts cli.test.ts`
Expected: FAIL because `/devices/reauth` and trusted-device bootstrap do not exist

- [ ] **Step 3: Implement trusted-device bootstrap and reauth in Host**

```ts
type TrustedDeviceState = TrustedDeviceRecord & { activeSecretHash: string };

export interface ServerOptions {
  // existing fields...
  trustedDevices?: TrustedDeviceRecord[];
  onTrustedDevicesChanged?: (devices: TrustedDeviceRecord[]) => void;
}

const reauthRequestSchema = z.object({
  deviceId: z.string().min(1),
  deviceSecret: z.string().min(1)
});

app.post("/devices/reauth", async (request, reply) => {
  const body = reauthRequestSchema.parse(request.body);
  const device = devices.get(body.deviceId);
  if (!device || device.revokedAt || !verifyDeviceSecret(body.deviceSecret, device.deviceSecretHash)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const accessToken = issueAccessToken(body.deviceId, accessTokens);
  devices.set(body.deviceId, { ...device, lastSeenAt: new Date().toISOString() });
  options.onTrustedDevicesChanged?.(Array.from(devices.values()));
  return { accessToken };
});

app.post("/pair", async (request, reply) => {
  // validate pairing token...
  const deviceSecret = createDeviceSecret();
  const trustedDevice = {
    deviceId: body.data.deviceId,
    clientType: body.data.clientType ?? "android-app",
    pairedAt: new Date().toISOString(),
    deviceSecretHash: hashDeviceSecret(deviceSecret)
  };
  devices.set(trustedDevice.deviceId, trustedDevice);
  options.onTrustedDevicesChanged?.(Array.from(devices.values()));
  return { accessToken, deviceId: trustedDevice.deviceId, deviceSecret };
});
```

- [ ] **Step 4: Extend CLI/bootstrap input for trusted devices**

```ts
const trustedDevicesJson = readArg("--trusted-devices");
const trustedDevices = trustedDevicesJson
  ? trustedDeviceRecordListSchema.parse(JSON.parse(trustedDevicesJson))
  : [];

const server = buildServer({
  manager,
  version,
  lanEnabled,
  pairingToken,
  deviceName,
  advertisedHost,
  port,
  trustedDevices
});
```

- [ ] **Step 5: Run Host tests to verify they pass**

Run: `npm test --workspace agent-host -- server.test.ts cli.test.ts`
Expected: PASS covering first pair, reauth, revoke, and bootstrap parsing

- [ ] **Step 6: Commit**

```bash
git add agent-host/src/server.ts agent-host/src/server.test.ts agent-host/src/cli.ts agent-host/src/cli.test.ts agent-host/src/index.ts
git commit -m "feat: add host trusted device reauth"
```

### Task 3: Persist Trusted Devices in the VS Code Extension

**Files:**
- Create: `vscode-extension/src/deviceRegistry.ts`
- Test: `vscode-extension/src/deviceRegistry.test.ts`
- Modify: `vscode-extension/src/hostController.ts`
- Modify: `vscode-extension/src/hostController.test.ts`
- Modify: `vscode-extension/src/hostClient.ts`
- Modify: `vscode-extension/src/hostClient.test.ts`
- Modify: `vscode-extension/src/extension.ts`
- Modify: `vscode-extension/src/extension.test.ts`
- Modify: `vscode-extension/src/webview.test.ts`

- [ ] **Step 1: Write failing registry tests against `SecretStorage`**

```ts
it("loads trusted devices from SecretStorage", async () => {
  const storage = fakeSecretStorage({
    "agentMobile.pairedDevices": JSON.stringify([
      {
        deviceId: "android-001",
        clientType: "android-app",
        pairedAt: "2026-07-06T10:00:00.000Z",
        deviceSecretHash: "hash_abc"
      }
    ])
  });
  const registry = new DeviceRegistry(storage);
  await expect(registry.load()).resolves.toEqual([
    expect.objectContaining({ deviceId: "android-001" })
  ]);
});

it("upserts a trusted device after first pair", async () => {
  const registry = new DeviceRegistry(fakeSecretStorage());
  await registry.upsert({
    deviceId: "android-001",
    clientType: "android-app",
    pairedAt: "2026-07-06T10:00:00.000Z",
    deviceSecretHash: "hash_abc"
  });
  expect(await registry.load()).toHaveLength(1);
});
```

- [ ] **Step 2: Run extension tests to verify they fail**

Run: `npm test --workspace vscode-extension -- deviceRegistry.test.ts extension.test.ts hostController.test.ts`
Expected: FAIL with missing registry module and missing Host bootstrap handling

- [ ] **Step 3: Implement `deviceRegistry.ts`**

```ts
const STORAGE_KEY = "agentMobile.pairedDevices";

export class DeviceRegistry {
  constructor(private readonly storage: vscode.SecretStorage) {}

  async load(): Promise<TrustedDeviceRecord[]> {
    const raw = await this.storage.get(STORAGE_KEY);
    if (!raw) return [];
    const parsed = trustedDeviceRecordListSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  }

  async upsert(record: TrustedDeviceRecord): Promise<void> {
    const records = await this.load();
    const next = records.some((item) => item.deviceId === record.deviceId)
      ? records.map((item) => (item.deviceId === record.deviceId ? record : item))
      : [...records, record];
    await this.storage.store(STORAGE_KEY, JSON.stringify(next));
  }

  async remove(deviceId: string): Promise<void> {
    const records = await this.load();
    await this.storage.store(STORAGE_KEY, JSON.stringify(records.filter((item) => item.deviceId !== deviceId)));
  }
}
```

- [ ] **Step 4: Pass trusted devices into Host startup and keep persistence in sync**

```ts
const registry = new DeviceRegistry(context.secrets);
const trustedDevices = await registry.load();

await controller.start({
  host: state.lanEnabled ? "0.0.0.0" : "127.0.0.1",
  extensionPath,
  workspace,
  pairingToken: state.pairingToken,
  config,
  trustedDevices,
  onTrustedDevicesChanged: async (devices) => {
    for (const device of devices) {
      if (device.revokedAt) {
        await registry.remove(device.deviceId);
      } else {
        await registry.upsert(device);
      }
    }
  },
  onOutput: (line) => console.log(`[agent-mobile-host] ${line}`)
});
```

- [ ] **Step 5: Wire revoke through persistent storage and keep dashboard tests green**

```ts
private async revokeDevice(deviceId: string): Promise<void> {
  try {
    await this.requireHostClient().revokeDevice(deviceId);
    await this.deviceRegistry.remove(deviceId);
    this.state.consoleError = undefined;
  } catch (error) {
    this.state.consoleError = error instanceof Error ? error.message : String(error);
  }
  await this.safeRefresh();
}
```

- [ ] **Step 6: Run extension tests to verify they pass**

Run: `npm test --workspace vscode-extension -- deviceRegistry.test.ts extension.test.ts hostController.test.ts hostClient.test.ts webview.test.ts`
Expected: PASS with restart-safe device persistence coverage

- [ ] **Step 7: Commit**

```bash
git add vscode-extension/src/deviceRegistry.ts vscode-extension/src/deviceRegistry.test.ts vscode-extension/src/hostController.ts vscode-extension/src/hostController.test.ts vscode-extension/src/hostClient.ts vscode-extension/src/hostClient.test.ts vscode-extension/src/extension.ts vscode-extension/src/extension.test.ts vscode-extension/src/webview.test.ts
git commit -m "feat: persist trusted devices in vscode"
```

### Task 4: Add Silent Re-authentication on Android

**Files:**
- Modify: `android/app/src/main/java/com/agentmobile/app/model/Models.kt`
- Modify: `android/app/src/main/java/com/agentmobile/app/net/AgentMobileClient.kt`
- Modify: `android/app/src/main/java/com/agentmobile/app/net/PairingParser.kt`
- Modify: `android/app/src/main/java/com/agentmobile/app/ui/ConsoleViewModel.kt`
- Test: `android/app/src/test/java/com/agentmobile/app/net/AgentMobileClientTest.kt`
- Test: `android/app/src/test/java/com/agentmobile/app/net/PairingParserTest.kt`
- Test: `android/app/src/test/java/com/agentmobile/app/ui/ConsoleViewModelTest.kt`

- [ ] **Step 1: Write failing Android tests for pair response parsing and reauth**

```kotlin
@Test
fun pairReturnsDeviceCredentials() {
    server.enqueueJson("""{"accessToken":"access_123","deviceId":"android-001","deviceSecret":"secret_123"}""")
    val info = client.pair(server.hostName, server.port, "pairing-token-123", "android")
    assertEquals("android-001", info.deviceId)
    assertEquals("secret_123", info.deviceSecret)
}

@Test
fun reauthCallsDevicesReauthEndpoint() {
    server.enqueueJson("""{"accessToken":"access_456"}""")
    val token = client.reauth(savedConnection("android-001", "secret_123"))
    assertEquals("access_456", token)
    assertEquals("/devices/reauth", server.takeRequest().path)
}

@Test
fun reconnectsByReauthWhenStatusReturns401() {
    fakeApi.failStatusOnceWith401 = true
    viewModel.connect(pairingJson())
    assertTrue(fakeApi.reauthCalled)
}
```

- [ ] **Step 2: Run Android tests to verify they fail**

Run: `Set-Location android; .\gradlew.bat testDebugUnitTest`
Expected: FAIL because models and API surface do not include device credentials or reauth

- [ ] **Step 3: Expand models and HTTP client for device credentials**

```kotlin
data class ConnectionInfo(
    val host: String,
    val port: Int,
    val accessToken: String,
    val deviceId: String? = null,
    val deviceSecret: String? = null
)

override fun pair(host: String, port: Int, pairingToken: String, deviceId: String): ConnectionInfo {
    // ...
    return ConnectionInfo(
        host = host,
        port = port,
        accessToken = body.getString("accessToken"),
        deviceId = body.getString("deviceId"),
        deviceSecret = body.optString("deviceSecret").ifBlank { null }
    )
}

fun reauth(connection: ConnectionInfo): ConnectionInfo {
    val payload = JSONObject()
        .put("deviceId", requireNotNull(connection.deviceId))
        .put("deviceSecret", requireNotNull(connection.deviceSecret))
        .toString()
    // POST /devices/reauth, return copied ConnectionInfo with new accessToken
}
```

- [ ] **Step 4: Add `401` recovery in `ConsoleViewModel`**

```kotlin
private suspend fun <T> withReauth(block: (ConnectionInfo) -> T): T {
    val current = requireNotNull(_state.value.connection)
    return try {
        block(current)
    } catch (error: UnauthorizedException) {
        val refreshed = client.reauth(current)
        _state.update { it.copy(connection = refreshed, connected = true, error = null) }
        block(refreshed)
    }
}
```

- [ ] **Step 5: Re-run Android tests to verify they pass**

Run: `Set-Location android; .\gradlew.bat testDebugUnitTest`
Expected: PASS with pair-response parsing and silent reauth coverage

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/agentmobile/app/model/Models.kt android/app/src/main/java/com/agentmobile/app/net/AgentMobileClient.kt android/app/src/main/java/com/agentmobile/app/net/PairingParser.kt android/app/src/main/java/com/agentmobile/app/ui/ConsoleViewModel.kt android/app/src/test/java/com/agentmobile/app/net/AgentMobileClientTest.kt android/app/src/test/java/com/agentmobile/app/net/PairingParserTest.kt android/app/src/test/java/com/agentmobile/app/ui/ConsoleViewModelTest.kt
git commit -m "feat: add android silent device reauth"
```

### Task 5: Run Full Verification and Produce Required Artifacts

**Files:**
- Modify if needed based on fixes from verification
- Output artifact: `vscode-extension/*.vsix`

- [ ] **Step 1: Run the full JS/TS verification sweep**

Run:

```bash
npm test --workspace protocol
npm test --workspace agent-host
npm test --workspace vscode-extension
```

Expected: PASS across protocol, Host, and extension workspaces

- [ ] **Step 2: Run Android unit tests**

Run:

```powershell
Set-Location android
.\gradlew.bat testDebugUnitTest
```

Expected: BUILD SUCCESSFUL with all Android unit tests passing

- [ ] **Step 3: Package the VS Code extension**

Run:

```bash
npm run package:extension
```

Expected: PASS and a `.vsix` file created under `vscode-extension/`

- [ ] **Step 4: Smoke-check the remembered-device flow manually**

Run:

```bash
npm run dev:host -- --host 127.0.0.1 --port 17365 --workspace E:\Code\code-agent-mobile --pairing-token pairing-token-123
```

Expected:

- first pairing returns `accessToken + deviceId + deviceSecret`
- restarting the plugin or Host still shows the remembered device in the dashboard
- mobile reauth gets a fresh `accessToken` without QR rescanning
- revoke removes the device and blocks future reauth

- [ ] **Step 5: Commit any final verification-only fixes**

```bash
git add .
git commit -m "test: verify remembered device persistence flow"
```

## Self-Review

### Spec coverage

- `SecretStorage` as the trust anchor is implemented in Task 3.
- Host runtime rehydration and fresh token issuance are implemented in Task 2 and Task 3.
- Android silent recovery without rescanning is implemented in Task 4.
- Manual unbind invalidation is covered in Task 2, Task 3, and Task 5.
- Dashboard continuity after restart is covered in Task 3 and Task 5.

No spec requirement is left without an implementation task.

### Placeholder scan

- No `TODO`, `TBD`, “implement later”, or “similar to Task N” placeholders remain.
- Each code-changing task includes concrete file targets, commands, and representative code.

### Type consistency

- `TrustedDeviceRecord`, `PairSuccessResponse`, `ReauthRequest`, and `ReauthResponse` are introduced in Task 1 and reused consistently later.
- `deviceId` and `deviceSecret` are the same field names across protocol, Host, extension persistence, and Android.
- The re-auth endpoint is consistently named `/devices/reauth`.
