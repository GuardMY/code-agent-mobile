# Root Component Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the repository so the five system components live as first-level directories at the repo root: `android`, `agent-host`, `gateway`, `vscode-extension`, and `protocol`.

**Architecture:** Move the current component directories in place, then repair every repo-level reference that currently points through `apps/`, `packages/`, or `shared/`. Keep root-level engineering files (`package.json`, `package-lock.json`, `tsconfig.base.json`) at the repository root and verify the monorepo still builds, tests, and packages after the move.

**Tech Stack:** npm workspaces, TypeScript, Vitest, VS Code extension packaging, Android Gradle project

---

### Task 1: Move the five components to root-level directories

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Move: `apps/android` -> `android`
- Move: `packages/agent-host` -> `agent-host`
- Move: `packages/gateway` -> `gateway`
- Move: `packages/vscode-extension` -> `vscode-extension`
- Move: `shared/protocol` -> `protocol`

- [ ] **Step 1: Update workspace expectations in root manifests**

Change root workspace paths from nested locations to root component directories.

- [ ] **Step 2: Move the component directories**

Move each approved component directory to the repo root without changing the component-internal file layout.

- [ ] **Step 3: Refresh the root lockfile metadata**

Run `npm install` from the repo root after the move so `package-lock.json` reflects the new workspace locations.

### Task 2: Repair source, script, and documentation references

**Files:**
- Modify: `agent-host/vitest.config.ts`
- Modify: `vscode-extension/src/hostController.ts`
- Modify: `docs/dev-local-mvp.md`
- Modify: `docs/superpowers/plans/2026-07-01-codex-vscode-direct-connection.md`
- Search: repo-wide references to `apps/android`, `packages/*`, and `shared/protocol`

- [ ] **Step 1: Update source code path assumptions**

Repair any hard-coded relative or workspace paths so the moved components resolve each other from the new root layout.

- [ ] **Step 2: Update user-facing scripts and docs**

Rewrite commands and file paths in docs to use the new root-level component directories.

- [ ] **Step 3: Run a final repo-wide path search**

Search for stale path strings and either update them or intentionally leave historical references only where appropriate.

### Task 3: Verify the reorganized repo

**Files:**
- Verify: `package.json`
- Verify: `package-lock.json`
- Verify: `vscode-extension/agent-mobile-control-0.1.0.vsix` (recreated)

- [ ] **Step 1: Run focused extension tests**

Run: `npm run test -w vscode-extension`

- [ ] **Step 2: Run workspace build/test verification**

Run: `npm run build -w agent-host`

Run: `npm run package:extension`

Run: `npm test`

- [ ] **Step 3: Confirm the packaged extension still installs**

Run: `code --install-extension vscode-extension/agent-mobile-control-0.1.0.vsix --force`
