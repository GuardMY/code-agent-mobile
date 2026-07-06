# VS Code SecretStorage Device Persistence Design

## Goal

Keep previously paired mobile devices valid after the VS Code plugin, VS Code window, or Agent Host process restarts. Pairing trust should persist in the VS Code extension, while short-lived runtime access tokens should continue to be issued by Agent Host.

## Scope

This design covers:

- Persisting paired device trust in the VS Code extension with `SecretStorage`
- Rehydrating Host runtime device state when the Host starts
- Re-authenticating previously paired mobile devices without scanning a new QR code
- Revoking persisted devices from the VS Code dashboard

This design does not cover:

- Computer-wide persistence outside the VS Code extension
- Remote relay or non-LAN connectivity
- End-to-end TLS for LAN traffic

## Requirements

- A mobile device that paired successfully once remains trusted until the user explicitly unbinds it.
- Restarting the VS Code extension, VS Code window, or Agent Host must not require re-pairing.
- Runtime `accessToken` values must remain short-lived/in-memory and must not be treated as the long-term trust anchor.
- A revoked device must fail future re-authentication attempts until it pairs again.
- The dashboard must continue to show the persisted paired device list after restart.

## Chosen Approach

Persist paired device trust in `vscode.SecretStorage`, and let the VS Code extension restore that trust into Agent Host whenever the Host starts.

The Host remains the runtime authorization service:

- It validates initial `/pair` requests against the pairing token.
- It generates a per-device long-lived secret during first pairing.
- It validates re-authentication requests from already paired devices.
- It issues fresh short-lived `accessToken` values after successful re-authentication.

The extension becomes the source of truth for the trusted device registry:

- It stores the persisted paired device records in `SecretStorage`.
- It rehydrates Host state at startup.
- It removes persisted records when the user revokes a device from the dashboard.

## Why This Approach

This approach matches the confirmed product direction:

- Trust survives plugin and Host restarts.
- Persistence stays inside the VS Code plugin instead of adding a separate Host-local storage layer.
- Access tokens remain ephemeral, which is safer than making them long-lived.
- The current LAN pairing flow stays mostly intact, with a new re-authentication path for subsequent reconnects.

Trade-offs:

- Clearing VS Code extension secrets invalidates all remembered devices.
- A standalone Host process without the extension cannot restore trusted devices.

## Data Model

### Persisted Device Record

Store a JSON array in `SecretStorage` under a stable key such as `agentMobile.pairedDevices`.

Each record contains:

- `deviceId: string`
- `clientType: "android-app" | "ios-app" | "wechat-mini-program" | "desktop-extension" | "unknown"`
- `displayName?: string`
- `pairedAt: string`
- `revokedAt?: string`
- `deviceSecretHash: string`
- `lastSeenAt?: string`

### Runtime Host State

Host keeps two in-memory maps:

- trusted devices keyed by `deviceId`
- issued runtime access tokens keyed by `accessToken`

Trusted devices are loaded from the extension at startup and updated at runtime when new devices pair or existing devices are revoked.

## API Changes

### `POST /pair`

Current behavior:

- validates pairing token
- returns `accessToken`

New behavior:

- validates pairing token
- creates or updates a trusted device record
- generates a per-device `deviceSecret` on first successful pairing
- stores only the hash in Host memory and extension persistence
- returns:
  - `accessToken`
  - `deviceId`
  - `deviceSecret` on first-time pairing

If the same device pairs again with the one-time pairing token, the Host may rotate the device secret and overwrite the persisted record to keep behavior deterministic.

### `POST /devices/reauth`

New endpoint for previously paired devices.

Request:

- `deviceId`
- `deviceSecret`

Behavior:

- look up trusted device by `deviceId`
- reject if not found or revoked
- compare the provided secret against `deviceSecretHash`
- issue a fresh runtime `accessToken` if valid
- update `lastSeenAt`

Response:

- `accessToken`

### `POST /devices/:deviceId/revoke`

Existing revoke flow remains, but the persisted record must also be removed or marked revoked in `SecretStorage`.

## Extension Responsibilities

### Persistence Layer

