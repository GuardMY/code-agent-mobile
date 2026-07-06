# VS Code Single Host Reuse Design

**Goal:** Let one machine run a single `agent-host` instance that every VS Code window reuses automatically.

**Scope**

- Reuse an already running local host instead of spawning a second process.
- Auto-sync host state and session list across VS Code windows.
- Keep selected session and console output as window-local UI state.

**Design**

- Treat the local host as the single source of truth for pairing status, LAN mode, and sessions.
- On extension startup and periodic refresh, probe `127.0.0.1:<port>/status`.
- If a host is reachable, update the webview state from the returned dashboard payload and reuse its pairing token instead of generating a new one.
- If no host is reachable, starting the host spawns the local `agent-host` process as it does today.
- Add a host stop endpoint so any window that has discovered the shared pairing token can stop the single host cleanly.
- Allow unauthenticated loopback access to `/status` so other local VS Code windows can discover the shared host without already knowing the pairing token.

**Testing**

- Add server coverage for loopback-only local status discovery and remote stop requests.
- Add extension/controller coverage for reusing an existing host instead of spawning a new one.
- Add extension coverage for syncing state from dashboard responses during refresh.
