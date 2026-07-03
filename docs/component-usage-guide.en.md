# Agent Mobile Component Usage Guide

This guide describes the repository components, how to run them locally, and how to verify common development flows.

## 1. Components

| Component | Path | Purpose | When to use |
| --- | --- | --- | --- |
| Protocol | `protocol` | Shared message types, pairing payloads, session summaries, approval requests, and Zod schemas | When changing cross-component API fields |
| Agent Host | `agent-host` | Local HTTP/WebSocket service for pairing, session management, Codex startup, input/output forwarding | Local integration, VS Code extension host, Android direct connection |
| VS Code Extension | `vscode-extension` | Starts/stops Host, shows pairing JSON/QR code, displays status and Codex sessions | Recommended desktop entrypoint |
| Android App | `android` | Mobile UI for pairing, session control, prompts, output, and approvals | Phone-side control surface |
| Gateway / Relay | `gateway` | Optional WebSocket relay by `hostId` | Remote access or relay verification |

Most local development uses:

```text
VS Code Extension -> Agent Host -> Android App -> Codex session -> WebSocket output
```

## 2. Setup

Install Node dependencies and build/test all TypeScript workspaces:

```powershell
npm install
npm run build
npm run test
```

Codex must be available on `PATH`, or configured with `agentMobile.codexCommand`.

Agent Host starts Codex with:

```powershell
codex app-server --listen stdio://
```

## 3. Useful Scripts

| Command | Description |
| --- | --- |
| `npm run build` | Build all workspaces |
| `npm run test` | Run all TypeScript tests |
| `npm run dev:host` | Run Agent Host from source |
| `npm run dev:gateway` | Run Gateway from source |
| `npm run package:extension` | Build the VS Code extension VSIX |

## 4. Agent Host

Run the host directly:

```powershell
npm run build
npm run dev:host -- --host 127.0.0.1 --port 17365 --workspace E:\Code\code-agent-mobile --pairing-token pairing-token-123
```

LAN mode:

```powershell
npm run dev:host -- --host 0.0.0.0 --port 17365 --workspace E:\Code\code-agent-mobile
```

Common API routes:

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | none | Health check |
| `POST` | `/pair` | pairing token | Exchange pairing token for access token |
| `GET` | `/status` | pairing token or Bearer token | Dashboard status |
| `GET` | `/sessions` | Bearer token | List sessions |
| `POST` | `/sessions/:id/attach` | Bearer token | Resume a discovered Codex thread and stream history |
| `POST` | `/sessions/:id/input` | Bearer token | Send prompt text |
| `POST` | `/sessions/:id/control` | Bearer token | Stop a session |
| `GET` | `/stream` | access token query | Event stream |

## 5. VS Code Extension

Development flow:

1. Open the repository root in VS Code.
2. Run `npm install`.
3. Run `npm run build`.
4. Start an Extension Development Host.
5. Open the `Agent Mobile` Activity Bar view.
6. Run `Agent Mobile: Start Host` or `Agent Mobile: Enable LAN Pairing`.
7. Pair a mobile client with the QR code or pairing JSON.

Package the extension:

```powershell
npm run package:extension
```

Install the generated VSIX:

```powershell
code --install-extension vscode-extension/agent-mobile-control-0.1.0.vsix
```

## 6. Android App

Use Android Studio or Gradle to build the app:

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

If the Gradle wrapper is not present, use a local Gradle install or generate the wrapper.

## 7. Gateway / Relay

Run the relay:

```powershell
npm run dev:gateway -- --host 127.0.0.1 --port 17366 --relay-token dev-relay-token
```

Start Host with relay settings:

```powershell
npm run dev:host -- `
  --host 127.0.0.1 `
  --port 17365 `
  --workspace E:\Code\code-agent-mobile `
  --relay-url ws://127.0.0.1:17366 `
  --relay-host-id dev-host-1 `
  --relay-token dev-relay-token
```

## 8. Verification

Run the relevant checks before reporting completion:

```powershell
npm run build
npm run test
```

For Android changes, follow the root `AGENTS.md` rebuild rule and run an Android app build.

For VS Code extension changes, run:

```powershell
npm run build -w agent-mobile-control
```
