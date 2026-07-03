# VS Code Connection Dashboard Design

## Goal

Add a VS Code extension dashboard that shows the connection state of the local Agent Host, paired mobile clients, and desktop agent backends. The dashboard should make first-time pairing obvious with a QR code/link code, then continue to serve as a status panel after devices are paired.

## Chosen Approach

Use a host-backed polling dashboard.

The Agent Host will expose one aggregate status endpoint, `GET /status`, and the VS Code extension webview will refresh that status periodically. This keeps the first implementation simple, testable, and aligned with the existing HTTP API. A future WebSocket subscription can replace polling without changing the dashboard information model.

## Dashboard Behavior

The existing pairing webview becomes an `Agent Mobile` connection dashboard with four areas:

1. Server status
   - Shows whether the Host is running.
   - Shows listen host, LAN mode, port, device name, and version when known.
   - Keeps existing controls for Start Host, Stop Host, Enable LAN, Disable LAN, Copy pairing JSON, and Refresh.

2. First-time connection
   - If no non-revoked mobile device is paired, the QR code and link/pairing JSON are prominent.
   - If one or more devices are paired, the QR/link area remains available as an add-device section.

3. Mobile devices
   - Shows paired clients grouped or labeled by client type:
     - Android App
     - iOS App
     - WeChat Mini Program
     - Unknown client
   - Each device row shows device ID, paired time, access token expiry, and revoked state.

4. Desktop agents
   - Shows Codex, Claude Code, and OpenCode.
   - Each agent row shows capability availability and current session activity.
   - Capability states are `available`, `missing`, or `unknown`.
   - Current session state includes running session count and the most recent session status where available.

## Host API

Add `GET /status` to Agent Host. The response shape is:

```ts
type HostDashboardStatus = {
  server: {
    running: true;
    lanEnabled: boolean;
    host: string;
    port: number;
    deviceName: string;
    version: string;
  };
  pairing: {
    enabled: boolean;
    expiresAt: string;
    pairingPayload: PairingPayload;
  };
  devices: DeviceSummary[];
  agents: AgentCapabilitySummary[];
  sessions: SessionSummary[];
};

type AgentCapabilitySummary = {
  id: "codex" | "claude-code" | "opencode";
  displayName: string;
  availability: "available" | "missing" | "unknown";
  activeSessions: number;
  latestSessionStatus?: SessionStatus;
};
```

The endpoint is intentionally aggregate-oriented so the VS Code extension does not need to make several requests or infer state from unrelated APIs.

## Client Type Model

Extend paired devices with `clientType`:

```ts
type ClientType =
  | "android-app"
  | "ios-app"
  | "wechat-mini-program"
  | "unknown";
```

The `/pair` request accepts optional `clientType`. If omitted, it defaults to `android-app` for compatibility with the current Android app.

`DeviceSummary` includes `clientType`, and `/devices` plus `/status` return it. Existing tests that only assert token safety should continue to pass with the added field.

## Agent Availability

Codex is the only currently wired real adapter. For this milestone:

- Codex availability is based on the configured `agentMobile.codexCommand`.
- Claude Code and OpenCode are command-detected only and shown as capability status, not as selectable runtime adapters.
- Missing agents are displayed as unavailable rather than hidden.

This avoids suggesting that Claude Code or OpenCode can run sessions before adapters exist.

## Extension Data Flow

The extension owns the current pairing token and generated pairing payload. When the Host starts, it passes the same token into Agent Host. The dashboard polls:

- `GET /status` when Host is running.
- Local controller state when Host is stopped or unreachable.

If polling fails, the webview shows Host as unreachable and keeps the current QR/link code visible so the user still has a recovery path.

## Error Handling

- If Host is stopped, the dashboard shows stopped state and no remote devices/sessions.
- If Host is starting or unreachable, the dashboard shows an explicit unreachable state.
- If `/status` is missing or returns invalid data, the dashboard falls back to local state and exposes Refresh.
- Revoked devices remain visible with revoked styling so users can understand why a previous client no longer connects.

## Testing

Host tests:

- `/status` returns server, pairing, devices, agents, and sessions.
- `/pair` without `clientType` defaults to `android-app`.
- `/pair` with `wechat-mini-program` is preserved in device summaries.

VS Code extension tests:

- Dashboard HTML renders Host status and LAN mode.
- Dashboard HTML renders first-time QR/link section when there are no active devices.
- Dashboard HTML renders mobile client labels for app and WeChat devices.
- Dashboard HTML renders Codex, Claude Code, and OpenCode availability/session summaries.

Verification:

- `npm test`
- `npm run build`
- `npm run package:extension`
