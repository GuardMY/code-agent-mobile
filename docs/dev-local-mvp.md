# Local LAN MVP Development Guide

## Prerequisites

- Node.js 24 or newer.
- npm 11 or newer.
- Codex CLI available on `PATH`, or configure a custom command in VS Code with `agentMobile.codexCommand`.
- Android Studio with Android SDK 35 for building the Android app.

This repository includes the TypeScript host and VS Code extension build. The Android source is present under `android`, but this machine did not have `ANDROID_HOME`, `sdkmanager`, Android Studio, or global Gradle available during implementation.

## Install

```powershell
npm install
```

## Build And Test TypeScript Packages

```powershell
npm run build
npm run test
```

## Run Agent Host Directly

```powershell
npm run build
npm run dev:host -- --host 127.0.0.1 --port 17365 --workspace E:\Code\code-agent-mobile --pairing-token pairing-token-123
```

The host prints a JSON ready message containing the advertised host, port, pairing token, and expiry.

## VS Code Extension Debug Flow

1. Open this folder in VS Code.
2. Run `npm install`.
3. Run `npm run build`.
4. Open the extension package in VS Code extension development mode.
5. Use the `Agent Mobile` activity bar view.
6. Run `Agent Mobile: Start Host` for loopback mode.
7. Run `Agent Mobile: Enable LAN Pairing` to expose the host on `0.0.0.0`.
8. Scan or copy the pairing JSON into the Android app.

## VS Code Extension Packaging

Build the extension and create a `.vsix`:

```powershell
npm run package:extension
```

The package is written under `vscode-extension` with a name similar to `agent-mobile-control-0.1.0.vsix`.

Install it into an existing VS Code:

```powershell
code --install-extension vscode-extension/agent-mobile-control-0.1.0.vsix
```

If the `code` command is not on `PATH`, open VS Code and run `Extensions: Install from VSIX...`, then select `vscode-extension/agent-mobile-control-0.1.0.vsix`.

After installation, reload VS Code, open the `Agent Mobile` activity bar view, and run `Agent Mobile: Start Host`. The extension will launch `codex app-server` through `agentMobile.codexCommand` instead of starting a separate `code` CLI session.

Available settings:

- `agentMobile.port`: default `17365`.
- `agentMobile.codexCommand`: default `codex`.
- `agentMobile.eventCacheSize`: default `500`.

## Android Flow

1. Install Android Studio and Android SDK 35.
2. Open `android` in Android Studio.
3. If Gradle Wrapper is not present, let Android Studio create it or run a local Gradle install:

```powershell
gradle wrapper --gradle-version 8.10.2
```

4. Build the app:

```powershell
.\gradlew.bat :app:assembleDebug
```

5. Put the phone and development machine on the same Wi-Fi.
6. In VS Code, enable LAN pairing.
7. In Android, scan the QR code or paste the pairing JSON.
8. Create a session, send a prompt, and watch output stream into the console.

## Current MVP Limits

- Tokens and sessions are in memory and disappear when Agent Host restarts.
- Only Codex is wired as a real adapter.
- Codex output is treated as PTY text, not structured tool-call events.
- Public Relay, account login, push notifications, durable device authorization, and end-to-end encryption are intentionally out of scope for this MVP.
