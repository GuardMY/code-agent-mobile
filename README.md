# Code Agent Mobile

Code Agent Mobile is a LAN-first control surface for coding agents. It links a VS Code extension, a local host service, and an Android app so you can monitor sessions, send prompts, and handle approvals from your phone while agents run on your computer.

## What is in this repository

- `protocol`: shared schemas and TypeScript types used across desktop and mobile components.
- `agent-host`: local HTTP and WebSocket host that manages pairing, sessions, and agent adapters.
- `vscode-extension`: VS Code extension that starts the host and exposes pairing and control UI.
- `android`: Android app for pairing, session browsing, streaming output, and remote input.
- `gateway`: optional WebSocket relay for self-hosted public-network connections.
- `docs`: architecture notes, local MVP setup, and component-level documentation.

## Current scope

The project is LAN-first: local pairing between the desktop and the Android app remains the default workflow.

- The VS Code extension starts the local host.
- The Android app pairs by QR code or pairing JSON.
- Codex is the main integrated coding agent path today.
- A self-hosted public relay is available for remote connections; see the [public relay guide](docs/public-relay.en.md) for setup.

## Prerequisites

- Node.js 24 or newer
- npm 11 or newer
- Codex CLI available on `PATH`, or a custom command configured in VS Code with `agentMobile.codexCommand`
- Android Studio with Android SDK 35 to build the Android app

## Quick start

Install dependencies:

```powershell
npm install
```

Build all TypeScript workspaces:

```powershell
npm run build
```

Run tests:

```powershell
npm run test
```

Run the local host directly:

```powershell
npm run dev:host -- --host 127.0.0.1 --port 17365 --workspace E:\Code\code-agent-mobile --pairing-token pairing-token-123
```

## VS Code extension packaging

Build and package the extension as a VSIX:

```powershell
npm run package:extension
```

The output file is created under `vscode-extension/`.

## Android build

From the `android` directory, build the debug APK:

```powershell
.\gradlew.bat :app:assembleDebug
```

The APK is typically written to `android/app/build/outputs/apk/debug/`.

## Public relay

The optional Gateway routes WebSocket traffic between the Agent Host and Android app without exposing the Host directly to the internet. It supports a shared static relay token or a token bound to a specific `hostId`; follow the [component usage guide](docs/component-usage-guide.en.md) to start the relay and configure the Host and pairing payload.

## Development flow

1. Open the repository in VS Code.
2. Run `npm install`.
3. Run `npm run build`.
4. Start the extension in extension development mode.
5. Use the `Agent Mobile` view to start the host and enable LAN pairing.
6. Pair the Android app by scanning the QR code or pasting the pairing JSON.

## Documentation

- Local MVP setup: [docs/dev-local-mvp.md](docs/dev-local-mvp.md)
- Architecture overview: [docs/agent-mobile-control-architecture.en.md](docs/agent-mobile-control-architecture.en.md)
- Component usage guide: [docs/component-usage-guide.en.md](docs/component-usage-guide.en.md)
- Public relay guide: [docs/public-relay.en.md](docs/public-relay.en.md)

## License

Apache-2.0
