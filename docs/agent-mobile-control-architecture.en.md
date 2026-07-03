# VS Code Agent Mobile Control Architecture

## 1. Goal

Agent Mobile connects a VS Code extension, a local host service, and a mobile app so a phone can monitor and control coding agents such as Codex, Claude Code, Gemini CLI, and Aider while they run on the computer.

The goal is not to mirror a terminal. The system provides an auditable, resumable, and extensible control channel:

- View workspaces, agent sessions, terminal output, and task status on mobile.
- Send prompts and control commands from mobile.
- Confirm high-risk actions before they run.
- Support LAN-first development and later remote relay access.
- Keep the agent close to the VS Code workspace, filesystem permissions, git state, and local tools.

## 2. Recommended Roadmap

### Phase 1: LAN MVP

The phone and computer are on the same Wi-Fi network.

- The VS Code extension starts the local Agent Host.
- Agent Host listens on loopback or a LAN address.
- The mobile app pairs by QR code or pairing JSON.
- The app receives streaming output over WebSocket and sends input/control over HTTP/WebSocket.

This phase is low-cost, easy to debug, and does not require cloud infrastructure. It must still use strong authentication when exposing the host on the LAN.

### Phase 2: Remote Relay

After the LAN MVP is stable, add a hosted or self-managed relay:

- Agent Host opens an outbound WebSocket to the relay.
- Mobile clients connect to the same relay.
- The relay routes encrypted session messages and does not inspect source code.
- Pairing, short-lived access tokens, session permissions, audit logs, and rate limits protect the channel.

## 3. Architecture

```text
Mobile App
  -> HTTP/WebSocket
Gateway or Relay
  -> loopback / LAN / reverse WebSocket
VS Code Extension
  -> Agent Host
Agent Tools
  -> Codex, Claude Code, Gemini CLI, Aider, others
```

The current implementation uses:

- `protocol`: shared schemas and TypeScript types.
- `agent-host`: local HTTP/WebSocket service, pairing, session management, Codex adapter.
- `vscode-extension`: VS Code entrypoint and Webview control surface.
- `android`: mobile app.
- `gateway`: optional WebSocket relay.

## 4. Core Components

### VS Code Extension

The extension is the desktop entrypoint. It starts/stops Agent Host, generates pairing JSON and QR codes, displays connection state, and can expose Codex sessions in the Webview UI.

### Agent Host

Agent Host owns the local API surface:

- `POST /pair`
- `GET /status`
- `GET /sessions`
- `POST /sessions/:id/attach`
- `POST /sessions/:id/input`
- `POST /sessions/:id/control`
- `GET /stream`

It adapts Codex through `codex app-server --listen stdio://` and maps Codex thread events into the shared session/event model.

### Mobile App

The mobile app pairs with Agent Host, selects a session, sends prompts, stops sessions, receives output, and handles approval flows.

### Gateway / Relay

The relay is optional. It routes messages between Host and mobile clients when they are not on the same LAN.

## 5. Security Model

- Pairing uses a short-lived one-time token.
- Pairing exchanges the token for a short-lived access token.
- Protected HTTP routes require `Authorization: Bearer <accessToken>`.
- The stream endpoint requires a valid access token query parameter.
- High-risk local actions should go through approval requests.
- LAN mode must be explicitly enabled.

## 6. Current Codex Integration

The project uses Codex app-server JSON-RPC rather than directly parsing local Codex files or shelling out to `codex resume`.

Important methods:

- `initialize`
- `thread/list`
- `thread/resume`
- `turn/start`
- `turn/steer`
- `turn/interrupt`

This is better suited for a VS Code plugin and mobile control surface because it provides structured thread discovery, resume, streaming events, and error handling.

## 7. Development Notes

- Keep protocol changes in `protocol` first, then update Host, extension, and app consumers.
- Prefer app-server structured APIs over parsing Codex local storage.
- Keep mobile-created Codex sessions disabled unless the product direction changes.
- When touching app or plugin code, follow the root `AGENTS.md` rebuild rules.
