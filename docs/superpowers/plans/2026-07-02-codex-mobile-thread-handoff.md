# Codex Mobile Thread Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let mobile clients follow and send messages to Codex threads that were started on the computer, while preventing mobile-created Codex conversations.

**Architecture:** Add a Codex app-server thread gateway that discovers and resumes existing workspace threads. Represent resumed desktop threads as Agent Mobile sessions backed by a live app-server handle so the current HTTP and WebSocket mobile APIs stay mostly stable.

**Tech Stack:** TypeScript, Fastify, Vitest, Android Kotlin ViewModel tests.

---

## File Structure

- Modify `agent-host/src/codex/appServerClient.ts`: add thread list/resume/history methods and a factory for attaching to an existing thread.
- Modify `agent-host/src/codex/appServerClient.test.ts`: cover JSON-RPC mapping for list, resume, history output, and input.
- Modify `agent-host/src/sessions/sessionManager.ts`: add `syncDesktopSessions()` and support session records backed by attached processes.
- Modify `agent-host/src/sessionManager.test.ts`: prove desktop thread sessions are listed and input is forwarded.
- Modify `agent-host/src/server.ts`: sync desktop Codex sessions before `/sessions` and `/status` responses; disable mobile session creation.
- Modify `agent-host/src/server.test.ts`: cover discovery and disabled create behavior.
- Modify `android/app/src/main/java/com/agentmobile/app/ui/ConsoleViewModel.kt`: stop creating sessions during mobile flow; connect to latest discovered desktop session.
- Modify `android/app/src/test/java/com/agentmobile/app/ui/ConsoleViewModelTest.kt`: assert connect does not create a session and sends to discovered session.

## Tasks

### Task 1: Codex App-Server Thread Gateway

- [ ] Write failing tests in `agent-host/src/codex/appServerClient.test.ts` for `listThreads`, `resumeThread`, and sending input after resume.
- [ ] Run `npm test -w agent-host -- appServerClient.test.ts` and verify the new tests fail because methods do not exist.
- [ ] Implement `CodexThreadSummary`, `AppServerClient.listThreads()`, `AppServerClient.resumeThread(threadId)`, and `createAttachedAppServerCodexProcess()`.
- [ ] Run `npm test -w agent-host -- appServerClient.test.ts` and verify tests pass.

### Task 2: SessionManager Desktop Session Sync

- [ ] Write failing tests in `agent-host/src/sessionManager.test.ts` for syncing discovered Codex threads into sessions and forwarding input to an attached process.
- [ ] Run `npm test -w agent-host -- sessionManager.test.ts` and verify failure.
- [ ] Add optional `discoverSessions` and `attachSession` adapter methods; implement `SessionManager.syncDesktopSessions()`.
- [ ] Run `npm test -w agent-host -- sessionManager.test.ts` and verify tests pass.

### Task 3: Host API Behavior

- [ ] Write failing tests in `agent-host/src/server.test.ts` that `/sessions` lists desktop Codex sessions after sync and `POST /sessions` returns conflict or disabled.
- [ ] Run `npm test -w agent-host -- server.test.ts` and verify failure.
- [ ] Update server routes to call `syncDesktopSessions()` before list/status and disable mobile-created sessions.
- [ ] Run `npm test -w agent-host -- server.test.ts` and verify tests pass.

### Task 4: Android Mobile Flow

- [ ] Write failing ViewModel tests proving connect picks a discovered desktop session and does not call `createSession`.
- [ ] Run Android unit tests for `ConsoleViewModelTest`.
- [ ] Remove automatic/mobile create behavior from ViewModel flow and keep send targeting the discovered running session.
- [ ] Run Android unit tests again and verify pass.

### Task 5: Full Verification

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run Android unit tests with Gradle.
- [ ] Report any Codex app-server API limitation found during implementation.