Add a small persistence module in `vscode-extension` to:

- read all persisted paired devices from `SecretStorage`
- upsert a device record after first pairing
- mark or remove a device on revoke

The stored value should be schema-validated on read. Invalid or partially corrupted values should be ignored with a safe fallback to an empty list.

### Host Rehydration

When the extension starts Agent Host:

1. Load persisted device records from `SecretStorage`.
2. Start Host as usual.
3. Inject the trusted device registry into Host before normal dashboard polling begins.

Preferred implementation:

- extend the Host controller/bootstrap API so the extension can pass the trusted device list during Host startup

Fallback implementation:

- add an internal Host sync endpoint that accepts the trusted device list immediately after startup

The preferred option is cleaner because Host starts in a fully initialized authorization state.

### Runtime Updates

When first pairing succeeds:

1. Host returns the device identity material needed for persistence.
2. Extension writes the trusted device record to `SecretStorage`.
3. Dashboard refresh shows the remembered device.

When revoke succeeds:

1. Extension removes or marks the device revoked in `SecretStorage`.
2. Extension tells Host to drop the runtime trusted device and any active access tokens for it.

## Android Responsibilities

### Local Storage

Persist:

- `deviceId`
- `deviceSecret`
- latest known desktop `host`
- latest known `port`

Do not treat `accessToken` as durable trust state.

### Reconnect Behavior

Connection flow becomes:

1. Try the current `accessToken` if one exists in memory.
2. If startup requires a fresh session, or any authorized request returns `401`, call `/devices/reauth`.
3. Replace the in-memory `accessToken` with the new one.
4. Retry the original request and reopen the stream.

If re-authentication fails, fall back to the current error path and prompt the user to pair again.

### UX Expectations

The mobile app should feel like the desktop was remembered:

- plugin restart should not force QR scanning
- Host restart should recover after one silent re-authentication attempt
- only explicit unbind or local app data loss should require new pairing

## Security Notes

- Persist only `deviceSecretHash` in extension storage, never the raw secret.
- Keep `accessToken` ephemeral and Host-scoped.
- Revoke must invalidate:
  - persisted trust
  - runtime trust
  - all runtime access tokens for that device
- Future enhancements can add token TTL and rotation without changing the persistence model.

## Failure Handling

### SecretStorage Read Failure

- Extension logs the failure
- falls back to an empty trusted device list
- dashboard shows no remembered devices
- already paired mobile devices must pair again until storage is restored

### Host Restart Before Rehydration

- Extension should not mark the Host as fully ready until trusted devices are injected
- dashboard polling should begin after rehydration completes

### Corrupted Persisted Records

- Ignore invalid records after schema validation
- preserve valid records
- do not fail the whole startup flow because one record is malformed

## Testing

### Protocol and Host

- `/pair` returns `deviceSecret` for first-time pairing and a runtime `accessToken`
- `/devices/reauth` returns a fresh `accessToken` for a valid remembered device
- revoked devices fail `reauth`
- Host restart clears old runtime access tokens but still accepts `reauth` after extension rehydration

### VS Code Extension

- persisted device records survive extension restart
- Host startup loads trusted devices from `SecretStorage`
- revoke updates both Host runtime state and `SecretStorage`
- dashboard renders remembered devices after restart

### Android

- first pairing saves `deviceId` and `deviceSecret`
- a `401` response triggers silent `reauth`
- successful `reauth` restores status fetch and streaming without QR repairing
- revoked devices fall back to explicit repairing

## Open Decisions Resolved

- Trust anchor location: VS Code extension `SecretStorage`
- Runtime authorization issuer: Agent Host
- Long-term access model: remembered device identity, fresh runtime `accessToken`
- Device lifetime: valid until user manually unbinds

## Implementation Plan Preview

Expected implementation order:

1. Add protocol schemas for persisted trusted device and re-auth request/response
2. Add Host support for trusted device bootstrap and `/devices/reauth`
3. Add VS Code `SecretStorage` persistence and Host rehydration
4. Update Android to store device credentials and silently re-authenticate
5. Add tests across Host, extension, and Android
