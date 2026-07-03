# Codex Mobile Thread Handoff Design

## Goal

Agent Mobile should let the phone follow and send messages to Codex conversations that were started on the computer. The phone must not create new Codex conversations.

## Behavior

- Desktop Codex remains the only place where a new Codex conversation is started.
- Agent Host discovers Codex threads for the current workspace through Codex app-server.
- The phone lists or auto-selects the most recent available desktop Codex thread.
- When the phone sends text, Agent Host resumes that Codex thread and starts a new Codex turn.
- The phone receives historical thread content when it connects and receives later output over the existing stream.
- If no desktop Codex thread exists, the phone shows that the user should start one on the computer.

## Architecture

Agent Host owns a Codex thread gateway that speaks app-server JSON-RPC. The gateway can list threads, resume a thread, load its items when available, and send input through `turn/start` or `turn/steer`.

`SessionManager` continues to expose mobile-friendly sessions, but a Codex session may now be an attached desktop thread instead of a child process started by Agent Mobile. Attached sessions keep a process-like handle so the existing `/sessions/:id/input` and stream event path can remain stable.

Android stops creating sessions. On connect it uses the latest session returned by Host, subscribes to stream events, renders history, and sends input to the attached session.

## Scope

This first implementation supports one active attached Codex thread per phone session: the most recent Codex thread for the workspace. It does not support creating new Codex threads from mobile, multi-thread switching UI, or simultaneous multi-client conflict resolution.

## Error Handling

- If Codex app-server is unavailable, Host returns an empty session list and includes the failure in status diagnostics.
- If there is no desktop thread, Android displays a user-facing empty state instead of creating a session.
- If a Codex turn is already active, Host steers the turn when a turn id is known; otherwise it returns a conflict.
- Restored Agent Mobile sessions without a live Codex app-server process are treated as exited.

## Testing

- Unit-test app-server request mapping for `thread/list`, `thread/resume`, item history parsing, and `turn/start`.
- Unit-test `SessionManager` attached thread creation and input forwarding.
- Server tests verify `/sessions` can expose attachable Codex sessions without mobile creation.
- Android ViewModel tests verify connect does not create a session and send uses the discovered session.
